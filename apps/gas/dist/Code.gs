// INTERNET CABINET — Google Apps Script
// このファイルは apps/gas/src から生成されます。直接編集しないでください。

// ===== 01_schema.js =====
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
  "tags", "new_tags", "summary", "note", "apply"
];
var SCHEMA_VERSION = 1;

var LIMITS = { url: 2000, title: 500, description: 2000, note: 20000, summary: 2000, tagName: 60, name: 120, tagsPerItem: 30 };

function columnsOf_(name) {
  return TABLE_COLUMNS[name].concat(COMMON_COLUMNS);
}

// ===== 02_util.js =====
function err_(code, message, extra) {
  var e = new Error(message || code);
  e.code = code;
  if (extra) e.extra = extra;
  return e;
}

function now_() {
  return new Date().toISOString();
}

function sha256Hex_(text) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8);
  var out = "";
  for (var i = 0; i < bytes.length; i++) {
    var b = bytes[i] < 0 ? bytes[i] + 256 : bytes[i];
    out += (b < 16 ? "0" : "") + b.toString(16);
  }
  return out;
}

/**
 * セルに文字列として書き込む値。= + - @ ' などで始まる値は、先頭に ' を付けて
 * 数式として解釈されないようにする（' はシートが取り除き、読み出し時は元の値に戻る）。
 */
