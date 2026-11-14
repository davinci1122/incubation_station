import assert from "node:assert/strict";
import { test } from "node:test";
import { COMMON_COLUMNS, TABLES } from "../../../packages/schema/src/index.ts";
import { createEnv, type Env } from "./fake-gas.ts";

const EMAIL = "owner@example.com";

function ready(): Env & { user: { id: string; email: string }; call: (action: string, params?: unknown) => any } {
  const env = createEnv();
  env.props.set("ALLOWED_EMAIL", EMAIL);
  env.props.set("OAUTH_CLIENT_ID", "client-123");
  env.ctx.setupDatabase_(env.ss);
  const user = env.ctx.userFromEmail_(EMAIL);
  const call = (action: string, params?: unknown) => JSON.parse(JSON.stringify(env.ctx.run_(user, action, params)));
  return { ...env, user, call };
}

const plain = (v: unknown) => JSON.parse(JSON.stringify(v));
const url = (path: string) => ({ original_url: `https://example.com/${path}?utm_source=x`, normalized_url: `https://example.com/${path}` });
const code = (fn: () => unknown) => { try { fn(); } catch (e: any) { return e.code; } return null; };

test("GAS のテーブル定義が packages/schema と一致する", () => {
  const env = createEnv();
  const gas = plain(env.ctx.TABLE_COLUMNS) as Record<string, string[]>;
  assert.deepEqual(Object.keys(gas).sort(), Object.keys(TABLES).sort());
  for (const [name, t] of Object.entries(TABLES)) {
    assert.deepEqual([...gas[name]!, ...plain(env.ctx.COMMON_COLUMNS)], [...t.columns], name);
  }
  assert.deepEqual(plain(env.ctx.COMMON_COLUMNS), [...COMMON_COLUMNS]);
});

test("セットアップは全シートを作り、何度実行しても安全", () => {
  const env = ready();
  const names = env.ss.sheets.map((s) => s.name).sort();
  assert.deepEqual(names, [...Object.keys(TABLES), "_meta", "curation"].sort());
  assert.equal(env.ss.getSheetByName("シート1"), null);
  env.call("items.create", url("a"));
  const again = plain(env.ctx.setupDatabase_(env.ss));
  assert.deepEqual(again.created, []);
  assert.equal(env.call("sync.pull", { since: 0 }).tables.items.length, 1);
});

test("不足している列はセットアップで追加される", () => {
  const env = ready();
  const sheet = env.ss.getSheetByName("items")!;
  const idx = (sheet.data[0] as string[]).indexOf("summary");
  for (const row of sheet.data) row.splice(idx, 1);
  assert.equal(code(() => env.call("sync.pull", {})), "SCHEMA");
  env.ctx.setupDatabase_(env.ss);
  assert.ok((sheet.data[0] as string[]).includes("summary"));
  assert.equal(env.call("ping").ok, true);
});

test("URL登録で item・capture・job が作られ、シートに保存される", () => {
  const env = ready();
  const res = env.call("items.create", { ...url("post"), title: "Hello", tags: ["Design", "design ", "Web"] });
  assert.equal(res.duplicate, false);
  assert.equal(res.item.domain, "example.com");
  assert.equal(res.item.capture_status, "pending");
  assert.equal(res.job.trigger, "new");
  const pulled = env.call("sync.pull", { since: 0 });
  assert.equal(pulled.tables.items.length, 1);
  assert.equal(pulled.tables.captures.length, 1);
  assert.equal(pulled.tables.capture_jobs.length, 1);
  assert.deepEqual(pulled.tables.tags.map((t: any) => t.name).sort(), ["Design", "Web"]);
  assert.equal(pulled.tables.item_tags.length, 2);
  assert.equal(pulled.rev, pulled.cursor);
});

test("同じURLの再登録は新しいスナップショットになり、過去分を上書きしない", () => {
  const env = ready();
  const first = env.call("items.create", url("same"));
  const second = env.call("items.create", url("same"));
  assert.equal(second.duplicate, true);
  assert.equal(second.item.id, first.item.id);
  assert.notEqual(second.capture.id, first.capture.id);
  assert.equal(second.job.trigger, "recapture");
  const pulled = env.call("sync.pull", {});
  assert.equal(pulled.tables.items.length, 1);
  assert.equal(pulled.tables.captures.length, 2);
  assert.equal(env.call("items.create", { ...url("same"), recapture: false }).duplicate, true);
  assert.equal(env.call("sync.pull", {}).tables.captures.length, 2);
});

