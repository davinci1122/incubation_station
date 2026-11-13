export const CONTENT_TYPES = ["page", "article", "image", "video", "pdf"] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

/** 保存処理の状態（仕様 4.5）。 */
export const ARCHIVE_STATUSES = ["pending", "processing", "completed", "partially_completed", "failed"] as const;
export type ArchiveStatus = (typeof ARCHIVE_STATUSES)[number];

export const JOB_TRIGGERS = ["new", "recapture", "retry"] as const;
export type JobTrigger = (typeof JOB_TRIGGERS)[number];

export const ARCHIVE_FORMATS = ["html", "screenshot", "full_screenshot", "article", "pdf", "metadata", "warc"] as const;
export type ArchiveFormat = (typeof ARCHIVE_FORMATS)[number];

export const CAPTURE_ERROR_CODES = [
  "TIMEOUT", "NETWORK", "BLOCKED_ROBOTS", "CAPTCHA", "LOGIN_REQUIRED", "RENDER_FAILED",
  "ASSET_FAILED", "STORAGE_FAILED", "SSRF_BLOCKED", "UNSUPPORTED_TYPE", "INVALID_URL",
] as const;
export type CaptureErrorCode = (typeof CAPTURE_ERROR_CODES)[number];

/** 自動再試行してよい一時的なエラー。 */
export const RETRYABLE_ERROR_CODES: readonly CaptureErrorCode[] = ["TIMEOUT", "NETWORK", "STORAGE_FAILED"];
export const MAX_AUTO_RETRIES = 3;

export const TOKEN_SCOPES = ["ingest"] as const;
export type TokenScope = (typeof TOKEN_SCOPES)[number];

/** 形式ごとの成否から全体の状態を決める。 */
export function summarizeStatus(results: readonly boolean[]): ArchiveStatus {
  if (results.length === 0) return "failed";
  const ok = results.filter(Boolean).length;
  if (ok === results.length) return "completed";
  return ok === 0 ? "failed" : "partially_completed";
}