function toCell_(value) {
  var s = value === null || value === undefined ? "" : String(value);
  return /^[=+\-@'\t\r\n]/.test(s) ? "'" + s : s;
}

function str_(value, max, field) {
  var s = value === null || value === undefined ? "" : String(value);
  if (max && s.length > max) throw err_("INVALID", field + " が長すぎます（最大 " + max + " 文字）");
  return s;
}

function domainOf_(url) {
  var m = /^https?:\/\/([^\/?#:]+)/i.exec(url);
  return m ? m[1].toLowerCase().replace(/^www\./, "") : "";
}

/** タグ名の表記をそろえる。前後の空白を除き、連続する空白を1つにする。 */
function cleanTagName_(name) {
  return String(name === null || name === undefined ? "" : name).replace(/[\s　]+/g, " ").trim();
}

function tagKey_(name) {
  return cleanTagName_(name).toLowerCase();
}

// ===== 03_db.js =====
/**
 * Sheets をテーブルとして扱う薄い層。1リクエスト内で各シートを1回だけ読み、
 * 変更は flush() でまとめて書き込む。値はすべて文字列。
 */
function Db_(spreadsheet) {
  this.ss = spreadsheet;
  this.tables = {};
  this.rev = null;
  this.revChanged = false;
}

Db_.prototype.sheet_ = function (name) {
  var sheet = this.ss.getSheetByName(name);
  if (!sheet) throw err_("NOT_SETUP", "シート " + name + " がありません。初期セットアップを実行してください。");
  return sheet;
};

Db_.prototype.table = function (name) {
  if (this.tables[name]) return this.tables[name];
  var sheet = this.sheet_(name);
  var values = sheet.getDataRange().getValues();
  var header = (values[0] || []).map(String);
  var expected = columnsOf_(name);
  for (var c = 0; c < expected.length; c++) {
    if (header.indexOf(expected[c]) === -1) {
      throw err_("SCHEMA", name + " に列 " + expected[c] + " がありません。");
    }
  }
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var row = {};
    var empty = true;
    for (var j = 0; j < header.length; j++) {
      var v = values[i][j];
      var s = v === null || v === undefined ? "" : String(v);
      if (s !== "") empty = false;
      row[header[j]] = s;
    }
    if (empty) continue;
    row._row = i + 1;
    rows.push(row);
  }
  var t = { name: name, sheet: sheet, header: header, rows: rows, dirty: [], appended: [], lastRow: values.length };
  this.tables[name] = t;
  return t;
};

/** 論理削除されていない自分の行。 */
Db_.prototype.live = function (name, userId) {
  return this.table(name).rows.filter(function (r) {
    return r.deleted_at === "" && r.user_id === userId;
  });
};

Db_.prototype.nextRev = function () {
  if (this.rev === null) this.rev = Number(this.getMeta("rev_counter") || "0");
  this.rev += 1;
  this.revChanged = true;
  return String(this.rev);
};

Db_.prototype.currentRev = function () {
  if (this.rev === null) this.rev = Number(this.getMeta("rev_counter") || "0");
  return this.rev;
};

Db_.prototype.insert = function (name, values) {
  var t = this.table(name);
  var row = {};
  for (var j = 0; j < t.header.length; j++) row[t.header[j]] = "";
  for (var k in values) if (k in row) row[k] = values[k] === null || values[k] === undefined ? "" : String(values[k]);
  row.version = "1";
  row.rev = this.nextRev();
  row.deleted_at = "";
  row._row = 0;
  t.rows.push(row);
  t.appended.push(row);
  return row;
};

/** 行を更新する。version と rev を進める。 */
Db_.prototype.update = function (name, row, patch) {
  var t = this.table(name);
  for (var k in patch) if (k in row && k !== "_row") row[k] = patch[k] === null || patch[k] === undefined ? "" : String(patch[k]);
  row.version = String(Number(row.version || "0") + 1);
  row.rev = this.nextRev();
  if (row._row > 0 && t.dirty.indexOf(row) === -1) t.dirty.push(row);
  return row;
};

Db_.prototype.checkVersion = function (name, row, expected) {
  if (expected === null || expected === undefined || String(expected) !== row.version) {
    throw err_("CONFLICT", "他の端末で更新されています。", { table: name, current: publicRow_(row) });
  }
};

Db_.prototype.flush = function () {
  for (var name in this.tables) {
    var t = this.tables[name];
    var width = t.header.length;
    for (var i = 0; i < t.dirty.length; i++) {
      t.sheet.getRange(t.dirty[i]._row, 1, 1, width).setValues([rowCells_(t, t.dirty[i])]);
    }
    if (t.appended.length > 0) {
      var start = t.lastRow + 1;
      var need = start + t.appended.length - 1 - t.sheet.getMaxRows();
      if (need > 0) t.sheet.insertRowsAfter(t.sheet.getMaxRows(), need);
      var range = t.sheet.getRange(start, 1, t.appended.length, width);
      range.setNumberFormat("@");
      range.setValues(t.appended.map(function (r) { return rowCells_(t, r); }));
      for (var a = 0; a < t.appended.length; a++) t.appended[a]._row = start + a;
      t.lastRow += t.appended.length;
    }
    t.dirty = [];
    t.appended = [];
  }
  if (this.revChanged) {
    this.setMeta("rev_counter", String(this.rev));
    this.revChanged = false;
  }
};

function rowCells_(t, row) {
  return t.header.map(function (h) { return toCell_(row[h]); });
}

function publicRow_(row) {
  var out = {};
  for (var k in row) if (k !== "_row") out[k] = row[k];
  return out;
}

Db_.prototype.metaRows_ = function () {
  if (!this.meta) {
    var sheet = this.sheet_(META_SHEET);
    this.meta = { sheet: sheet, values: sheet.getDataRange().getValues() };
  }
  return this.meta;
};

Db_.prototype.getMeta = function (key) {
  var m = this.metaRows_();
  for (var i = 1; i < m.values.length; i++) if (String(m.values[i][0]) === key) return String(m.values[i][1]);
  return "";
};

Db_.prototype.setMeta = function (key, value) {
  var m = this.metaRows_();
  for (var i = 1; i < m.values.length; i++) {
    if (String(m.values[i][0]) === key) {
      m.values[i][1] = value;
      m.sheet.getRange(i + 1, 2, 1, 1).setValues([[toCell_(value)]]);
      return;
    }
  }
  var rowNum = m.values.length + 1;
  if (rowNum > m.sheet.getMaxRows()) m.sheet.insertRowsAfter(m.sheet.getMaxRows(), 1);
  var range = m.sheet.getRange(rowNum, 1, 1, 2);
  range.setNumberFormat("@");
  range.setValues([[key, toCell_(value)]]);
  m.values.push([key, value]);
};

// ===== 04_actions.js =====
/**
 * データAPIの本体。入口（doPost / api）で認証を済ませたあとに呼ばれる。
 * すべての読み書きは user.id の行に限定する。
 */
var READ_ACTIONS = { "sync.pull": true, "ping": true };

function handle_(db, user, action, params) {
  var p = params || {};
  switch (action) {
    case "ping": return { ok: true, rev: db.currentRev(), schema_version: db.getMeta("schema_version") };
    case "sync.pull": return syncPull_(db, user, p);
    case "items.create": return itemsCreate_(db, user, p);
    case "items.update": return itemsUpdate_(db, user, p);
    case "items.delete": return softDelete_(db, user, "items", p, true);
    case "items.restore": return itemsRestore_(db, user, p);
    case "items.refetch": return itemsRefetch_(db, user, p);
    case "items.setTags": return { item_id: p.id, tags: setItemTags_(db, user, p.id, p.tags) };
    case "tags.update": return tagsUpdate_(db, user, p);
    case "tags.delete": return tagsDelete_(db, user, p);
    case "tags.merge": return tagsMerge_(db, user, p);
    case "collections.create": return collectionsCreate_(db, user, p);
    case "collections.update": return collectionsUpdate_(db, user, p);
    case "collections.delete": return collectionsDelete_(db, user, p);
    case "collections.addItems": return collectionsAddItems_(db, user, p);
    case "collections.removeItems": return collectionsRemoveItems_(db, user, p);
    case "collections.reorder": return collectionsReorder_(db, user, p);
    default: throw err_("UNKNOWN_ACTION", "不明な操作です: " + action);
  }
}

function own_(db, user, table, id) {
  var rows = db.table(table).rows;
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].id === String(id) && rows[i].user_id === user.id) return rows[i];
  }
  throw err_("NOT_FOUND", table + " に該当する行がありません。");
}

