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
    // 端末側で採番したIDを受け取ると、応答を待たずにカードを表示できる。
    var newId = String(p.id || "").toLowerCase();
    if (newId !== "") {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(newId)) throw err_("INVALID", "IDの形式が正しくありません。");
      if (db.table("items").rows.some(function (r) { return r.id === newId; })) throw err_("DUPLICATE", "同じIDのアイテムがあります。");
    }
    item = db.insert("items", {
      id: newId || Utilities.getUuid(), user_id: user.id, original_url: original, normalized_url: normalized,
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
