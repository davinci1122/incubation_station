import { call } from "./api";
import { getRow, sync, upsert, type Row } from "./store";

// 変更は1本の列に並べて順番に送る。画面には送信前に反映する（楽観的更新）。
let chain: Promise<unknown> = Promise.resolve();
const pending = new Map<string, Record<string, string>[]>();

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn);
  chain = run.catch(() => undefined);
  return run;
}

function overlay(row: Row): Row {
  return Object.assign({}, row, ...(pending.get(row.id ?? "") ?? []));
}

/** アイテムの項目を更新する。画面は即座に変わり、失敗したらサーバーの状態に戻す。 */
export function updateItem(id: string, patch: Record<string, string | boolean>): Promise<void> {
  const local: Record<string, string> = {};
  for (const [k, v] of Object.entries(patch)) local[k] = typeof v === "boolean" ? String(v) : v;
  pending.set(id, [...(pending.get(id) ?? []), local]);
  const current = getRow("items", id);
  if (current) upsert({ items: [overlay(current)] });

  return enqueue(async () => {
    try {
      const latest = getRow("items", id);
      const res = await call<{ item: Row }>("items.update", { id, version: latest?.version, patch });
      pending.set(id, (pending.get(id) ?? []).slice(1));
      upsert({ items: [overlay(res.item)] });
    } catch (e) {
      pending.delete(id);
      await sync().catch(() => undefined);
      throw e;
    }
  });
}

export function deleteItem(id: string): Promise<void> {
  const current = getRow("items", id);
  if (current) upsert({ items: [{ ...current, deleted_at: new Date().toISOString() }] });
  return enqueue(async () => {
    try {
      const res = await call<{ items: Row }>("items.delete", { id });
      upsert({ items: [res.items] });
    } catch (e) {
      await sync().catch(() => undefined);
      throw e;
    }
  });
}

export function setItemTags(id: string, tags: string[]): Promise<void> {
  return enqueue(async () => {
    await call("items.setTags", { id, tags });
    await sync();
  });
}

export function refetchItem(id: string): Promise<void> {
  const current = getRow("items", id);
  if (current) upsert({ items: [{ ...current, capture_status: "pending" }] });
  return enqueue(async () => {
    try {
      await call("items.refetch", { id });
      const res = await call<{ item: Row }>("items.fetchMeta", { id });
      upsert({ items: [overlay(res.item)] });
    } catch (e) {
      await sync().catch(() => undefined);
      throw e;
    }
  });
}

/**
 * URLを保存する。カードを先に表示し、登録とページ情報の取得は裏で行う。
 * 既に保存済みのURLだった場合は、そのアイテムのIDを返す。
 */
export function createItem(original: string, normalized: string, domain: string): { id: string; done: Promise<{ duplicateOf: string | null }> } {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const temp: Row = {
    id, original_url: original, normalized_url: normalized, domain, title: "", content_type: "page",
    capture_status: "pending", is_favorite: "false", created_at: now, updated_at: now, deleted_at: "", version: "1",
  };
  upsert({ items: [temp] });
  const done = enqueue(async () => {
    let created: { item: Row; duplicate: boolean };
    try {
      created = await call<{ item: Row; duplicate: boolean }>("items.create", { id, original_url: original, normalized_url: normalized, recapture: false });
    } catch (e) {
      upsert({ items: [{ ...temp, deleted_at: now }] });
      throw e;
    }
    if (created.duplicate) {
      upsert({ items: [{ ...temp, deleted_at: now }, created.item] });
      return { duplicateOf: created.item.id ?? null };
    }
    upsert({ items: [overlay(created.item)] });
    return { duplicateOf: null };
  });
  // ページ情報の取得は登録の完了を待ってから。失敗してもカードは残る。
  void done.then((r) => {
    if (r.duplicateOf !== null) return;
    return enqueue(async () => {
      const res = await call<{ item: Row }>("items.fetchMeta", { id });
      upsert({ items: [overlay(res.item)] });
    }).catch(() => sync().catch(() => undefined));
  }).catch(() => undefined);
  return { id, done };
}
