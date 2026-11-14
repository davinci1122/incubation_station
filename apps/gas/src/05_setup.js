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
  // AIでの整理の設定。値は _meta シートで変更できる（料金改定時はここを直す）。
  for (var key in AI_DEFAULTS) if (db.getMeta(key) === "") db.setMeta(key, AI_DEFAULTS[key]);

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
