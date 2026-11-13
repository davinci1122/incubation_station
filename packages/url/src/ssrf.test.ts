import assert from "node:assert/strict";
import { test } from "node:test";
import { isBlockedHostname, isBlockedIp } from "./ssrf.ts";

const host = (u: string) => new URL(u).hostname;

test("内部向けIPv4を拒否する", () => {
  for (const ip of [
    "127.0.0.1", "10.0.0.1", "172.16.0.1", "172.31.255.255", "192.168.1.1",
    "169.254.169.254", "0.0.0.0", "100.64.0.1", "224.0.0.1", "255.255.255.255", "198.18.0.1",
  ]) {
    assert.equal(isBlockedIp(ip), true, ip);
  }
});

test("公開IPv4は許可する", () => {
  for (const ip of ["8.8.8.8", "1.1.1.1", "172.15.0.1", "172.32.0.1", "100.63.0.1", "93.184.216.34"]) {
    assert.equal(isBlockedIp(ip), false, ip);
  }
});

test("内部向けIPv6とIPv4埋め込みを拒否する", () => {
  for (const ip of [
    "::1", "::", "fc00::1", "fd12:3456::1", "fe80::1", "fe80::1%eth0", "ff02::1",
    "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:169.254.169.254", "64:ff9b::10.0.0.1",
    "2002:7f00:1::", "::127.0.0.1", "2001:db8::1",
  ]) {
    assert.equal(isBlockedIp(ip), true, ip);
  }
});

test("公開IPv6は許可する", () => {
  for (const ip of ["2606:4700:4700::1111", "2001:4860:4860::8888", "::ffff:8.8.8.8"]) {
    assert.equal(isBlockedIp(ip), false, ip);
  }
});

test("IPとして解釈できない文字列は拒否する", () => {
  for (const s of ["", "example.com", "1.2.3", "1.2.3.4.5", "999.1.1.1", ":::", "gggg::1"]) {
    assert.equal(isBlockedIp(s), true, s);
  }
});

test("内部向けホスト名を拒否する", () => {
  for (const u of [
    "http://localhost/", "http://LOCALHOST:8080/", "http://app.localhost/", "http://printer.local/",
    "http://metadata.google.internal/", "http://intranet/", "http://db.internal/", "http://localhost./",
    "http://127.0.0.1/", "http://[::1]/", "http://[::ffff:10.0.0.1]/",
  ]) {
    assert.equal(isBlockedHostname(host(u)), true, u);
  }
});

test("数値表記のIPはURL正規化を経て拒否される", () => {
  for (const u of ["http://2130706433/", "http://0x7f.0.0.1/", "http://0177.0.0.1/", "http://127.1/", "http://0/"]) {
    assert.equal(isBlockedHostname(host(u)), true, u);
  }
});

test("通常の公開ホスト名は許可する", () => {
  for (const u of ["https://example.com/", "https://www.loc.gov/", "https://日本語.jp/", "https://8.8.8.8/"]) {
    assert.equal(isBlockedHostname(host(u)), false, u);
  }
});
