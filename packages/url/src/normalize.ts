/** 追跡用パラメータ。正規化時に取り除く。 */
const TRACKING_PARAMS = new Set([
  "fbclid", "gclid", "dclid", "gbraid", "wbraid", "msclkid", "yclid",
  "mc_cid", "mc_eid", "igshid", "_hsenc", "_hsmi", "ref_src",
]);
const TRACKING_PREFIXES = ["utm_"];

export const MAX_URL_LENGTH = 2000;

export type ParsedUrl =
  | { ok: true; url: URL }
  | { ok: false; reason: "EMPTY" | "TOO_LONG" | "INVALID" | "UNSUPPORTED_SCHEME" | "HAS_CREDENTIALS" };

/** 入力文字列を検証して URL にする。http / https のみ受け付ける。 */
export function parseHttpUrl(input: string): ParsedUrl {
  const raw = input.trim();
  if (raw === "") return { ok: false, reason: "EMPTY" };
  if (raw.length > MAX_URL_LENGTH) return { ok: false, reason: "TOO_LONG" };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "INVALID" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: "UNSUPPORTED_SCHEME" };
  }
  if (url.username !== "" || url.password !== "") {
    return { ok: false, reason: "HAS_CREDENTIALS" };
  }
  return { ok: true, url };
}

function isTrackingParam(name: string): boolean {
  const key = name.toLowerCase();
  return TRACKING_PARAMS.has(key) || TRACKING_PREFIXES.some((p) => key.startsWith(p));
}

/**
 * 重複判定用の正規化URLを返す。
 * - スキームとホストを小文字化（URL が行う）、既定ポートを除去（URL が行う）
 * - フラグメントを除去
 * - 追跡パラメータを除去し、残りをキー順に整列
 * - ルート以外の末尾スラッシュを除去
 * 不正なURLは null。
 */
export function normalizeUrl(input: string): string | null {
  const parsed = parseHttpUrl(input);
  if (!parsed.ok) return null;
  const url = parsed.url;
  url.hash = "";
  if (url.hostname.endsWith(".")) url.hostname = url.hostname.slice(0, -1);

  const kept = [...url.searchParams.entries()].filter(([k]) => !isTrackingParam(k));
  kept.sort(([a, av], [b, bv]) => (a === b ? (av < bv ? -1 : av > bv ? 1 : 0) : a < b ? -1 : 1));
  const params = new URLSearchParams(kept);
  url.search = params.toString();

  if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  }
  return url.toString();
}

/** 表示用のドメイン（先頭の www. を除く）。 */
export function displayDomain(input: string): string | null {
  const parsed = parseHttpUrl(input);
  if (!parsed.ok) return null;
  return parsed.url.hostname.replace(/^www\./, "");
}