test("不正なURLは拒否する", () => {
  const env = ready();
  assert.equal(code(() => env.call("items.create", { original_url: "javascript:alert(1)", normalized_url: "javascript:alert(1)" })), "INVALID_URL");
  assert.equal(code(() => env.call("items.create", { original_url: "https://a.example/", normalized_url: "" })), "INVALID_URL");
});

test("更新は version が一致するときだけ通り、不一致は CONFLICT", () => {
  const env = ready();
  const { item } = env.call("items.create", url("v"));
  const updated = env.call("items.update", { id: item.id, version: item.version, patch: { user_note: "memo", is_favorite: true, url_hash: "x" } }).item;
  assert.equal(updated.user_note, "memo");
  assert.equal(updated.is_favorite, "true");
  assert.equal(updated.url_hash, item.url_hash);
  assert.equal(Number(updated.version), Number(item.version) + 1);
  assert.equal(code(() => env.call("items.update", { id: item.id, version: item.version, patch: { user_note: "old" } })), "CONFLICT");
  assert.equal(code(() => env.call("items.update", { id: item.id, patch: { user_note: "no version" } })), "CONFLICT");
});

test("数式として解釈され得る値は文字列のまま往復する", () => {
  const env = ready();
  const titles = ['=IMPORTXML("https://evil.example","//a")', "+1 (555)", "-dash", "@mention", "'quoted"];
  titles.forEach((title, i) => env.call("items.create", { ...url(`f${i}`), title }));
  const stored = env.call("sync.pull", {}).tables.items.map((r: any) => r.title);
  assert.deepEqual(stored.sort(), [...titles].sort());
});

test("タグの付け替え: 大文字小文字を同一視し、外したタグは論理削除、戻すと復活", () => {
  const env = ready();
  const { item } = env.call("items.create", url("t"));
  assert.deepEqual(env.call("items.setTags", { id: item.id, tags: ["Typography", " web  design "] }).tags, ["Typography", "web design"]);
  assert.deepEqual(env.call("items.setTags", { id: item.id, tags: ["typography"] }).tags, ["Typography"]);
  let pulled = env.call("sync.pull", {});
  assert.equal(pulled.tables.tags.length, 2);
  assert.equal(pulled.tables.item_tags.filter((l: any) => l.deleted_at === "").length, 1);
  env.call("items.setTags", { id: item.id, tags: ["Typography", "Web Design"] });
  pulled = env.call("sync.pull", {});
  assert.equal(pulled.tables.item_tags.length, 2);
  assert.equal(pulled.tables.item_tags.filter((l: any) => l.deleted_at === "").length, 2);
});

test("タグの統合と改名", () => {
  const env = ready();
  const a = env.call("items.create", { ...url("m1"), tags: ["typo"] }).item;
  const b = env.call("items.create", { ...url("m2"), tags: ["typo", "typography"] }).item;
  const tags = env.call("sync.pull", {}).tables.tags;
  const typo = tags.find((t: any) => t.name === "typo");
  const typography = tags.find((t: any) => t.name === "typography");
  assert.equal(code(() => env.call("tags.update", { id: typo.id, version: typo.version, patch: { name: "Typography" } })), "DUPLICATE");
  assert.equal(env.call("tags.merge", { from_id: typo.id, to_id: typography.id }).moved, 2);
  const pulled = env.call("sync.pull", {});
  const live = pulled.tables.item_tags.filter((l: any) => l.deleted_at === "");
  assert.deepEqual(live.map((l: any) => [l.item_id, l.tag_id]).sort(), [[a.id, typography.id], [b.id, typography.id]].sort());
  assert.notEqual(pulled.tables.tags.find((t: any) => t.id === typo.id).deleted_at, "");
});

test("コレクション: 同じアイテムを複数に所属させ、並べ替え・削除できる", () => {
  const env = ready();
  const items = ["c1", "c2", "c3"].map((p) => env.call("items.create", url(p)).item);
  const c1 = env.call("collections.create", { name: "Architecture" }).collection;
  const c2 = env.call("collections.create", { name: "Ideas" }).collection;
  assert.equal(env.call("collections.addItems", { collection_id: c1.id, item_ids: items.map((i) => i.id) }).added, 3);
  assert.equal(env.call("collections.addItems", { collection_id: c2.id, item_ids: [items[0].id] }).added, 1);
  assert.equal(env.call("collections.addItems", { collection_id: c1.id, item_ids: [items[0].id] }).added, 0);
  env.call("collections.reorder", { collection_id: c1.id, item_ids: [items[2].id, items[0].id] });
  let links = env.call("sync.pull", {}).tables.collection_items.filter((l: any) => l.collection_id === c1.id && l.deleted_at === "");
  links.sort((x: any, y: any) => Number(x.sort_order) - Number(y.sort_order));
  assert.deepEqual(links.map((l: any) => l.item_id), [items[2].id, items[0].id, items[1].id]);
  assert.equal(env.call("collections.removeItems", { collection_id: c1.id, item_ids: [items[1].id] }).removed, 1);
  env.call("collections.delete", { id: c2.id });
  links = env.call("sync.pull", {}).tables.collection_items.filter((l: any) => l.deleted_at === "");
  assert.equal(links.length, 2);
});

