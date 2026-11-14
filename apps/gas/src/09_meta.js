/**
 * ページのメタデータ取得。AIは使わず、HTMLを1回読んで決まった規則で抜き出す。
 * 保存するのはタイトル・説明・画像URL・favicon URL・抜粋のみ（ページの複製は保存しない）。
 */
var META_LIMITS = { html: 600000, redirects: 5, excerpt: 1000 };

function isBlockedHost_(hostname) {
  var host = String(hostname || "").toLowerCase().replace(/\.$/, "");
  if (host === "" || host.charAt(0) === "[" || host.indexOf(":") !== -1) return true; // IPv6 リテラルは扱わない
  var m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (m) {
    var a = Number(m[1]), b = Number(m[2]);
    if (a > 255 || b > 255 || Number(m[3]) > 255 || Number(m[4]) > 255) return true;
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19));
  }
  if (/^[\d.]+$/.test(host) || /^0x/i.test(host)) return true;
  if (host === "localhost" || host === "metadata" || host.indexOf(".") === -1) return true;
  return /\.(localhost|local|internal|lan|intranet|corp|home\.arpa)$/.test(host);
}

/** 広告・計測・飾りと思われる画像なら true。 */
function isJunkImage_(url) {
  var u = String(url || "").toLowerCase();
  if (u === "" || u.indexOf("data:") === 0 || /\.svg(\?|#|$)/.test(u)) return true;
  if (/(doubleclick|googlesyndication|googleadservices|adservice|amazon-adsystem|adnxs|criteo|taboola|outbrain|scorecardresearch|facebook\.com\/tr|google-analytics|googletagmanager|adsrvr|rubiconproject|pubmatic|openx|yimg\.jp\/images\/listing|i-mobile|microad|logly|popin|fluct|zucks|nend|gssprt|ad-stir)/.test(u)) return true;
  if (/(^|[\/_.-])(ads?|adv|advert|banners?|sponsor|pr|icon|icons|logo|logos|favicon|spacer|blank|pixel|beacon|tracking|btn|button|arrow|sprite|counter|avatar|emoji)([\/_.-]|\d|$)/.test(u)) return true;
  return false;
}

/**
 * ページ内の画像URLをすべての場所から探す（img、srcset、CSSの背景、JavaScriptに埋め込まれたデータ）。
 * JavaScriptで描画するサイトでも、データとして画像URLを持っていることが多い。
 */
function findImageInSource_(src, baseUrl) {
  var text = String(src).replace(/\\u002[fF]/g, "/").replace(/\\\//g, "/").replace(/&amp;/g, "&");
  var re = /(?:https?:)?\/\/[^\s"'<>()\\,]+?\.(?:jpe?g|png|webp|avif)(?:\?[^\s"'<>()\\]*)?(?=["'\s<>)\\,]|$)/gi;
  var m;
  while ((m = re.exec(text)) !== null) {
    var abs = resolveUrl_(baseUrl, m[0]);
    if (abs !== "" && !isJunkImage_(abs)) return abs;
  }
  // CSS の背景画像は相対パスで書かれることが多い。
  var css = /url\(\s*["']?([^"')\s]+?\.(?:jpe?g|png|webp|avif)(?:\?[^"')\s]*)?)["']?\s*\)/gi;
  while ((m = css.exec(text)) !== null) {
    var bg = resolveUrl_(baseUrl, m[1]);
    if (bg !== "" && !isJunkImage_(bg)) return bg;
  }
  return "";
}

