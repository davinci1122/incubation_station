import { ApiError, call } from "./api";
import { getRow, setTagOverride, sync, upsert, type Row, type TableName } from "./store";

/**
 * 変更の送信。画面には先に反映し（楽観的更新）、サーバーへは1本の列に並べて順番に送る。
 * 列は端末に保存するので、圏外やアプリを閉じたあとでも、次に通信できたときに送られる。
 */
type OpType =
  | "item.create" | "item.meta" | "item.update" | "item.delete" | "item.restore" | "item.tags"
  | "collection.create" | "collection.update" | "collection.toggle" | "tag.rename" | "then-sync" | "plain";

type Op = {
  type: OpType;
  action: string;
  params: Record<string, unknown>;
  /** 対象のID（アイテムなど）。 */
  ref?: string;
  /** 送信時に最新の version を付ける対象。 */
  versionOf?: { table: TableName; key: string };
  /** item.update で画面に先行反映している内容。 */
  patch?: Record<string, string>;
  label?: string;
};

export type Conflict = { id: string; patch: Record<string, string>; current: Row };
export type MutationEvent =
  | { type: "error"; message: string }
  | { type: "duplicate"; id: string }
  | { type: "merged"; name: string };
export type OutboxState = { pending: number; conflicts: Conflict[]; offline: boolean };

const OUTBOX_KEY = "cabinet:outbox:v1";
let outbox: Op[] = [];
let conflicts: Conflict[] = [];
let offline = false;
let running = false;
let started = false;
let state: OutboxState = { pending: 0, conflicts: [], offline: false };
const stateListeners = new Set<() => void>();
const eventListeners = new Set<(e: MutationEvent) => void>();

function emit(): void {
  state = { pending: outbox.length, conflicts: [...conflicts], offline };
  stateListeners.forEach((fn) => fn());
}

function fire(e: MutationEvent): void {
  eventListeners.forEach((fn) => fn(e));
}

function persist(): void {
  try {
    window.localStorage.setItem(OUTBOX_KEY, JSON.stringify(outbox));
  } catch {
    // 保存できなくても、開いている間は送信を続ける
  }
}

export function subscribeOutbox(fn: () => void): () => void {
  stateListeners.add(fn);
  return () => stateListeners.delete(fn);
}
export function getOutboxState(): OutboxState {
  return state;
}
export function subscribeEvents(fn: (e: MutationEvent) => void): () => void {
  eventListeners.add(fn);
  return () => eventListeners.delete(fn);
}

/** 未送信の変更を重ねたアイテム（送信待ちの編集が、途中の応答で巻き戻って見えないようにする）。 */
function overlay(row: Row): Row {
  const patches = outbox.filter((o) => o.type === "item.update" && o.ref === row.id && o.patch).map((o) => o.patch as Record<string, string>);
  return Object.assign({}, row, ...patches);
}

function push(...ops: Op[]): void {
  outbox.push(...ops);
  persist();
  emit();
  void flush();
}

const now = () => new Date().toISOString();

/** 起動時に呼ぶ。保存しておいた未送信の変更を読み込み、通信の回復を待ち受ける。 */
export function startOutbox(): void {
  if (started) return;
  started = true;
  try {
    const raw = window.localStorage.getItem(OUTBOX_KEY);
    if (raw) outbox = JSON.parse(raw) as Op[];
  } catch {
    outbox = [];
  }
  for (const op of outbox) {
    if (op.type === "item.tags" && op.ref) setTagOverride(op.ref, (op.params.tags as string[]) ?? []);
  }
  offline = !navigator.onLine;
  window.addEventListener("online", () => { offline = false; emit(); void flush(); });
  window.addEventListener("offline", () => { offline = true; emit(); });
  window.setInterval(() => { if (outbox.length > 0) void flush(); }, 20_000);
  emit();
  void flush();
}

/** 未送信の変更を順に送る。通信できない・ログインが切れている間は、列に残したまま止まる。 */
export async function flush(): Promise<void> {
  if (running || outbox.length === 0) return;
  running = true;
  try {
    while (outbox.length > 0) {
      const op = outbox[0] as Op;
      try {
        const params = { ...op.params };
        if (op.versionOf) params.version = getRow(op.versionOf.table, op.versionOf.key)?.version;
        const res = await call<Record<string, unknown>>(op.action, params);
        outbox.shift();
        persist();
        await after(op, res);
        if (offline) offline = false;
      } catch (e) {
        const code = e instanceof ApiError ? e.code : "";
        if (code === "NETWORK" || code === "UNAUTHENTICATED" || code === "BUSY") {
          offline = code === "NETWORK";
          break;
        }
        outbox.shift();
        persist();
        await failed(op, e);
      }
      emit();
    }
  } finally {
    running = false;
    emit();
  }
}