test("差分同期: since 以降だけを返し、ページ分割できる", () => {
  const env = ready();
  for (let i = 0; i < 5; i++) env.call("items.create", url(`s${i}`));
  const all = env.call("sync.pull", { since: 0 });
  const first = env.call("sync.pull", { since: 0, limit: 4 });
  assert.equal(first.more, true);
  let count = 4;
  let cursor = first.cursor;
  for (let guard = 0; guard < 20; guard++) {
    const page = env.call("sync.pull", { since: cursor, limit: 4 });
    count += Object.values(page.tables as Record<string, unknown[]>).reduce((n, rows) => n + rows.length, 0);
    cursor = page.cursor;
    if (!page.more) break;
  }
  assert.equal(count, 15);
  assert.equal(cursor, all.rev);
  assert.deepEqual(env.call("sync.pull", { since: all.rev }).tables, {});
  const { item } = env.call("items.create", url("s-new"));
  const delta = env.call("sync.pull", { since: all.rev });
  assert.deepEqual(delta.tables.items.map((r: any) => r.id), [item.id]);
});

test("削除は論理削除で、復元できる。他の利用者の行は見えない", () => {
  const env = ready();
  const { item } = env.call("items.create", url("d"));
  env.call("items.delete", { id: item.id });
  assert.notEqual(env.call("sync.pull", {}).tables.items[0].deleted_at, "");
  assert.equal(code(() => env.call("items.update", { id: item.id, version: "2", patch: {} })), "NOT_FOUND");
  assert.equal(env.call("items.restore", { id: item.id }).item.deleted_at, "");

  const other = { id: "u_other", email: "other@example.com" };
  assert.deepEqual(plain(env.ctx.run_(other, "sync.pull", {})).tables, {});
  assert.equal(code(() => env.ctx.run_(other, "items.update", { id: item.id, version: "3", patch: {} })), "NOT_FOUND");
  assert.equal(code(() => env.ctx.run_(other, "items.setTags", { id: item.id, tags: ["x"] })), "NOT_FOUND");
});

test("許可されていないメールアドレスは拒否する", () => {
  const env = ready();
  assert.equal(code(() => env.ctx.userFromEmail_("someone@example.com")), "FORBIDDEN");
  assert.equal(code(() => env.ctx.userFromEmail_("")), "FORBIDDEN");
  env.props.delete("ALLOWED_EMAIL");
  assert.equal(code(() => env.ctx.userFromEmail_(EMAIL)), "FORBIDDEN");
});

test("IDトークン検証: 発行先・期限・メールを確認し、結果をキャッシュする", () => {
  const env = ready();
  const exp = String(Math.floor(Date.now() / 1000) + 3600);
  const good = { iss: "https://accounts.google.com", aud: "client-123", email: EMAIL, email_verified: "true", exp };
  env.tokens.set("good", { code: 200, body: good });
  env.tokens.set("wrong-aud", { code: 200, body: { ...good, aud: "other-client" } });
  env.tokens.set("expired", { code: 200, body: { ...good, exp: "1" } });
  env.tokens.set("unverified", { code: 200, body: { ...good, email_verified: "false" } });
  env.tokens.set("stranger", { code: 200, body: { ...good, email: "stranger@example.com" } });
  assert.equal(env.ctx.verifyIdToken_("good").email, EMAIL);
  assert.equal(env.ctx.verifyIdToken_("good").email, EMAIL);
  assert.equal(env.fetchCount.n, 1);
  for (const t of ["wrong-aud", "expired", "unverified", "bogus", ""]) assert.equal(code(() => env.ctx.verifyIdToken_(t)), "UNAUTHENTICATED", t);
  assert.equal(code(() => env.ctx.verifyIdToken_("stranger")), "FORBIDDEN");
});

