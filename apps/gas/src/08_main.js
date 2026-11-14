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
  ensureSheet_(SpreadsheetApp.getActiveSpreadsheet(), CURATION_SHEET, CURATION_COLUMNS, false);
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
  var message = "対象 " + preview.rows + " 行\nタグの変更 " + preview.tagChanges + " 件\nコレクションの変更 " + preview.collectionChanges + " 件\n要約の変更 " + preview.summaryChanges + " 件\nメモの変更 " + preview.noteChanges + " 件"
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
    result.appliedRows.forEach(function (r) { sheet.getRange(r, result.applyColumn, 1, 1).setValues([[false]]); });
  } finally {
    lock.releaseLock();
  }
  ui.alert(result.rows + " 行を反映しました。" + (result.skipped.length > 0 ? "\nスキップ: " + result.skipped.map(function (s) { return s.row + "行目（" + s.reason + "）"; }).join("、") : ""));
}