function ownLive_(db, user, table, id) {
  var row = own_(db, user, table, id);
  if (row.deleted_at !== "") throw err_("NOT_FOUND", "削除済みです。");
  return row;
}

// ---------- sync ----------

function syncPull_(db, user, p) {
  var since = Number(p.since || 0);
  var limit = Math.min(Math.max(Number(p.limit || 2000), 1), 5000);
  var changed = [];
  SYNC_TABLES.forEach(function (name) {
    db.table(name).rows.forEach(function (r) {
      if (r.user_id === user.id && Number(r.rev) > since) changed.push({ t: name, r: r });
    });
  });
  changed.sort(function (a, b) { return Number(a.r.rev) - Number(b.r.rev); });
  var page = changed.slice(0, limit);
  var tables = {};
  page.forEach(function (c) {
    (tables[c.t] = tables[c.t] || []).push(publicRow_(c.r));
  });
  var more = changed.length > page.length;
  return {
    tables: tables,
    cursor: page.length > 0 ? Number(page[page.length - 1].r.rev) : since,
    more: more,
    rev: db.currentRev()
  };
}

// ---------- items ----------

function itemsCreate_(db, user, p) {
  var original = str_(p.original_url, LIMITS.url, "URL").trim();
  var normalized = str_(p.normalized_url, LIMITS.url, "URL").trim();
  if (!/^https?:\/\/[^\s]+$/i.test(original) || !/^https?:\/\/[^\s]+$/i.test(normalized)) {
    throw err_("INVALID_URL", "http または https のURLを指定してください。");
  }
  var hash = sha256Hex_(normalized);
  var now = now_();
  var existing = db.live("items", user.id).filter(function (r) { return r.url_hash === hash; })[0];
  var item = existing;
  var duplicate = !!existing;
  if (duplicate && p.recapture === false) return { item: publicRow_(item), duplicate: true };

  if (!item) {
    item = db.insert("items", {
      id: Utilities.getUuid(), user_id: user.id, original_url: original, normalized_url: normalized,
      url_hash: hash, title: str_(p.title, LIMITS.title, "タイトル"), domain: domainOf_(normalized),
      content_type: "page", user_note: str_(p.user_note, LIMITS.note, "メモ"), is_favorite: "false",
      capture_status: "pending", created_at: now, updated_at: now
    });
  }
  var capture = db.insert("captures", {
    id: Utilities.getUuid(), item_id: item.id, user_id: user.id, captured_at: now,
    archive_status: "pending", page_url: original
  });
  var job = db.insert("capture_jobs", {
    id: Utilities.getUuid(), item_id: item.id, capture_id: capture.id, user_id: user.id,
    status: "pending", trigger: duplicate ? "recapture" : "new", retry_count: "0", queued_at: now
  });
  if (duplicate) db.update("items", item, { capture_status: "pending", updated_at: now });
  if (!duplicate && p.tags && p.tags.length) setItemTags_(db, user, item.id, p.tags);
  if (!duplicate && p.collection_ids && p.collection_ids.length) {
    p.collection_ids.forEach(function (cid) {
      collectionsAddItems_(db, user, { collection_id: cid, item_ids: [item.id] });
    });
  }
  return { item: publicRow_(item), capture: publicRow_(capture), job: publicRow_(job), duplicate: duplicate };
}

var ITEM_EDITABLE = {
  title: LIMITS.title, description: LIMITS.description, user_note: LIMITS.note, summary: LIMITS.summary
};

function itemsUpdate_(db, user, p) {
  var item = ownLive_(db, user, "items", p.id);
  db.checkVersion("items", item, p.version);
  var patch = {};
  var src = p.patch || {};
  for (var k in ITEM_EDITABLE) if (k in src) patch[k] = str_(src[k], ITEM_EDITABLE[k], k);
  if ("is_favorite" in src) patch.is_favorite = src.is_favorite === true || src.is_favorite === "true" ? "true" : "false";
  patch.updated_at = now_();
  return { item: publicRow_(db.update("items", item, patch)) };
}

