/**
 * 手動で設定する画像。Googleドライブの「InternetCabinet images」フォルダに保存し、
 * 「リンクを知っている全員が閲覧可」にしてサムネイルのURLを image_url に入れる。
 * ファイル名はIDだけなので推測されにくい。
 * Drive の権限は drive.file（このアプリが作ったファイルだけ）。DriveApp は全ドライブの権限を求めるので使わず、
 * Drive API（高度なサービス）で扱う。
 */
var MANUAL_IMAGE_PREFIX = "https://drive.google.com/thumbnail?id=";
var IMAGE_MAX_BASE64 = 2500000;
var IMAGE_EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
var IMAGE_FOLDER_NAME = "InternetCabinet images";

function isManualImage_(url) {
  return String(url || "").indexOf(MANUAL_IMAGE_PREFIX) === 0;
}

function manualImageId_(url) {
  return isManualImage_(url) ? String(url).slice(MANUAL_IMAGE_PREFIX.length).split("&")[0] : "";
}

/** 画像用フォルダのID。無ければ作る（このアプリが作ったフォルダとして記録する）。 */
function imageFolderId_() {
  var p = props_();
  var id = p.getProperty("IMAGE_FOLDER_ID");
  if (id) {
    try {
      var existing = Drive.Files.get(id, { fields: "id,trashed" });
      if (!existing.trashed) return existing.id;
    } catch (e) { /* 消されていたら作り直す */ }
  }
  var created = Drive.Files.create({ name: IMAGE_FOLDER_NAME, mimeType: "application/vnd.google-apps.folder" }, null, { fields: "id" });
  p.setProperty("IMAGE_FOLDER_ID", created.id);
  return created.id;
}

function trashImageFile_(fileId) {
  try { Drive.Files.update({ trashed: true }, fileId); } catch (e) { /* 既に無ければそのまま */ }
}

/** 画像を保存して、そのアイテムの画像にする。以前の手動画像はゴミ箱へ送る。 */
function itemsSetImage_(db, user, p) {
  var item = ownLive_(db, user, "items", p.id);
  var mime = String(p.mime || "");
  if (!IMAGE_EXT[mime]) throw err_("INVALID", "画像は JPEG・PNG・WebP のいずれかにしてください。");
  var data = String(p.data || "");
  if (data === "" || data.length > IMAGE_MAX_BASE64) throw err_("TOO_LARGE", "画像が大きすぎます。");

  var blob = Utilities.newBlob(Utilities.base64Decode(data), mime, item.id + "." + IMAGE_EXT[mime]);
  var fileId;
  try {
    fileId = Drive.Files.create({ name: blob.name, parents: [imageFolderId_()] }, blob, { fields: "id" }).id;
  } catch (e) {
    // 権限を承認していないと Drive API が失敗する。原因をそのまま伝える。
    throw err_("DRIVE_DENIED", "画像を保存できませんでした。Apps Scriptエディタで authorizeDrive を実行し、Googleドライブへのアクセスを許可してください。");
  }
  try {
    Drive.Permissions.create({ role: "reader", type: "anyone" }, fileId);
  } catch (e2) {
    trashImageFile_(fileId);
    throw err_("SHARE_FAILED", "画像を公開できませんでした。組織のドライブ共有の設定を確認してください。");
  }
  var previous = manualImageId_(item.image_url);
  if (previous) trashImageFile_(previous);
  var url = MANUAL_IMAGE_PREFIX + fileId + "&sz=w1200";
  return { item: publicRow_(db.update("items", item, { image_url: url, updated_at: now_() })) };
}

/**
 * Googleドライブの権限を承認する。エディタの関数選択で「authorizeDrive」を選んで実行する。
 * 承認画面はドライブを実際に呼んだときにしか出ないため、setup とは別に用意している。
 */
function authorizeDrive() {
  var id = imageFolderId_();
  console.log("Drive の権限を確認しました: " + id);
  return "Googleドライブの権限を確認しました。";
}