async function after(op: Op, res: Record<string, unknown>): Promise<void> {
  switch (op.type) {
    case "item.create": {
      const item = res.item as Row;
      if (res.duplicate) {
        const temp = getRow("items", op.ref ?? "");
        upsert({ items: [...(temp ? [{ ...temp, deleted_at: now() }] : []), item] });
        outbox = outbox.filter((o) => o.ref !== op.ref);
        persist();
        fire({ type: "duplicate", id: item.id ?? "" });
      } else {
        upsert({ items: [overlay(item)] });
      }
      return;
    }
    case "item.meta":
    case "item.update":
    case "item.restore":
      upsert({ items: [overlay(res.item as Row)] });
      return;
    case "item.delete":
      upsert({ items: [res.items as Row] });
      return;
    case "item.tags":
      upsert(res.rows as { tags: Row[]; item_tags: Row[] });
      if (op.ref && !outbox.some((o) => o.type === "item.tags" && o.ref === op.ref)) setTagOverride(op.ref, null);
      return;
    case "collection.create":
    case "collection.update":
      upsert({ collections: [res.collection as Row] });
      return;
    case "collection.toggle":
      upsert({ collection_items: res.links as Row[] });
      return;
    case "tag.rename":
    case "then-sync":
      await sync().catch(() => undefined);
      return;
    default:
      return;
  }
}

async function failed(op: Op, e: unknown): Promise<void> {
  const err = e instanceof ApiError ? e : null;
  if (op.type === "item.update" && err?.code === "CONFLICT") {
    const current = (err.extra as { current?: Row } | null)?.current;
    if (current && op.ref && op.patch) {
      upsert({ items: [overlay(current)] });
      conflicts.push({ id: op.ref, patch: op.patch, current });
      return;
    }
  }
  if (op.type === "tag.rename" && err?.code === "DUPLICATE") {
    const target = (err.extra as { tag_id?: string } | null)?.tag_id;
    if (target) {
      outbox.unshift({ type: "then-sync", action: "tags.merge", params: { from_id: op.ref, to_id: target } });
      persist();
      fire({ type: "merged", name: String((op.params.patch as { name?: string } | undefined)?.name ?? "") });
      return;
    }
  }
  if (op.type === "item.create" && op.ref) {
    const temp = getRow("items", op.ref);
    if (temp) upsert({ items: [{ ...temp, deleted_at: now() }] });
    outbox = outbox.filter((o) => o.ref !== op.ref);
    persist();
  }
  if (op.type === "item.tags" && op.ref) setTagOverride(op.ref, null);
  if (op.type === "item.meta") {
    await sync().catch(() => undefined);
    return;
  }
  fire({ type: "error", message: `${op.label ?? "変更"}を保存できませんでした。${e instanceof Error ? e.message : ""}` });
  await sync().catch(() => undefined);
}

// ---------- 競合の解決 ----------

/** 競合を解決する。mine: この端末の内容で上書き / theirs: 他の端末の内容を使う。 */
export function resolveConflict(id: string, choice: "mine" | "theirs"): void {
  const hit = conflicts.find((c) => c.id === id);
  conflicts = conflicts.filter((c) => c.id !== id);
  emit();
  if (hit && choice === "mine") updateItem(id, hit.patch);
}

// ---------- アイテム ----------

export function updateItem(id: string, patch: Record<string, string | boolean>): void {
  const local: Record<string, string> = {};
  for (const [k, v] of Object.entries(patch)) local[k] = typeof v === "boolean" ? String(v) : v;
  outbox.push({ type: "item.update", action: "items.update", params: { id, patch }, ref: id, versionOf: { table: "items", key: id }, patch: local, label: "編集" });
  const current = getRow("items", id);
  if (current) upsert({ items: [overlay(current)] });
  push();
}

export function deleteItem(id: string): void {
  const current = getRow("items", id);
  if (current) upsert({ items: [{ ...current, deleted_at: now() }] });
  push({ type: "item.delete", action: "items.delete", params: { id }, ref: id, label: "削除" });
}

export function restoreItem(id: string): void {
  const current = getRow("items", id);
  if (current) upsert({ items: [{ ...current, deleted_at: "" }] });
  push({ type: "item.restore", action: "items.restore", params: { id }, ref: id, label: "復元" });
}

