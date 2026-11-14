import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
// @ts-expect-error 型定義のない .mjs
import { bundle } from "../build.mjs";

test("dist/Code.gs が src と一致している（node apps/gas/build.mjs で更新）", () => {
  const dist = readFileSync(join(import.meta.dirname, "..", "dist", "Code.gs"), "utf8");
  assert.equal(dist, bundle());
});