test("doPost: トークンなしは拒否、正しいトークンで実行できる", () => {
  const env = ready();
  const exp = String(Math.floor(Date.now() / 1000) + 3600);
  env.tokens.set("good", { code: 200, body: { iss: "accounts.google.com", aud: "client-123", email: EMAIL, email_verified: "true", exp } });
  const post = (body: unknown) => JSON.parse(env.ctx.doPost({ postData: { contents: typeof body === "string" ? body : JSON.stringify(body) } }).text);
  assert.equal(post({ action: "ping" }).error.code, "UNAUTHENTICATED");
  assert.equal(post("not json").error.code, "INVALID");
  assert.equal(post({ id_token: "good", action: "nope" }).error.code, "UNKNOWN_ACTION");
  const created = post({ id_token: "good", action: "items.create", params: url("post") });
  assert.equal(created.ok, true);
  assert.equal(post({ id_token: "good", action: "sync.pull", params: {} }).data.tables.items.length, 1);
});

test("api: Apps Script API 経由では実行者のメールで判定する", () => {
  const env = ready();
  assert.equal(plain(env.ctx.api({ action: "ping" })).ok, true);
  env.activeEmail.value = "intruder@example.com";
  assert.equal(plain(env.ctx.api({ action: "ping" })).error.code, "FORBIDDEN");
});

test("整理シート: 書き出し、チェックした行だけ反映する", () => {
  const env = ready();
  const a = env.call("items.create", { ...url("k1"), title: "A", tags: ["old"] }).item;
  const b = env.call("items.create", { ...url("k2"), title: "B" }).item;
  assert.equal(plain(env.ctx.curationRefresh_(env.ctx.database_(), env.user)).count, 2);
  const sheet = env.ss.getSheetByName("curation")!;
  const header = sheet.data[0] as string[];
  const col = (name: string) => header.indexOf(name);
  const rowOf = (id: string) => sheet.data.find((r) => r[col("item_id")] === id)!;
  assert.equal(rowOf(a.id)[col("tags")], "old");
  rowOf(a.id)[col("new_tags")] = "architecture、 Library ,architecture";
  rowOf(a.id)[col("summary")] = "要約";
  rowOf(a.id)[col("apply")] = true;
  rowOf(b.id)[col("new_tags")] = "ignored";

  const preview = plain(env.ctx.curationApply_(env.ctx.database_(), env.user, true));
  assert.deepEqual([preview.rows, preview.tagChanges, preview.summaryChanges, preview.noteChanges], [1, 1, 1, 0]);
  assert.equal(env.call("sync.pull", {}).tables.tags.length, 1);

  const before = env.call("sync.pull", {}).rev;
  env.ctx.menuCurationApply();
  const delta = env.call("sync.pull", { since: before });
  assert.equal(delta.tables.items[0].summary, "要約");
  assert.deepEqual(delta.tables.tags.map((t: any) => t.name).sort(), ["Library", "architecture"]);
  const all = env.call("sync.pull", {});
  const liveA = all.tables.item_tags.filter((l: any) => l.item_id === a.id && l.deleted_at === "");
  assert.equal(liveA.length, 2);
  assert.equal(all.tables.item_tags.filter((l: any) => l.item_id === b.id).length, 0);
  assert.equal(rowOf(a.id)[col("apply")], false);
});

const PAGE = `<!doctype html><html lang="ja"><head>
<meta charset="utf-8"><title>Fallback &amp; Title</title>
<meta property="og:title" content="展示空間の動線設計 &quot;ノート&quot;">
<meta name="description" content="会場構成の考え方をまとめた記事。">
<meta property="og:image" content="/img/cover.jpg">
<meta property="og:type" content="article">
<meta property="article:published_time" content="2026-05-01T09:00:00+09:00">
<link rel="shortcut icon" href="favicon.png">
<script>var x = "<meta property='og:title' content='ignored'>";</script>
</head><body><nav>メニュー ホーム</nav><main><h1>見出し</h1><p>本文の一段落目です。${"あ".repeat(300)}</p><script>alert(1)</script></main><footer>フッター</footer></body></html>`;

test("メタデータ抽出: OGP・相対URL・抜粋・文字参照", () => {
  const env = createEnv();
  const m = plain(env.ctx.parseMeta_(PAGE, "https://example.com/blog/post"));
  assert.equal(m.title, '展示空間の動線設計 "ノート"');
  assert.equal(m.description, "会場構成の考え方をまとめた記事。");
  assert.equal(m.image_url, "https://example.com/img/cover.jpg");
  assert.equal(m.favicon_url, "https://example.com/blog/favicon.png");
  assert.equal(m.content_type, "article");
  assert.equal(m.lang, "ja");
  assert.equal(m.published_at, "2026-05-01T00:00:00.000Z");
  assert.ok(m.excerpt.startsWith("見出し 本文の一段落目です。"));
  assert.ok(!m.excerpt.includes("メニュー") && !m.excerpt.includes("alert") && !m.excerpt.includes("フッター"));
  assert.ok(m.excerpt.length <= 1000);
  const bare = plain(env.ctx.parseMeta_("<html><head><title> Only  title </title></head><body>hello</body></html>", "https://a.example/x/y"));
  assert.deepEqual([bare.title, bare.image_url, bare.favicon_url, bare.content_type, bare.excerpt], ["Only title", "", "https://a.example/favicon.ico", "page", "hello"]);
  assert.equal(plain(env.ctx.parseMeta_('<meta property="og:image" content="javascript:alert(1)">', "https://a.example/")).image_url, "");
});

