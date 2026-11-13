import assert from "node:assert/strict";
import { test } from "node:test";
import { COMMON_COLUMNS, TABLES, escapeCell, summarizeStatus } from "./index.ts";

test("全テーブルに共通の管理列があり、列名が重複しない", () => {
  for (const [name, t] of Object.entries(TABLES)) {
    const cols: readonly string[] = t.columns;
    assert.equal(new Set(cols).size, cols.length, `${name}: 列名が重複`);
    for (const c of COMMON_COLUMNS) assert.ok(cols.includes(c), `${name}: ${c} がない`);
    for (const k of t.key) assert.ok(cols.includes(k), `${name}: キー列 ${k} がない`);
    assert.ok(cols.includes("user_id"), `${name}: user_id がない`);
  }
});

test("形式ごとの成否から状態を決める", () => {
  assert.equal(summarizeStatus([true, true]), "completed");
  assert.equal(summarizeStatus([true, false]), "partially_completed");
  assert.equal(summarizeStatus([false, false]), "failed");
  assert.equal(summarizeStatus([]), "failed");
});

test("数式として解釈され得る値をエスケープする", () => {
  assert.equal(escapeCell("=IMPORTXML(\"http://x\")"), "'=IMPORTXML(\"http://x\")");
  assert.equal(escapeCell("+1"), "'+1");
  assert.equal(escapeCell("-1"), "'-1");
  assert.equal(escapeCell("@cmd"), "'@cmd");
  assert.equal(escapeCell("通常のタイトル"), "通常のタイトル");
  assert.equal(escapeCell(""), "");
});