function hostOf_(url) {
  var m = /^https?:\/\/(?:[^\/?#@]*@)?(\[[^\]]*\]|[^\/?#:]*)/i.exec(url);
  return m ? m[1] : "";
}

/** 相対URLを絶対URLにする。http / https 以外になる場合は空文字。 */
function resolveUrl_(base, ref) {
  var r = String(ref || "").trim();
  if (r === "") return "";
  if (/^https?:\/\//i.test(r)) return r;
  if (/^[a-z][a-z0-9+.-]*:/i.test(r)) return "";
  var o = /^(https?:)\/\/[^\/?#]+/i.exec(base);
  if (!o) return "";
  if (r.indexOf("//") === 0) return o[1] + r;
  if (r.charAt(0) === "/") return o[0] + r;
  var path = base.slice(o[0].length).replace(/[?#].*$/, "");
  var dir = path.slice(0, path.lastIndexOf("/") + 1) || "/";
  return o[0] + dir + r;
}

function decodeEntities_(text) {
  var named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return String(text).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, function (all, code) {
    var c = code.toLowerCase();
    if (c.charAt(0) === "#") {
      var n = c.charAt(1) === "x" ? parseInt(c.slice(2), 16) : parseInt(c.slice(1), 10);
      return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : "";
    }
    return named[c] !== undefined ? named[c] : all;
  });
}

function squash_(text) {
  return decodeEntities_(String(text).replace(/<[^>]*>/g, " ")).replace(/[\s　]+/g, " ").trim();
}

function attrs_(tag) {
  var out = {};
  var re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  var m;
  while ((m = re.exec(tag)) !== null) {
    out[m[1].toLowerCase()] = decodeEntities_(m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4]);
  }
  return out;
}

/** HTML からメタデータを抜き出す。baseUrl は最終的なURL。 */
function parseMeta_(html, baseUrl) {
  var src = String(html).slice(0, META_LIMITS.html);
  var metas = {};
  (src.match(/<meta\b[^>]*>/gi) || []).forEach(function (tag) {
    var a = attrs_(tag);
    var key = (a.property || a.name || a.itemprop || "").toLowerCase();
    if (key !== "" && a.content !== undefined && metas[key] === undefined && a.content.trim() !== "") metas[key] = a.content.trim();
  });
  var pick = function () {
    for (var i = 0; i < arguments.length; i++) if (metas[arguments[i]]) return metas[arguments[i]];
    return "";
  };
  var titleTag = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(src);
  var title = pick("og:title", "twitter:title") || (titleTag ? squash_(titleTag[1]) : "");
  var description = pick("og:description", "description", "twitter:description");
  var image = resolveUrl_(baseUrl, pick("og:image:secure_url", "og:image", "twitter:image", "twitter:image:src"));

  var favicon = "";
  (src.match(/<link\b[^>]*>/gi) || []).forEach(function (tag) {
    var a = attrs_(tag);
    if (favicon === "" && a.href && /(^|\s)(icon|shortcut icon|apple-touch-icon)(\s|$)/i.test(a.rel || "")) favicon = resolveUrl_(baseUrl, a.href);
  });
  if (favicon === "") favicon = resolveUrl_(baseUrl, "/favicon.ico");

  var published = "";
  var rawDate = pick("article:published_time", "datepublished", "date", "og:updated_time");
  if (rawDate) {
    var d = new Date(rawDate);
    if (!isNaN(d.getTime())) published = d.toISOString();
  }
  var langTag = /<html\b[^>]*\blang\s*=\s*["']?([a-zA-Z-]{2,10})/i.exec(src);
  var ogType = pick("og:type").toLowerCase();
  var contentType = ogType.indexOf("video") === 0 ? "video" : ogType === "article" ? "article" : "page";

  var body = /<body\b[^>]*>([\s\S]*)/i.exec(src);
  var text = body ? body[1] : src;
  var focus = /<(article|main)\b[^>]*>([\s\S]*?)<\/\1>/i.exec(text);
  if (focus && squash_(focus[2]).length > 200) text = focus[2];
  text = text.replace(/<(script|style|noscript|svg|nav|header|footer|aside|form|template)\b[\s\S]*?<\/\1>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ");
  var excerpt = squash_(text).slice(0, META_LIMITS.excerpt);

  // 代表画像の指定（OGP）がないページは、本文の画像を使う。小さな画像・広告・アイコンは避ける。
  if (image === "") {
    var imgs = (body ? body[1] : src).match(/<img\b[^>]*>/gi) || [];
    for (var k = 0; k < imgs.length && image === ""; k++) {
      var ia = attrs_(imgs[k]);
      // 遅延読み込みでは src が仮の画像で、本物は data-src などにある。
      var srcset = String(ia["data-srcset"] || ia.srcset || "").split(",")[0].trim().split(/\s+/)[0] || "";
      var cand = [ia["data-src"], ia["data-original"], ia["data-lazy-src"], ia.src, srcset].filter(function (v) {
        return v && !/^data:/i.test(v);
      })[0] || "";
      var w = Number(ia.width || 0), hgt = Number(ia.height || 0);
      if (cand === "") continue;
      if ((w > 0 && w < 120) || (hgt > 0 && hgt < 80)) continue;
      var abs = resolveUrl_(baseUrl, cand);
      if (abs !== "" && !isJunkImage_(abs)) image = abs;
    }
  }
  // それでもなければ、ページ全体（埋め込みデータを含む）から探す。
  if (image === "") image = findImageInSource_(src, baseUrl);

  return {
    title: squash_(title).slice(0, LIMITS.title), description: squash_(description).slice(0, LIMITS.description),
    image_url: image.slice(0, LIMITS.url), favicon_url: favicon.slice(0, LIMITS.url), published_at: published,
    lang: langTag ? langTag[1].toLowerCase() : "", content_type: contentType, excerpt: excerpt
  };
}

/** ページを取得してメタデータを返す。失敗時は error_code を返す（例外にしない）。 */
function fetchPageMeta_(startUrl) {
  var url = startUrl;
  var res = null;
  for (var hop = 0; hop <= META_LIMITS.redirects; hop++) {
    if (!/^https?:\/\//i.test(url) || isBlockedHost_(hostOf_(url))) return { ok: false, error_code: "SSRF_BLOCKED", error_message: "取得できない宛先です。", page_url: url, http_status: "" };
    try {
      res = UrlFetchApp.fetch(url, {
        muteHttpExceptions: true, followRedirects: false,
        headers: { "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5", "Accept-Language": "ja,en;q=0.8" }
      });
    } catch (e) {
      var timeout = /timed? ?out|タイムアウト/i.test(String(e && e.message));
      return { ok: false, error_code: timeout ? "TIMEOUT" : "NETWORK", error_message: String(e && e.message).slice(0, 300), page_url: url, http_status: "" };
    }
    var status = res.getResponseCode();
    if (status >= 300 && status < 400) {
      var headers = res.getHeaders() || {};
      var next = resolveUrl_(url, headers.Location || headers.location || "");
      if (next === "") return { ok: false, error_code: "NETWORK", error_message: "リダイレクト先が不正です。", page_url: url, http_status: String(status) };
      url = next;
      res = null;
      continue;
    }
    break;
  }
  if (!res) return { ok: false, error_code: "NETWORK", error_message: "リダイレクトが多すぎます。", page_url: url, http_status: "" };

  var code = res.getResponseCode();
  if (code === 401 || code === 407) return { ok: false, error_code: "LOGIN_REQUIRED", error_message: "ログインが必要なページです。", page_url: url, http_status: String(code) };
  if (code === 403 || code === 429) return { ok: false, error_code: "BLOCKED_ROBOTS", error_message: "サイト側でアクセスが拒否されました。", page_url: url, http_status: String(code) };
  if (code >= 400) return { ok: false, error_code: "NETWORK", error_message: "ページを取得できませんでした（HTTP " + code + "）。", page_url: url, http_status: String(code) };

  var h = res.getHeaders() || {};
  var type = String(h["Content-Type"] || h["content-type"] || "").toLowerCase();
  if (type.indexOf("image/") === 0) return { ok: true, page_url: url, http_status: String(code), meta: { content_type: "image", image_url: url, favicon_url: resolveUrl_(url, "/favicon.ico") } };
  if (type.indexOf("application/pdf") === 0) return { ok: true, page_url: url, http_status: String(code), meta: { content_type: "pdf", favicon_url: resolveUrl_(url, "/favicon.ico") } };
  if (type !== "" && type.indexOf("html") === -1 && type.indexOf("text/") !== 0) return { ok: true, page_url: url, http_status: String(code), meta: { favicon_url: resolveUrl_(url, "/favicon.ico") } };

  var html = res.getContentText();
  var charset = (/charset\s*=\s*["']?([\w-]+)/i.exec(type) || /<meta\b[^>]*charset\s*=\s*["']?([\w-]+)/i.exec(html.slice(0, 4000)) || [])[1];
  if (charset && !/^utf-?8$/i.test(charset)) {
    try { html = res.getContentText(charset); } catch (e2) { /* 既定の文字コードのまま使う */ }
  }
  return { ok: true, page_url: url, http_status: String(code), meta: parseMeta_(html, url) };
}

/** items.fetchMeta: 取得はロックの外で行い、結果の書き込みだけロックする。 */
function fetchMetaAction_(user, p) {
  var target = ownLive_(database_(), user, "items", p.id);
  var result = fetchPageMeta_(target.original_url);

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw err_("BUSY", "混み合っています。少し待って再試行してください。");
  try {
    var db = database_();
    var item = ownLive_(db, user, "items", p.id);
    var now = now_();
    var patch = { capture_status: result.ok ? "completed" : "failed", updated_at: now };
    if (!result.ok && result.error_code !== "SSRF_BLOCKED" && !item.image_url) {
      patch.image_url = screenshotUrl_(item.original_url);
    }
    if (result.ok) {
      var m = result.meta;
      if (!m.image_url && !item.image_url && (!m.content_type || m.content_type === "page" || m.content_type === "article")) {
        m.image_url = screenshotUrl_(result.page_url || item.original_url);
      }
      ["description", "image_url", "favicon_url", "published_at", "lang", "content_type", "excerpt"].forEach(function (k) {
        if (m[k] !== undefined && m[k] !== "") patch[k] = m[k];
      });
      if (m.title && item.title === "") patch.title = m.title;
    }
    var captures = db.table("captures").rows.filter(function (c) {
      return c.item_id === item.id && c.user_id === user.id && c.archive_status === "pending";
    });
    captures.forEach(function (c, i) {
      var last = i === captures.length - 1;
      db.update("captures", c, {
        archive_status: last && result.ok ? "completed" : "failed", captured_at: now,
        page_title: last && result.ok ? (result.meta.title || "") : "", page_url: result.page_url || item.original_url,
        http_status: result.http_status || "", error_code: last ? (result.error_code || "") : "SUPERSEDED",
        error_message: last ? (result.error_message || "") : ""
      });
      patch.latest_capture_id = c.id;
    });
    db.table("capture_jobs").rows.forEach(function (j) {
      if (j.item_id === item.id && j.user_id === user.id && (j.status === "pending" || j.status === "processing")) {
        db.update("capture_jobs", j, {
          status: result.ok ? "completed" : "failed", started_at: j.started_at || now, completed_at: now,
          error_code: result.error_code || "", error_message: result.error_message || ""
        });
      }
    });
    db.update("items", item, patch);
    db.flush();
    return { item: publicRow_(item), ok: result.ok, error_code: result.error_code || "", error_message: result.error_message || "" };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 画像が見つからないページのための、外部サービスによるスクリーンショットのURL。
 * WordPress.com の mShots（無料・登録不要）。ページのURLがそのサービスに送られる。
 * 使わない場合は Script Properties に SCREENSHOT_SERVICE=off を設定する。
 */
function screenshotUrl_(pageUrl) {
  if (String(props_().getProperty("SCREENSHOT_SERVICE") || "").toLowerCase() === "off") return "";
  return "https://s.wordpress.com/mshots/v1/" + encodeURIComponent(pageUrl) + "?w=1200&h=900";
}
