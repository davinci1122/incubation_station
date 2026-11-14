/**
 * 手動で設定する画像。Googleドライブの「InternetCabinet images」フォルダに保存し、
 * 「リンクを知っている全員が閲覧可」にしてサムネイルのURLを image_url に入れる。
 * ファイル名はIDだけなので推測されにくい。Drive の権限は drive.file（このアプリが作ったファイルだけ）。
 */
var MANUAL_IMAGE_PREFIX = "https://drive.google.com/thumbnail?id=";
var IMAGE_MAX_BASE64 = 2500000;
var IMAGE_EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

function isManualImage_(url) {
  return String(url || "").indexOf(MANUAL_IMAGE_PREFIX) === 0;
}

function manualImageId_(url) {
  return isManualImage_(url) ? String(url).slice(MANUAL_IMAGE_PREFIX.length).split("&")[0] : "";
}

function imageFolder_() {
  var p = props_();
  var id = p.getProperty("IMAGE_FOLDER_ID");
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (e) { /* 消されていたら作り直す */ }
  }
  var folder = DriveApp.createFolder("InternetCabinet images");
  p.setProperty("IMAGE_FOLDER_ID", folder.getId());
  return folder;
}

/** 画像を保存して、そのアイテムの画像にする。以前の手動画像はゴミ箱へ送る。 */
function itemsSetImage_(db, user, p) {
  var item = ownLive_(db, user, "items", p.id);
  var mime = String(p.mime || "");
  if (!IMAGE_EXT[mime]) throw err_("INVALID", "画像は JPEG・PNG・WebP のいずれかにしてください。");
  var data = String(p.data || "");
  if (data === "" || data.length > IMAGE_MAX_BASE64) throw err_("TOO_LARGE", "画像が大きすぎます。");

  var blob = Utilities.newBlob(Utilities.base64Decode(data), mime, item.id + "." + IMAGE_EXT[mime]);
  var file = imageFolder_().createFile(blob);
  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (e) {
    file.setTrashed(true);
    throw err_("SHARE_FAILED", "画像を公開できませんでした。組織のドライブ共有の設定を確認してください。");
  }
  var previous = manualImageId_(item.image_url);
  if (previous) {
    try { DriveApp.getFileById(previous).setTrashed(true); } catch (e2) { /* 既に無ければそのまま */ }
  }
  var url = MANUAL_IMAGE_PREFIX + file.getId() + "&sz=w1200";
  return { item: publicRow_(db.update("items", item, { image_url: url, updated_at: now_() })) };
}
