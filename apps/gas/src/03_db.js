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

/** 条件に合う行を物理的に取り除く。flush でシート全体を書き直す。戻り値は取り除いた行。 */
Db_.prototype.removeRows = function (name, predicate) {
  var t = this.table(name);
  var removed = t.rows.filter(predicate);
  if (removed.length > 0) {
    t.rows = t.rows.filter(function (r) { return !predicate(r); });
    t.rewrite = true;
  }
  return removed;
};

Db_.prototype.flush = function () {
  for (var name in this.tables) {
    var t = this.tables[name];
    var width = t.header.length;
    if (t.rewrite) {
      if (t.lastRow > 1) t.sheet.getRange(2, 1, t.lastRow - 1, width).clearContent();
      if (t.rows.length > 0) {
        var over = t.rows.length + 1 - t.sheet.getMaxRows();
        if (over > 0) t.sheet.insertRowsAfter(t.sheet.getMaxRows(), over);
        var all = t.sheet.getRange(2, 1, t.rows.length, width);
        all.setNumberFormat("@");
        all.setValues(t.rows.map(function (r) { return rowCells_(t, r); }));
      }
      t.rows.forEach(function (r, i) { r._row = i + 2; });
      t.lastRow = t.rows.length + 1;
      t.rewrite = false;
      t.dirty = [];
      t.appended = [];
      continue;
    }
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