function softDelete_(db, user, table, p, withVersion) {
  var row = ownLive_(db, user, table, p.id);
  if (withVersion && p.version !== undefined) db.checkVersion(table, row, p.version);
  db.update(table, row, { deleted_at: now_() });
  var out = {};
  out[table] = publicRow_(row);
  return out;
}

function itemsRestore_(db, user, p) {
  var item = own_(db, user, "items", p.id);
  if (item.deleted_at === "") return { item: publicRow_(item) };
  var clash = db.live("items", user.id).filter(function (r) { return r.url_hash === item.url_hash; })[0];
  if (clash) throw err_("DUPLICATE", "同じURLのアイテムが既にあります。");
  return { item: publicRow_(db.update("items", item, { deleted_at: "", updated_at: now_() })) };
}

// ---------- tags ----------

function ensureTag_(db, user, name) {
  var clean = cleanTagName_(name);
  if (clean === "") return null;
  str_(clean, LIMITS.tagName, "タグ名");
  var key = tagKey_(clean);
  var found = db.live("tags", user.id).filter(function (t) { return tagKey_(t.name) === key; })[0];
  if (found) return found;
  var now = now_();
  return db.insert("tags", { id: Utilities.getUuid(), user_id: user.id, name: clean, color: "", created_at: now, updated_at: now });
}

/** アイテムのタグを names の集合に置き換える。戻り値は確定したタグ名。 */
function setItemTags_(db, user, itemId, names) {
  var item = ownLive_(db, user, "items", itemId);
  if (!Array.isArray(names)) throw err_("INVALID", "tags は配列で指定してください。");
  var wanted = {};
  var order = [];
  names.forEach(function (n) {
    var tag = ensureTag_(db, user, n);
    if (tag && !wanted[tag.id]) { wanted[tag.id] = tag; order.push(tag); }
  });
  if (order.length > LIMITS.tagsPerItem) throw err_("INVALID", "タグは " + LIMITS.tagsPerItem + " 個までです。");
  var now = now_();
  var links = db.table("item_tags").rows.filter(function (r) { return r.item_id === item.id && r.user_id === user.id; });
  var seen = {};
  links.forEach(function (link) {
    seen[link.tag_id] = true;
    var want = !!wanted[link.tag_id];
    if (want && link.deleted_at !== "") db.update("item_tags", link, { deleted_at: "" });
    if (!want && link.deleted_at === "") db.update("item_tags", link, { deleted_at: now });
  });
  order.forEach(function (tag) {
    if (!seen[tag.id]) db.insert("item_tags", { item_id: item.id, tag_id: tag.id, user_id: user.id, created_at: now });
  });
  return order.map(function (t) { return t.name; });
}

