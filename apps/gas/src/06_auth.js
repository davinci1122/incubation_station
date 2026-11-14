/**
 * 認証。入口は2つ。
 * - doPost: ブラウザが Google ログインで得た ID トークンを本文に入れて送る。
 * - api:    Apps Script API 経由。Google が呼び出し元を認証済み。
 * どちらも、Script Properties の ALLOWED_EMAIL と一致する利用者だけを通す。
 */
function props_() {
  return PropertiesService.getScriptProperties();
}

function userFromEmail_(email) {
  var allowed = String(props_().getProperty("ALLOWED_EMAIL") || "").trim().toLowerCase();
  var actual = String(email || "").trim().toLowerCase();
  if (allowed === "" || actual === "" || actual !== allowed) throw err_("FORBIDDEN", "許可されていないアカウントです。");
  return { id: "u_" + sha256Hex_(actual).slice(0, 16), email: actual };
}

function verifyIdToken_(idToken) {
  var token = String(idToken || "");
  if (token === "" || token.length > 4096) throw err_("UNAUTHENTICATED", "ログインが必要です。");
  var clientId = String(props_().getProperty("OAUTH_CLIENT_ID") || "");
  if (clientId === "") throw err_("NOT_SETUP", "OAUTH_CLIENT_ID が未設定です。");

  var cache = CacheService.getScriptCache();
  var cacheKey = "idt:" + sha256Hex_(token);
  var cached = cache.get(cacheKey);
  if (cached) return userFromEmail_(cached);

  var res = UrlFetchApp.fetch("https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(token), { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw err_("UNAUTHENTICATED", "ログインの有効期限が切れています。");
  var info = JSON.parse(res.getContentText());
  var nowSec = Math.floor(Date.now() / 1000);
  var issOk = info.iss === "https://accounts.google.com" || info.iss === "accounts.google.com";
  if (!issOk || info.aud !== clientId || String(info.email_verified) !== "true" || Number(info.exp) <= nowSec) {
    throw err_("UNAUTHENTICATED", "ログイン情報を確認できませんでした。");
  }
  var user = userFromEmail_(info.email);
  var ttl = Math.max(1, Math.min(300, Number(info.exp) - nowSec));
  cache.put(cacheKey, user.email, ttl);
  return user;
}
