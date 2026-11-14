/**
 * テーブル定義。packages/schema/src/tables.ts と同じ内容を保つこと
 * （apps/gas/test で一致を検査している）。
 */
var COMMON_COLUMNS = ["version", "rev", "deleted_at"];

var TABLE_COLUMNS = {
  items: [
    "id", "user_id", "original_url", "normalized_url", "url_hash", "title", "description",
    "domain", "content_type", "image_url", "favicon_url", "excerpt", "summary", "lang", "published_at", "favicon_file_id",
    "thumbnail_file_id", "og_image_file_id", "thumb_width", "thumb_height", "thumb_color",
    "article_file_id", "latest_capture_id", "capture_status", "user_note", "is_favorite",
    "created_at", "updated_at"
  ],
  captures: [
    "id", "item_id", "user_id", "captured_at", "archive_status", "page_title", "page_url",
    "http_status", "html_file_id", "screenshot_file_id", "full_screenshot_file_id",
    "pdf_file_id", "warc_file_id", "metadata_file_id", "article_file_id", "folder_id",
    "formats_json", "total_bytes", "content_hash", "error_code", "error_message", "worker_version"
  ],
  tags: ["id", "user_id", "name", "color", "created_at", "updated_at"],
  item_tags: ["item_id", "tag_id", "user_id", "created_at"],
  collections: [
    "id", "user_id", "name", "description", "cover_image_file_id", "sort_order",
    "created_at", "updated_at"
  ],
  collection_items: ["collection_id", "item_id", "user_id", "sort_order", "added_at"],
  capture_jobs: [
    "id", "item_id", "capture_id", "user_id", "status", "trigger", "retry_count",
    "queued_at", "started_at", "completed_at", "error_code", "error_message"
  ],
  api_tokens: ["id", "user_id", "name", "token_hash", "scope", "created_at", "last_used_at", "revoked_at"]
};

var TABLE_NAMES = Object.keys(TABLE_COLUMNS);
/** 差分同期で端末に返すテーブル（api_tokens は返さない）。 */
var SYNC_TABLES = ["items", "captures", "tags", "item_tags", "collections", "collection_items", "capture_jobs"];

var META_SHEET = "_meta";
var CURATION_SHEET = "curation";
var CURATION_COLUMNS = [
  "item_id", "title", "url", "domain", "content_type", "excerpt", "saved_at",
  "tags", "new_tags", "summary", "note", "apply", "collections", "new_collections"
];
var SCHEMA_VERSION = 1;

var LIMITS = { url: 2000, title: 500, description: 2000, note: 20000, summary: 2000, tagName: 60, name: 120, tagsPerItem: 30 };

function columnsOf_(name) {
  return TABLE_COLUMNS[name].concat(COMMON_COLUMNS);
}