function tagsUpdate_(db, user, p) {
  var tag = ownLive_(db, user, "tags", p.id);
  db.checkVersion("tags", tag, p.version);
  var patch = { updated_at: now_() };
  var src = p.patch || {};
  if ("name" in src) {
    var clean = cleanTagName_(src.name);
    if (clean === "") throw err_("INVALID", "タグ名が空です。");
    str_(clean, LIMITS.tagName, "タグ名");
    var key = tagKey_(clean);
    var clash = db.live("tags", user.id).filter(function (t) { return t.id !== tag.id && tagKey_(t.name) === key; })[0];
    if (clash) throw err_("DUPLICATE", "同じ名前のタグがあります。統合を使ってください。", { tag_id: clash.id });
    patch.name = clean;
  }
  if ("color" in src) {
    var color = String(src.color || "");
    if (color !== "" && !/^#[0-9a-fA-F]{6}$/.test(color)) throw err_("INVALID", "色は #RRGGBB で指定してください。");
    patch.color = color;
  }
  return { tag: publicRow_(db.update("tags", tag, patch)) };
}

function tagsDelete_(db, user, p) {
  var tag = ownLive_(db, user, "tags", p.id);
  var now = now_();
  db.table("item_tags").rows.forEach(function (link) {
    if (link.tag_id === tag.id && link.user_id === user.id && link.deleted_at === "") db.update("item_tags", link, { deleted_at: now });
  });
  db.update("tags", tag, { deleted_at: now });
  return { tag: publicRow_(tag) };
}

/** from のタグを to に統合する。 */
function tagsMerge_(db, user, p) {
  var from = ownLive_(db, user, "tags", p.from_id);
  var to = ownLive_(db, user, "tags", p.to_id);
  if (from.id === to.id) throw err_("INVALID", "同じタグは統合できません。");
  var now = now_();
  var links = db.table("item_tags").rows.filter(function (r) { return r.user_id === user.id; });
  var hasTo = {};
  links.forEach(function (l) { if (l.tag_id === to.id) hasTo[l.item_id] = l; });
  var moved = 0;
  links.forEach(function (l) {
    if (l.tag_id !== from.id || l.deleted_at !== "") return;
    db.update("item_tags", l, { deleted_at: now });
    var existing = hasTo[l.item_id];
    if (existing) {
      if (existing.deleted_at !== "") db.update("item_tags", existing, { deleted_at: "" });
    } else {
      db.insert("item_tags", { item_id: l.item_id, tag_id: to.id, user_id: user.id, created_at: now });
    }
    moved++;
  });
  db.update("tags", from, { deleted_at: now });
  return { tag: publicRow_(to), moved: moved };
}

// ---------- collections ----------

function collectionsCreate_(db, user, p) {
  var name = str_(p.name, LIMITS.name, "名前").trim();
  if (name === "") throw err_("INVALID", "名前が空です。");
  var now = now_();
  var max = 0;
  db.live("collections", user.id).forEach(function (c) { max = Math.max(max, Number(c.sort_order || 0)); });
  var row = db.insert("collections", {
    id: Utilities.getUuid(), user_id: user.id, name: name,
    description: str_(p.description, LIMITS.description, "説明"), sort_order: String(max + 1),
    created_at: now, updated_at: now
  });
  return { collection: publicRow_(row) };
}

function collectionsUpdate_(db, user, p) {
  var c = ownLive_(db, user, "collections", p.id);
  db.checkVersion("collections", c, p.version);
  var src = p.patch || {};
  var patch = { updated_at: now_() };
  if ("name" in src) {
    patch.name = str_(src.name, LIMITS.name, "名前").trim();
    if (patch.name === "") throw err_("INVALID", "名前が空です。");
  }
  if ("description" in src) patch.description = str_(src.description, LIMITS.description, "説明");
  if ("cover_image_file_id" in src) patch.cover_image_file_id = str_(src.cover_image_file_id, 200, "カバー画像");
  if ("sort_order" in src) patch.sort_order = String(Number(src.sort_order) || 0);
  return { collection: publicRow_(db.update("collections", c, patch)) };
}

function collectionsDelete_(db, user, p) {
  var c = ownLive_(db, user, "collections", p.id);
  var now = now_();
  db.table("collection_items").rows.forEach(function (l) {
    if (l.collection_id === c.id && l.user_id === user.id && l.deleted_at === "") db.update("collection_items", l, { deleted_at: now });
  });
  db.update("collections", c, { deleted_at: now });
  return { collection: publicRow_(c) };
}

function collectionLinks_(db, user, collectionId) {
  return db.table("collection_items").rows.filter(function (r) {
    return r.collection_id === collectionId && r.user_id === user.id;
  });
}

function collectionsAddItems_(db, user, p) {
  var c = ownLive_(db, user, "collections", p.collection_id);
  var ids = p.item_ids || [];
  var links = collectionLinks_(db, user, c.id);
  var byItem = {};
  var max = 0;
  links.forEach(function (l) {
    byItem[l.item_id] = l;
    if (l.deleted_at === "") max = Math.max(max, Number(l.sort_order || 0));
  });
  var now = now_();
  var added = 0;
  ids.forEach(function (id) {
    var item = ownLive_(db, user, "items", id);
    var link = byItem[item.id];
    if (link && link.deleted_at === "") return;
    max += 1;
    if (link) db.update("collection_items", link, { deleted_at: "", sort_order: String(max), added_at: now });
    else byItem[item.id] = db.insert("collection_items", { collection_id: c.id, item_id: item.id, user_id: user.id, sort_order: String(max), added_at: now });
    added++;
  });
  return { collection_id: c.id, added: added };
}

function collectionsRemoveItems_(db, user, p) {
  var c = ownLive_(db, user, "collections", p.collection_id);
  var remove = {};
  (p.item_ids || []).forEach(function (id) { remove[String(id)] = true; });
  var now = now_();
  var removed = 0;
  collectionLinks_(db, user, c.id).forEach(function (l) {
    if (remove[l.item_id] && l.deleted_at === "") { db.update("collection_items", l, { deleted_at: now }); removed++; }
  });
  return { collection_id: c.id, removed: removed };
}

/** item_ids の順に並べ替える。指定されなかったアイテムは後ろに元の順で残す。 */
function collectionsReorder_(db, user, p) {
  var c = ownLive_(db, user, "collections", p.collection_id);
  var links = collectionLinks_(db, user, c.id).filter(function (l) { return l.deleted_at === ""; });
  var pos = {};
  (p.item_ids || []).forEach(function (id, i) { pos[String(id)] = i; });
  links.sort(function (a, b) {
    var pa = a.item_id in pos ? pos[a.item_id] : 1e9 + Number(a.sort_order || 0);
    var pb = b.item_id in pos ? pos[b.item_id] : 1e9 + Number(b.sort_order || 0);
    return pa - pb;
  });
  links.forEach(function (l, i) {
    if (l.sort_order !== String(i + 1)) db.update("collection_items", l, { sort_order: String(i + 1) });
  });
  return { collection_id: c.id, count: links.length };
}

/** 再取得の準備。新しい取得履歴（capture / job）を作る。実際の取得は items.fetchMeta で行う。 */
function itemsRefetch_(db, user, p) {
  var item = ownLive_(db, user, "items", p.id);
  var now = now_();
  var capture = db.insert("captures", {
    id: Utilities.getUuid(), item_id: item.id, user_id: user.id, captured_at: now,
    archive_status: "pending", page_url: item.original_url
  });
  db.insert("capture_jobs", {
    id: Utilities.getUuid(), item_id: item.id, capture_id: capture.id, user_id: user.id,
    status: "pending", trigger: "recapture", retry_count: "0", queued_at: now
  });
  db.update("items", item, { capture_status: "pending", updated_at: now });
  return { item: publicRow_(item) };
}

// ===== 05_setup.js =====
/** シートを作成・補修する。何度実行しても安全。既存データは消さない。 */
function setupDatabase_(ss) {
  var created = [];
  TABLE_NAMES.forEach(function (name) {
    if (ensureSheet_(ss, name, columnsOf_(name), true)) created.push(name);
  });
  if (ensureSheet_(ss, META_SHEET, ["key", "value"], true)) created.push(META_SHEET);
  if (ensureSheet_(ss, CURATION_SHEET, CURATION_COLUMNS, false)) created.push(CURATION_SHEET);

  var db = new Db_(ss);
  if (db.getMeta("schema_version") === "") db.setMeta("schema_version", String(SCHEMA_VERSION));
  if (db.getMeta("rev_counter") === "") db.setMeta("rev_counter", "0");

  // 新規スプレッドシートに最初からある空のシートを片付ける。
  ss.getSheets().forEach(function (sheet) {
    var name = sheet.getName();
    var known = TABLE_COLUMNS[name] || name === META_SHEET || name === CURATION_SHEET;
    if (!known && sheet.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(sheet);
  });
  return { created: created };
}

/** シートがなければ作る。あれば不足列を右端に足す。作成したら true。 */
function ensureSheet_(ss, name, columns, plainText) {
  var sheet = ss.getSheetByName(name);
  var isNew = !sheet;
  if (isNew) {
    sheet = ss.insertSheet(name);
    if (sheet.getMaxColumns() > columns.length) sheet.deleteColumns(columns.length + 1, sheet.getMaxColumns() - columns.length);
    if (sheet.getMaxColumns() < columns.length) sheet.insertColumnsAfter(sheet.getMaxColumns(), columns.length - sheet.getMaxColumns());
    if (sheet.getMaxRows() > 50) sheet.deleteRows(51, sheet.getMaxRows() - 50);
    writeHeader_(sheet, columns, plainText);
    return true;
  }
  var header = sheet.getLastColumn() > 0 ? sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String) : [];
  if (header.join("") === "") {
    if (sheet.getMaxColumns() < columns.length) sheet.insertColumnsAfter(sheet.getMaxColumns(), columns.length - sheet.getMaxColumns());
    writeHeader_(sheet, columns, plainText);
    return true;
  }
  var missing = columns.filter(function (c) { return header.indexOf(c) === -1; });
  if (missing.length > 0) {
    var start = header.length + 1;
    var need = start + missing.length - 1 - sheet.getMaxColumns();
    if (need > 0) sheet.insertColumnsAfter(sheet.getMaxColumns(), need);
    if (plainText) sheet.getRange(1, start, sheet.getMaxRows(), missing.length).setNumberFormat("@");
    sheet.getRange(1, start, 1, missing.length).setValues([missing]).setFontWeight("bold");
  }
  return false;
}

function writeHeader_(sheet, columns, plainText) {
  if (plainText) sheet.getRange(1, 1, sheet.getMaxRows(), columns.length).setNumberFormat("@");
  sheet.getRange(1, 1, 1, columns.length).setValues([columns]).setFontWeight("bold");
  sheet.setFrozenRows(1);
}

// ===== 06_auth.js =====
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

// ===== 07_curation.js =====
/** 整理シートを現在のデータで作り直す。編集欄には現在の値を入れておく。 */
function curationRefresh_(db, user) {
  var tagName = {};
  db.live("tags", user.id).forEach(function (t) { tagName[t.id] = t.name; });
  var tagsOf = {};
  db.live("item_tags", user.id).forEach(function (l) {
    if (tagName[l.tag_id]) (tagsOf[l.item_id] = tagsOf[l.item_id] || []).push(tagName[l.tag_id]);
  });
  var items = db.live("items", user.id).sort(function (a, b) { return a.created_at < b.created_at ? 1 : -1; });
  var rows = items.map(function (it) {
    var tags = (tagsOf[it.id] || []).sort().join(", ");
    return [it.id, it.title, it.original_url, it.domain, it.content_type, it.excerpt, it.created_at,
      tags, tags, it.summary, it.user_note, false].map(function (v) { return typeof v === "boolean" ? v : toCell_(v); });
  });
  var sheet = db.sheet_(CURATION_SHEET);
  var width = CURATION_COLUMNS.length;
  if (sheet.getLastRow() > 1) sheet.getRange(2, 1, sheet.getLastRow() - 1, width).clearContent();
  if (rows.length > 0) {
    var need = rows.length + 1 - sheet.getMaxRows();
    if (need > 0) sheet.insertRowsAfter(sheet.getMaxRows(), need);
    sheet.getRange(2, 1, rows.length, width - 1).setNumberFormat("@");
    sheet.getRange(2, 1, rows.length, width).setValues(rows);
    sheet.getRange(2, width, rows.length, 1).insertCheckboxes();
  }
  return { count: rows.length };
}

function splitTags_(text) {
  var seen = {};
  var out = [];
  String(text || "").split(/[,、，\n]/).forEach(function (part) {
    var name = cleanTagName_(part);
    var key = name.toLowerCase();
    if (name !== "" && !seen[key]) { seen[key] = true; out.push(name); }
  });
  return out;
}

/** apply にチェックがある行の変更内容を調べる。dryRun なら書き込まない。 */
function curationApply_(db, user, dryRun) {
  var sheet = db.sheet_(CURATION_SHEET);
  var values = sheet.getDataRange().getValues();
  var header = (values[0] || []).map(String);
  var col = {};
  CURATION_COLUMNS.forEach(function (c) {
    col[c] = header.indexOf(c);
    if (col[c] === -1) throw err_("SCHEMA", "整理シートに列 " + c + " がありません。");
  });
  var result = { rows: 0, tagChanges: 0, summaryChanges: 0, noteChanges: 0, skipped: [], appliedRows: [] };
  for (var i = 1; i < values.length; i++) {
    var v = values[i];
    if (v[col.apply] !== true && String(v[col.apply]).toUpperCase() !== "TRUE") continue;
    var id = String(v[col.item_id] || "");
    var item;
    try {
      item = ownLive_(db, user, "items", id);
    } catch (e) {
      result.skipped.push({ row: i + 1, reason: "アイテムが見つかりません" });
      continue;
    }
    try {
      var wanted = splitTags_(v[col.new_tags]);
      var current = splitTags_(v[col.tags]);
      var same = wanted.length === current.length && wanted.map(tagKey_).sort().join("\n") === current.map(tagKey_).sort().join("\n");
      var summary = str_(v[col.summary], LIMITS.summary, "要約");
      var note = str_(v[col.note], LIMITS.note, "メモ");
      var patch = {};
      if (summary !== item.summary) { patch.summary = summary; result.summaryChanges++; }
      if (note !== item.user_note) { patch.user_note = note; result.noteChanges++; }
      if (!same) result.tagChanges++;
      if (!dryRun) {
        if (!same) setItemTags_(db, user, item.id, wanted);
        if (patch.summary !== undefined || patch.user_note !== undefined) {
          patch.updated_at = now_();
          db.update("items", item, patch);
        }
      }
      result.rows++;
      result.appliedRows.push(i + 1);
    } catch (e2) {
      result.skipped.push({ row: i + 1, reason: e2.message });
    }
  }
  return result;
}

// ===== 08_main.js =====
function database_() {
  return new Db_(SpreadsheetApp.getActiveSpreadsheet());
}

/** 認証済みの利用者として1操作を実行する。書き込みはロックで直列化する。 */
function run_(user, action, params) {
  if (READ_ACTIONS[action]) return handle_(database_(), user, action, params);
  if (action === "items.fetchMeta") return fetchMetaAction_(user, params || {});
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw err_("BUSY", "混み合っています。少し待って再試行してください。");
  try {
    var db = database_();
    var data = handle_(db, user, action, params);
    db.flush();
    return data;
  } finally {
    lock.releaseLock();
  }
}

function respond_(fn) {
  try {
    return { ok: true, data: fn() };
  } catch (e) {
    var code = e && e.code ? e.code : "INTERNAL";
    if (code === "INTERNAL") console.error(e && e.stack ? e.stack : e);
    return { ok: false, error: { code: code, message: code === "INTERNAL" ? "内部エラーが発生しました。" : e.message, extra: e.extra || null } };
  }
}

/** ウェブアプリの入口。本文は JSON（Content-Type は text/plain で送る）。 */
function doPost(e) {
  var body = respond_(function () {
    var req;
    try {
      req = JSON.parse(e && e.postData ? e.postData.contents : "");
    } catch (parseError) {
      throw err_("INVALID", "リクエストの形式が正しくありません。");
    }
    var user = verifyIdToken_(req.id_token);
    return run_(user, String(req.action || ""), req.params);
  });
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
}

/** Apps Script API（scripts.run）の入口。 */
function api(request) {
  return respond_(function () {
    var user = userFromEmail_(Session.getActiveUser().getEmail());
    var req = request || {};
    return run_(user, String(req.action || ""), req.params);
  });
}

// ---------- スプレッドシートのメニュー ----------

/** メニューを追加する。インストール型トリガーから呼ばれる（複数アカウントでログイン中でも動く）。 */
function cabinetMenu() {
  SpreadsheetApp.getUi().createMenu("Cabinet")
    .addItem("初期セットアップ", "menuSetup")
    .addSeparator()
    .addItem("整理シートを更新", "menuCurationRefresh")
    .addItem("整理を反映", "menuCurationApply")
    .addToUi();
}

function ensureMenuTrigger_() {
  var exists = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === "cabinetMenu"; });
  if (!exists) ScriptApp.newTrigger("cabinetMenu").forSpreadsheet(SpreadsheetApp.getActiveSpreadsheet()).onOpen().create();
}

