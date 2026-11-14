import { ApiError, call } from "./api";
import { getRow, setTagOverride, sync, upsert, type Row } from "./store";

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

/** タグを付け替える。画面には即座に出し、応答の行で置き換える。 */
export function setItemTags(id: string, tags: string[]): Promise<void> {
  const seen = new Set<string>();
  const names = tags.map((t) => t.replace(/\s+/g, " ").trim()).filter((t) => {
    const key = t.toLowerCase();
    if (t === "" || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  setTagOverride(id, names);
  return enqueue(async () => {
    try {
      const res = await call<{ rows: { tags: Row[]; item_tags: Row[] } }>("items.setTags", { id, tags: names });
      upsert(res.rows);
    } catch (e) {
      await sync().catch(() => undefined);
      throw e;
    } finally {
      setTagOverride(id, null);
    }
  });
}

// ---------- コレクション ----------

export function createCollection(name: string, withItemId?: string): string {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  upsert({
    collections: [{ id, name, description: "", cover_image_file_id: "", sort_order: String(Date.now()), created_at: now, updated_at: now, deleted_at: "", version: "1" }],
  });
  void enqueue(async () => {
    const res = await call<{ collection: Row }>("collections.create", { id, name });
    upsert({ collections: [res.collection] });
  }).catch(() => sync().catch(() => undefined));
  if (withItemId) void toggleCollection(withItemId, id, true).catch(() => undefined);
  return id;
}

export function toggleCollection(itemId: string, collectionId: string, on: boolean): Promise<void> {
  const now = new Date().toISOString();
  const existing = getRow("collection_items", `${collectionId}|${itemId}`);
  upsert({
    collection_items: [{
      collection_id: collectionId, item_id: itemId, sort_order: existing?.sort_order ?? String(Date.now()),
      added_at: on ? now : (existing?.added_at ?? now), version: existing?.version ?? "1", deleted_at: on ? "" : now,
    }],
  });
  return enqueue(async () => {
    try {
      const res = await call<{ links: Row[] }>(on ? "collections.addItems" : "collections.removeItems", { collection_id: collectionId, item_ids: [itemId] });
      upsert({ collection_items: res.links });
    } catch (e) {
      await sync().catch(() => undefined);
      throw e;
    }
  });
}

export function updateCollection(id: string, patch: Record<string, string>): Promise<void> {
  const current = getRow("collections", id);
  if (current) upsert({ collections: [{ ...current, ...patch }] });
  return enqueue(async () => {
    try {
      const latest = getRow("collections", id);
      const res = await call<{ collection: Row }>("collections.update", { id, version: latest?.version, patch });
      upsert({ collections: [res.collection] });
    } catch (e) {
      await sync().catch(() => undefined);
      throw e;
    }
  });
}

export function deleteCollection(id: string): Promise<void> {
  const current = getRow("collections", id);
  if (current) upsert({ collections: [{ ...current, deleted_at: new Date().toISOString() }] });
  return enqueue(async () => {
    try {
      await call("collections.delete", { id });
      await sync();
    } catch (e) {
      await sync().catch(() => undefined);
      throw e;
    }
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

// ---------- タグの整理・復元 ----------

/** タグ名を変える。同じ名前のタグが既にあれば、そのタグに統合する。戻り値は統合したかどうか。 */
export function renameTag(id: string, name: string): Promise<{ merged: boolean }> {
  return enqueue(async () => {
    let merged = false;
    try {
      await call("tags.update", { id, version: getRow("tags", id)?.version, patch: { name } });
    } catch (e) {
      const extra = e instanceof ApiError ? (e.extra as { tag_id?: string } | null) : null;
      if (!(e instanceof ApiError) || e.code !== "DUPLICATE" || !extra?.tag_id) {
        await sync().catch(() => undefined);
        throw e;
      }
      await call("tags.merge", { from_id: id, to_id: extra.tag_id });
      merged = true;
    }
    await sync();
    return { merged };
  });
}

export function deleteTag(id: string): Promise<void> {
  const current = getRow("tags", id);
  if (current) upsert({ tags: [{ ...current, deleted_at: new Date().toISOString() }] });
  return enqueue(async () => {
    try {
      await call("tags.delete", { id });
    } finally {
      await sync().catch(() => undefined);
    }
  });
}

export function restoreItem(id: string): Promise<void> {
  const current = getRow("items", id);
  if (current) upsert({ items: [{ ...current, deleted_at: "" }] });
  return enqueue(async () => {
    try {
      const res = await call<{ item: Row }>("items.restore", { id });
      upsert({ items: [res.item] });
    } catch (e) {
      await sync().catch(() => undefined);
      throw e;
    }
  });
}

// ---------- 一括操作・並べ替え ----------

export type BulkOp = { addTags?: string[]; addToCollection?: string; removeFromCollection?: string; delete?: boolean };

export function bulkItems(ids: string[], op: BulkOp): Promise<void> {
  const now = new Date().toISOString();
  if (op.delete) {
    upsert({ items: ids.flatMap((id) => { const r = getRow("items", id); return r ? [{ ...r, deleted_at: now }] : []; }) });
  }
  const link = (collectionId: string, itemId: string, on: boolean, i: number): Row => {
    const existing = getRow("collection_items", `${collectionId}|${itemId}`);
    return {
      collection_id: collectionId, item_id: itemId, sort_order: existing?.sort_order ?? String(Date.now() + i),
      added_at: existing?.added_at ?? now, version: existing?.version ?? "1", deleted_at: on ? "" : now,
    };
  };
  if (op.addToCollection) upsert({ collection_items: ids.map((id, i) => link(op.addToCollection ?? "", id, true, i)) });
  if (op.removeFromCollection) upsert({ collection_items: ids.map((id, i) => link(op.removeFromCollection ?? "", id, false, i)) });
  return enqueue(async () => {
    try {
      await call("items.bulk", {
        ids, add_tags: op.addTags ?? [], add_to_collection: op.addToCollection ?? "",
        remove_from_collection: op.removeFromCollection ?? "", delete: op.delete === true,
      });
    } finally {
      await sync().catch(() => undefined);
    }
  });
}

/** コレクション内の並び順を保存する。 */
export function reorderCollection(collectionId: string, itemIds: string[]): Promise<void> {
  upsert({
    collection_items: itemIds.flatMap((id, i) => {
      const r = getRow("collection_items", `${collectionId}|${id}`);
      return r ? [{ ...r, sort_order: String(i + 1) }] : [];
    }),
  });
  return enqueue(async () => {
    try {
      await call("collections.reorder", { collection_id: collectionId, item_ids: itemIds });
    } finally {
      await sync().catch(() => undefined);
    }
  });
}
