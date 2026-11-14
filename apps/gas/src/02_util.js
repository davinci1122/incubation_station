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