function menuUser_() {
  return userFromEmail_(Session.getActiveUser().getEmail());
}

/**
 * 初期セットアップ。エディタから実行する（画面のダイアログを使わないので、どこから実行しても動く）。
 * 何度実行しても安全。
 */
function setup() {
  var p = props_();
  if (!p.getProperty("ALLOWED_EMAIL")) p.setProperty("ALLOWED_EMAIL", Session.getActiveUser().getEmail());
  var result = setupDatabase_(SpreadsheetApp.getActiveSpreadsheet());
  ensureMenuTrigger_();
  var message = result.created.length > 0 ? "作成したシート: " + result.created.join(", ") : "すべてのシートは作成済みです。";
  console.log("セットアップ完了。" + message);
  return message;
}

/** メニューからの初期セットアップ。 */
function menuSetup() {
  var message = setup();
  try {
    cabinetMenu();
    var ui = SpreadsheetApp.getUi();
    ui.alert("セットアップ完了", message, ui.ButtonSet.OK);
  } catch (e) {
    // エディタから実行した場合など、画面を出せない状況では何もしない。
  }
}

function menuCurationRefresh() {
  var ui = SpreadsheetApp.getUi();
  var answer = ui.alert("整理シートを更新", "整理シートの内容を現在のデータで作り直します。未反映の編集は失われます。", ui.ButtonSet.OK_CANCEL);
  if (answer !== ui.Button.OK) return;
  var result = curationRefresh_(database_(), menuUser_());
  ui.alert(result.count + " 件を書き出しました。");
}