test("内部向けの宛先は取得しない", () => {
  const env = createEnv();
  for (const h of ["localhost", "127.0.0.1", "10.1.2.3", "169.254.169.254", "192.168.0.1", "172.20.0.1", "[::1]", "intranet", "db.internal", "0x7f.0.0.1", "2130706433", ""]) {
    assert.equal(env.ctx.isBlockedHost_(h), true, h);
  }
  for (const h of ["example.com", "8.8.8.8", "www.loc.gov", "172.32.0.1"]) assert.equal(env.ctx.isBlockedHost_(h), false, h);
  assert.equal(plain(env.ctx.fetchPageMeta_("http://169.254.169.254/latest")).error_code, "SSRF_BLOCKED");
  env.pages.set("https://example.com/r", { code: 302, headers: { Location: "http://localhost/admin" } });
  assert.equal(plain(env.ctx.fetchPageMeta_("https://example.com/r")).error_code, "SSRF_BLOCKED");
});

test("items.fetchMeta: 取得結果を item・capture・job に反映する", () => {
  const env = ready();
  env.pages.set("https://example.com/post?utm_source=x", { code: 301, headers: { Location: "/blog/post" } });
  env.pages.set("https://example.com/blog/post", { code: 200, body: PAGE });
  const { item } = env.call("items.create", url("post"));
  const res = env.call("items.fetchMeta", { id: item.id });
  assert.equal(res.ok, true);
  assert.equal(res.item.title, '展示空間の動線設計 "ノート"');
  assert.equal(res.item.image_url, "https://example.com/img/cover.jpg");
  assert.equal(res.item.capture_status, "completed");
  assert.equal(res.item.content_type, "article");
  const all = env.call("sync.pull", {});
  assert.equal(all.tables.captures[0].archive_status, "completed");
  assert.equal(all.tables.captures[0].page_url, "https://example.com/blog/post");
  assert.equal(all.tables.capture_jobs[0].status, "completed");
  assert.equal(res.item.latest_capture_id, all.tables.captures[0].id);
});

test("items.fetchMeta: 手入力したタイトルは上書きしない。失敗は理由を記録し、再取得できる", () => {
  const env = ready();
  env.pages.set("https://example.com/a?utm_source=x", { code: 403 });
  const { item } = env.call("items.create", { ...url("a"), title: "自分で付けた名前" });
  let res = env.call("items.fetchMeta", { id: item.id });
  assert.deepEqual([res.ok, res.error_code, res.item.capture_status, res.item.title], [false, "BLOCKED_ROBOTS", "failed", "自分で付けた名前"]);
  env.pages.set("https://example.com/a?utm_source=x", { code: 200, body: PAGE });
  env.call("items.refetch", { id: item.id });
  res = env.call("items.fetchMeta", { id: item.id });
  assert.deepEqual([res.ok, res.item.capture_status, res.item.title], [true, "completed", "自分で付けた名前"]);
  assert.equal(res.item.description, "会場構成の考え方をまとめた記事。");
  const captures = env.call("sync.pull", {}).tables.captures;
  assert.deepEqual(captures.map((c: any) => c.archive_status).sort(), ["completed", "failed"]);

  env.pages.set("https://example.com/b?utm_source=x", { code: 200, throws: "Request timed out" });
  const b = env.call("items.create", url("b")).item;
  assert.equal(env.call("items.fetchMeta", { id: b.id }).error_code, "TIMEOUT");
  env.pages.set("https://example.com/c?utm_source=x", { code: 200, headers: { "Content-Type": "application/pdf" } });
  const c = env.call("items.create", url("c")).item;
  assert.equal(env.call("items.fetchMeta", { id: c.id }).item.content_type, "pdf");
});

test("初期セットアップはメニュー用トリガーを1つだけ登録する", () => {
  const env = createEnv();
  env.ctx.menuSetup();
  env.ctx.menuSetup();
  assert.deepEqual(env.triggers, ["cabinetMenu"]);
  assert.equal(env.props.get("ALLOWED_EMAIL"), "owner@example.com");
  assert.equal(env.menus.n, 2);
});
