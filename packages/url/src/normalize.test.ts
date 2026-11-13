import assert from "node:assert/strict";
import { test } from "node:test";
import { displayDomain, normalizeUrl, parseHttpUrl } from "./normalize.ts";

test("追跡パラメータとフラグメントを除去し、クエリを整列する", () => {
  assert.equal(
    normalizeUrl("HTTPS://Example.COM:443/a/b/?utm_source=x&b=2&a=1&fbclid=abc#top"),
    "https://example.com/a/b?a=1&b=2",
  );
});

test("ルートの末尾スラッシュは保持し、それ以外は除去する", () => {
  assert.equal(normalizeUrl("https://example.com"), "https://example.com/");
  assert.equal(normalizeUrl("https://example.com/path///"), "https://example.com/path");
});

test("表記ゆれが同じ正規化結果になる", () => {
  const a = normalizeUrl("http://example.com/x?b=1&a=2&utm_medium=mail");
  const b = normalizeUrl("http://EXAMPLE.com:80/x/?a=2&b=1#frag");
  assert.equal(a, b);
});

test("同名パラメータは値の順で安定させ、追跡以外は残す", () => {
  assert.equal(normalizeUrl("https://example.com/?t=b&t=a&ref=home"), "https://example.com/?ref=home&t=a&t=b");
});

test("日本語パスを扱える", () => {
  assert.equal(normalizeUrl("https://example.jp/記事/"), "https://example.jp/%E8%A8%98%E4%BA%8B");
});

test("http/https 以外・不正・認証情報付きは拒否する", () => {
  assert.equal(normalizeUrl("javascript:alert(1)"), null);
  assert.equal(normalizeUrl("file:///etc/passwd"), null);
  assert.equal(normalizeUrl("not a url"), null);
  assert.equal(normalizeUrl("   "), null);
  assert.deepEqual(parseHttpUrl("https://user:pass@example.com/"), { ok: false, reason: "HAS_CREDENTIALS" });
  assert.deepEqual(parseHttpUrl("https://example.com/" + "a".repeat(2100)), { ok: false, reason: "TOO_LONG" });
});

test("表示用ドメインは www. を除く", () => {
  assert.equal(displayDomain("https://www.example.com/a"), "example.com");
  assert.equal(displayDomain("ftp://example.com"), null);
});
