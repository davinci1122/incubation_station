/**
 * Google Sheets のテーブル定義。1テーブル = 1シート、1行目が列名。
 * 列は名前で読み書きする（順序に依存しない）。列の追加はマイグレーションで行う。
 */

/** 全テーブル共通の管理列。version=楽観ロック、rev=差分同期の通し番号、deleted_at=論理削除。 */
export const COMMON_COLUMNS = ["version", "rev", "deleted_at"] as const;

const table = <const C extends readonly string[]>(key: readonly string[], columns: C) =>
  ({ key, columns: [...columns, ...COMMON_COLUMNS] as const }) as const;

export const TABLES = {
  items: table(["id"], [
    "id", "user_id", "original_url", "normalized_url", "url_hash", "title", "description",
    "domain", "content_type", "excerpt", "summary", "lang", "published_at", "favicon_file_id",
    "thumbnail_file_id", "og_image_file_id", "thumb_width", "thumb_height", "thumb_color",
    "article_file_id", "latest_capture_id", "capture_status", "user_note", "is_favorite",
    "created_at", "updated_at",
  ]),
  captures: table(["id"], [
    "id", "item_id", "user_id", "captured_at", "archive_status", "page_title", "page_url",
    "http_status", "html_file_id", "screenshot_file_id", "full_screenshot_file_id",
    "pdf_file_id", "warc_file_id", "metadata_file_id", "article_file_id", "folder_id",
    "formats_json", "total_bytes", "content_hash", "error_code", "error_message", "worker_version",
  ]),
  tags: table(["id"], ["id", "user_id", "name", "color", "created_at", "updated_at"]),
  item_tags: table(["item_id", "tag_id"], ["item_id", "tag_id", "user_id", "created_at"]),
  collections: table(["id"], [
    "id", "user_id", "name", "description", "cover_image_file_id", "sort_order",
    "created_at", "updated_at",
  ]),
  collection_items: table(["collection_id", "item_id"], [
    "collection_id", "item_id", "user_id", "sort_order", "added_at",
  ]),
  capture_jobs: table(["id"], [
    "id", "item_id", "capture_id", "user_id", "status", "trigger", "retry_count",
    "queued_at", "started_at", "completed_at", "error_code", "error_message",
  ]),
  api_tokens: table(["id"], [
    "id", "user_id", "name", "token_hash", "scope", "created_at", "last_used_at", "revoked_at",
  ]),
} as const;

export type TableName = keyof typeof TABLES;
export type ColumnOf<T extends TableName> = (typeof TABLES)[T]["columns"][number];
/** シートの1行。値はすべて文字列として保存する（書式はプレーンテキスト）。 */
export type Row<T extends TableName> = Record<ColumnOf<T>, string>;

/** 管理用シート。key / value の2列。 */
export const META_SHEET = { name: "_meta", columns: ["key", "value"] } as const;
export const META_KEYS = ["schema_version", "rev_counter", "last_backup_at"] as const;

export const SCHEMA_VERSION = 1;

/** Sheets のセル上限は5万字。超え得る値（記事本文）は Drive に置く。 */
export const MAX_CELL_CHARS = 50_000;
export const MAX_NOTE_CHARS = 20_000;
export const MAX_EXCERPT_CHARS = 1_000;
