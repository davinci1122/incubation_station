import { call } from "./api";

export type Row = Record<string, string>;
const TABLES = ["items", "captures", "tags", "item_tags", "collections", "collection_items", "capture_jobs"] as const;
export type TableName = (typeof TABLES)[number];

const KEYS: Record<TableName, readonly string[]> = {
  items: ["id"], captures: ["id"], tags: ["id"], item_tags: ["item_id", "tag_id"],
  collections: ["id"], collection_items: ["collection_id", "item_id"], capture_jobs: ["id"],
};

export type Snapshot = { cursor: number; tables: Record<TableName, Row[]>; syncing: boolean; loaded: boolean };

const CACHE_KEY = "cabinet:data:v1";
const maps = Object.fromEntries(TABLES.map((t) => [t, new Map<string, Row>()])) as Record<TableName, Map<string, Row>>;
let cursor = 0;
let syncing = false;
let loaded = false;
let snapshot: Snapshot = build();
const listeners = new Set<() => void>();

function build(): Snapshot {
  const tables = Object.fromEntries(TABLES.map((t) => [t, [...maps[t].values()]])) as Record<TableName, Row[]>;
  return { cursor, tables, syncing, loaded };
}

function emit(): void {
  snapshot = build();
  listeners.forEach((fn) => fn());
}

function keyOf(table: TableName, row: Row): string {
  return KEYS[table].map((k) => row[k] ?? "").join("|");
}

function apply(tables: Partial<Record<TableName, Row[]>>): void {
  for (const t of TABLES) for (const row of tables[t] ?? []) maps[t].set(keyOf(t, row), row);
}

function persist(): void {
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify({ cursor, tables: build().tables }));
  } catch {
    // 容量超過などで保存できなくても動作は続ける
  }
}

/** 端末内に保存した前回のデータを読み込む。 */
export function restore(): void {
  if (loaded) return;
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as { cursor: number; tables: Partial<Record<TableName, Row[]>> };
      apply(saved.tables);
      cursor = Number(saved.cursor) || 0;
    }
  } catch {
    cursor = 0;
  }
  loaded = true;
  emit();
}

export function clearLocal(): void {
  for (const t of TABLES) maps[t].clear();
  cursor = 0;
  try {
    window.localStorage.removeItem(CACHE_KEY);
  } catch {
    // 何もしない
  }
  emit();
}

type Pull = { tables: Partial<Record<TableName, Row[]>>; cursor: number; more: boolean };
let running: Promise<void> | null = null;

/** サーバーとの差分を取り込む。同時に呼ばれても1本にまとめる。 */
export function sync(): Promise<void> {
  if (running) return running;
  syncing = true;
  emit();
  running = (async () => {
    try {
      for (let guard = 0; guard < 50; guard++) {
        const page = await call<Pull>("sync.pull", { since: cursor });
        apply(page.tables);
        cursor = page.cursor;
        if (!page.more) break;
      }
      persist();
    } finally {
      syncing = false;
      running = null;
      emit();
    }
  })();
  return running;
}

/** サーバーの応答や画面上の先行反映を取り込む。 */
export function upsert(tables: Partial<Record<TableName, Row[]>>): void {
  apply(tables);
  persist();
  emit();
}

export function getRow(table: TableName, key: string): Row | undefined {
  return maps[table].get(key);
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getSnapshot(): Snapshot {
  return snapshot;
}
