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