export function setItemTags(id: string, tags: string[]): void {
  const seen = new Set<string>();
  const names = tags.map((t) => t.replace(/\s+/g, " ").trim()).filter((t) => {
    const key = t.toLowerCase();
    if (t === "" || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  setTagOverride(id, names);
  push({ type: "item.tags", action: "items.setTags", params: { id, tags: names }, ref: id, label: "タグの変更" });
}

export function refetchItem(id: string): void {
  const current = getRow("items", id);
  if (current) upsert({ items: [{ ...current, capture_status: "pending" }] });
  push(
    { type: "plain", action: "items.refetch", params: { id }, ref: id, label: "再取得" },
    { type: "item.meta", action: "items.fetchMeta", params: { id }, ref: id },
  );
}

/** URLを保存する。カードを先に表示し、登録とページ情報の取得は裏で行う。 */
export function createItem(original: string, normalized: string, domain: string): string {
  const id = crypto.randomUUID();
  const t = now();
  upsert({
    items: [{
      id, original_url: original, normalized_url: normalized, domain, title: "", content_type: "page",
      capture_status: "pending", is_favorite: "false", created_at: t, updated_at: t, deleted_at: "", version: "1",
    }],
  });
  push(
    { type: "item.create", action: "items.create", params: { id, original_url: original, normalized_url: normalized, recapture: false }, ref: id, label: "URL" },
    { type: "item.meta", action: "items.fetchMeta", params: { id }, ref: id },
  );
  return id;
}

export type BulkOp = { addTags?: string[]; addToCollection?: string; removeFromCollection?: string; delete?: boolean };

export function bulkItems(ids: string[], op: BulkOp): void {
  const t = now();
  if (op.delete) {
    upsert({ items: ids.flatMap((id) => { const r = getRow("items", id); return r ? [{ ...r, deleted_at: t }] : []; }) });
  }
  const link = (collectionId: string, itemId: string, on: boolean, i: number): Row => {
    const existing = getRow("collection_items", `${collectionId}|${itemId}`);
    return {
      collection_id: collectionId, item_id: itemId, sort_order: existing?.sort_order ?? String(Date.now() + i),
      added_at: existing?.added_at ?? t, version: existing?.version ?? "1", deleted_at: on ? "" : t,
    };
  };
  if (op.addToCollection) upsert({ collection_items: ids.map((id, i) => link(op.addToCollection ?? "", id, true, i)) });
  if (op.removeFromCollection) upsert({ collection_items: ids.map((id, i) => link(op.removeFromCollection ?? "", id, false, i)) });
  push({
    type: "then-sync", action: "items.bulk", label: "一括操作",
    params: { ids, add_tags: op.addTags ?? [], add_to_collection: op.addToCollection ?? "", remove_from_collection: op.removeFromCollection ?? "", delete: op.delete === true },
  });
}

// ---------- コレクション ----------

export function createCollection(name: string, withItemId?: string): string {
  const id = crypto.randomUUID();
  const t = now();
  upsert({
    collections: [{ id, name, description: "", cover_image_file_id: "", sort_order: String(Date.now()), created_at: t, updated_at: t, deleted_at: "", version: "1" }],
  });
  push({ type: "collection.create", action: "collections.create", params: { id, name }, ref: id, label: "コレクションの作成" });
  if (withItemId) toggleCollection(withItemId, id, true);
  return id;
}

export function toggleCollection(itemId: string, collectionId: string, on: boolean): void {
  const t = now();
  const existing = getRow("collection_items", `${collectionId}|${itemId}`);
  upsert({
    collection_items: [{
      collection_id: collectionId, item_id: itemId, sort_order: existing?.sort_order ?? String(Date.now()),
      added_at: on ? t : (existing?.added_at ?? t), version: existing?.version ?? "1", deleted_at: on ? "" : t,
    }],
  });
  push({
    type: "collection.toggle", action: on ? "collections.addItems" : "collections.removeItems",
    params: { collection_id: collectionId, item_ids: [itemId] }, label: "コレクションの変更",
  });
}

export function updateCollection(id: string, patch: Record<string, string>): void {
  const current = getRow("collections", id);
  if (current) upsert({ collections: [{ ...current, ...patch }] });
  push({ type: "collection.update", action: "collections.update", params: { id, patch }, ref: id, versionOf: { table: "collections", key: id }, label: "コレクションの変更" });
}

export function deleteCollection(id: string): void {
  const current = getRow("collections", id);
  if (current) upsert({ collections: [{ ...current, deleted_at: now() }] });
  push({ type: "then-sync", action: "collections.delete", params: { id }, ref: id, label: "コレクションの削除" });
}

/** コレクション内の並び順を保存する。 */
export function reorderCollection(collectionId: string, itemIds: string[]): void {
  upsert({
    collection_items: itemIds.flatMap((id, i) => {
      const r = getRow("collection_items", `${collectionId}|${id}`);
      return r ? [{ ...r, sort_order: String(i + 1) }] : [];
    }),
  });
  push({ type: "then-sync", action: "collections.reorder", params: { collection_id: collectionId, item_ids: itemIds }, label: "並べ替え" });
}

// ---------- タグ ----------

/** タグ名を変える。同じ名前のタグが既にあれば、そのタグに統合する。 */
export function renameTag(id: string, name: string): void {
  const current = getRow("tags", id);
  if (current) upsert({ tags: [{ ...current, name }] });
  push({ type: "tag.rename", action: "tags.update", params: { id, patch: { name } }, ref: id, versionOf: { table: "tags", key: id }, label: "タグの変更" });
}

export function deleteTag(id: string): void {
  const current = getRow("tags", id);
  if (current) upsert({ tags: [{ ...current, deleted_at: now() }] });
  push({ type: "then-sync", action: "tags.delete", params: { id }, ref: id, label: "タグの削除" });
}
