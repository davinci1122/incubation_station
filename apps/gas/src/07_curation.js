/** 整理シートの見出し行を読み、列名 → 列番号（0始まり）を返す。列の並び順には依存しない。 */
function curationHeader_(sheet) {
  var header = sheet.getRange(1, 1, 1, Math.max(1, sheet.getLastColumn())).getValues()[0].map(String);
  var col = {};
  CURATION_COLUMNS.forEach(function (c) {
    col[c] = header.indexOf(c);
    if (col[c] === -1) throw err_("SCHEMA", "整理シートに列 " + c + " がありません。初期セットアップを実行してください。");
  });
  return { header: header, col: col };
}

/** 整理シートを現在のデータで作り直す。編集欄には現在の値を入れておく。 */
function curationRefresh_(db, user) {
  var tagName = {};
  db.live("tags", user.id).forEach(function (t) { tagName[t.id] = t.name; });
  var tagsOf = {};
  db.live("item_tags", user.id).forEach(function (l) {
    if (tagName[l.tag_id]) (tagsOf[l.item_id] = tagsOf[l.item_id] || []).push(tagName[l.tag_id]);
  });
  var colName = {};
  db.live("collections", user.id).forEach(function (c) { colName[c.id] = c.name; });
  var colsOf = {};
  db.live("collection_items", user.id).forEach(function (l) {
    if (colName[l.collection_id]) (colsOf[l.item_id] = colsOf[l.item_id] || []).push(colName[l.collection_id]);
  });

  var sheet = db.sheet_(CURATION_SHEET);
  var h = curationHeader_(sheet);
  var width = h.header.length;
  var items = db.live("items", user.id).sort(function (a, b) { return a.created_at < b.created_at ? 1 : -1; });
  var rows = items.map(function (it) {
    var tags = (tagsOf[it.id] || []).sort().join(", ");
    var cols = (colsOf[it.id] || []).sort().join(", ");
    var values = {
      item_id: it.id, title: it.title, url: it.original_url, domain: it.domain, content_type: it.content_type,
      excerpt: it.excerpt, saved_at: it.created_at, tags: tags, new_tags: tags, summary: it.summary,
      note: it.user_note, collections: cols, new_collections: cols
    };
    return h.header.map(function (name, j) {
      if (j === h.col.apply) return false;
      return values[name] === undefined ? "" : toCell_(values[name]);
    });
  });
  if (sheet.getLastRow() > 1) sheet.getRange(2, 1, sheet.getLastRow() - 1, width).clearContent();
  if (rows.length > 0) {
    var need = rows.length + 1 - sheet.getMaxRows();
    if (need > 0) sheet.insertRowsAfter(sheet.getMaxRows(), need);
    sheet.getRange(2, 1, rows.length, width).setNumberFormat("@");
    var applyRange = sheet.getRange(2, h.col.apply + 1, rows.length, 1);
    applyRange.setNumberFormat("General");
    sheet.getRange(2, 1, rows.length, width).setValues(rows);
    applyRange.insertCheckboxes();
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

function sameNames_(a, b) {
  return a.length === b.length && a.map(tagKey_).sort().join("\n") === b.map(tagKey_).sort().join("\n");
}

/** apply にチェックがある行の変更内容を調べる。dryRun なら書き込まない。 */
function curationApply_(db, user, dryRun) {
  var sheet = db.sheet_(CURATION_SHEET);
  var col = curationHeader_(sheet).col;
  var values = sheet.getDataRange().getValues();
  var result = { rows: 0, tagChanges: 0, collectionChanges: 0, summaryChanges: 0, noteChanges: 0, skipped: [], appliedRows: [], applyColumn: col.apply + 1 };
  for (var i = 1; i < values.length; i++) {
    var v = values[i];
    if (v[col.apply] !== true && String(v[col.apply]).toUpperCase() !== "TRUE") continue;
    var item;
    try {
      item = ownLive_(db, user, "items", String(v[col.item_id] || ""));
    } catch (e) {
      result.skipped.push({ row: i + 1, reason: "アイテムが見つかりません" });
      continue;
    }
    try {
      var wantedTags = splitTags_(v[col.new_tags]);
      var tagsSame = sameNames_(wantedTags, splitTags_(v[col.tags]));
      var wantedCols = splitTags_(v[col.new_collections]);
      var colsSame = sameNames_(wantedCols, splitTags_(v[col.collections]));
      var summary = str_(v[col.summary], LIMITS.summary, "要約");
      var note = str_(v[col.note], LIMITS.note, "メモ");
      wantedCols.forEach(function (n) { str_(n, LIMITS.name, "コレクション名"); });
      var patch = {};
      if (summary !== item.summary) { patch.summary = summary; result.summaryChanges++; }
      if (note !== item.user_note) { patch.user_note = note; result.noteChanges++; }
      if (!tagsSame) result.tagChanges++;
      if (!colsSame) result.collectionChanges++;
      if (!dryRun) {
        if (!tagsSame) setItemTags_(db, user, item.id, wantedTags);
        if (!colsSame) setItemCollections_(db, user, item.id, wantedCols);
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
