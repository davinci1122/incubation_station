/**
 * 日次の保守: ゴミ箱の自動削除とバックアップ。時間主導のトリガーから呼ばれる。
 */
var TRASH_DAYS = 30;
var BACKUP_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** 削除から TRASH_DAYS 日を過ぎた行を物理的に消す。 */
function purgeOld_(db, nowMs) {
  var limit = new Date(nowMs - TRASH_DAYS * 86400000).toISOString();
  var old = function (r) { return r.deleted_at !== "" && r.deleted_at < limit; };
  var goneItems = {};
  db.removeRows("items", old).forEach(function (r) { goneItems[r.id] = true; });
  var goneTags = {};
  db.removeRows("tags", old).forEach(function (r) { goneTags[r.id] = true; });
  var goneCols = {};
  db.removeRows("collections", old).forEach(function (r) { goneCols[r.id] = true; });
  var count = Object.keys(goneItems).length;
  db.removeRows("item_tags", function (r) { return old(r) || goneItems[r.item_id] || goneTags[r.tag_id]; });
  db.removeRows("collection_items", function (r) { return old(r) || goneItems[r.item_id] || goneCols[r.collection_id]; });
  db.removeRows("captures", function (r) { return !!goneItems[r.item_id]; });
  db.removeRows("capture_jobs", function (r) { return !!goneItems[r.item_id]; });
  return { items: count };
}

/** 取得履歴は各アイテムの最新5件だけ残す（シートの肥大化を防ぐ）。 */
function trimCaptures_(db) {
  var seen = {};
  var keep = {};
  db.table("captures").rows.slice().sort(function (a, b) { return a.captured_at < b.captured_at ? 1 : -1; }).forEach(function (c) {
    seen[c.item_id] = (seen[c.item_id] || 0) + 1;
    if (seen[c.item_id] <= 5) keep[c.id] = true;
  });
  db.removeRows("captures", function (c) { return !keep[c.id]; });
  db.removeRows("capture_jobs", function (j) { return j.status !== "pending" && j.status !== "processing" && !keep[j.capture_id]; });
}

function copyInto_(source, target) {
  TABLE_NAMES.concat([META_SHEET]).forEach(function (name) {
    var from = source.getSheetByName(name);
    if (!from) return;
    var values = from.getDataRange().getValues();
    var to = target.getSheetByName(name) || target.insertSheet(name);
    if (to.getLastRow() > 0 && to.getLastColumn() > 0) to.getRange(1, 1, to.getLastRow(), to.getLastColumn()).clearContent();
    var rows = values.length, cols = values[0].length;
    if (to.getMaxRows() < rows) to.insertRowsAfter(to.getMaxRows(), rows - to.getMaxRows());
    if (to.getMaxColumns() < cols) to.insertColumnsAfter(to.getMaxColumns(), cols - to.getMaxColumns());
    var range = to.getRange(1, 1, rows, cols);
    range.setNumberFormat("@");
    range.setValues(values.map(function (row) { return row.map(toCell_); }));
  });
}

/**
 * バックアップ。曜日ごとの7ファイルを使い回して上書きし（直近7日分）、月の最初の実行時にその月の控えを1つ作る。
 * Drive の権限を使わずに済むよう、ファイルは削除せず上書きする。
 */
function backup_(ss, db, now) {
  var day = BACKUP_DAYS[now.getDay()];
  var dayKey = "backup_id_" + day.toLowerCase();
  var target = null;
  var id = db.getMeta(dayKey);
  if (id !== "") {
    try { target = SpreadsheetApp.openById(id); } catch (e) { target = null; }
  }
  if (target) copyInto_(ss, target);
  else db.setMeta(dayKey, ss.copy("InternetCabinet backup (" + day + ")").getId());

  var month = now.toISOString().slice(0, 7);
  var monthKey = "backup_id_" + month;
  var createdMonthly = false;
  if (db.getMeta(monthKey) === "") {
    db.setMeta(monthKey, ss.copy("InternetCabinet backup " + month).getId());
    createdMonthly = true;
  }
  db.setMeta("last_backup_at", now.toISOString());
  return { day: day, monthly: createdMonthly };
}

function dailyMaintenance() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return;
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var db = new Db_(ss);
    var purged = purgeOld_(db, Date.now());
    trimCaptures_(db);
    db.flush();
    var result = backup_(ss, new Db_(ss), new Date());
    console.log("保守を実行: ゴミ箱から " + purged.items + " 件を削除、バックアップ " + result.day + (result.monthly ? "（月次も作成）" : ""));
  } finally {
    lock.releaseLock();
  }
}