function menuCurationApply() {
  var ui = SpreadsheetApp.getUi();
  var user = menuUser_();
  var preview = curationApply_(database_(), user, true);
  if (preview.rows === 0) {
    ui.alert("反映する行がありません。apply 列にチェックを入れてください。");
    return;
  }
  var message = "対象 " + preview.rows + " 行\nタグの変更 " + preview.tagChanges + " 件\n要約の変更 " + preview.summaryChanges + " 件\nメモの変更 " + preview.noteChanges + " 件"
    + (preview.skipped.length > 0 ? "\nスキップ " + preview.skipped.length + " 行" : "") + "\n\n反映しますか？";
  if (ui.alert("整理を反映", message, ui.ButtonSet.OK_CANCEL) !== ui.Button.OK) return;

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) { ui.alert("混み合っています。少し待って再試行してください。"); return; }
  var result;
  try {
    var db = database_();
    result = curationApply_(db, user, false);
    db.flush();
    var sheet = db.sheet_(CURATION_SHEET);
    result.appliedRows.forEach(function (r) { sheet.getRange(r, CURATION_COLUMNS.length, 1, 1).setValues([[false]]); });
  } finally {
    lock.releaseLock();
  }
  ui.alert(result.rows + " 行を反映しました。" + (result.skipped.length > 0 ? "\nスキップ: " + result.skipped.map(function (s) { return s.row + "行目（" + s.reason + "）"; }).join("、") : ""));
}

// ===== 09_meta.js =====
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
    if (result.ok) {
      var m = result.meta;
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
