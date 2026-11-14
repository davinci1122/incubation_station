// src/*.js を番号順に連結して dist/Code.gs を作る。Apps Script エディタに貼り付ける用。
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = import.meta.dirname;
export function bundle() {
  const dir = join(root, "src");
  const parts = readdirSync(dir).filter((f) => f.endsWith(".js")).sort()
    .map((f) => `// ===== ${f} =====\n${readFileSync(join(dir, f), "utf8").trimEnd()}\n`);
  return `// INTERNET CABINET — Google Apps Script\n// このファイルは apps/gas/src から生成されます。直接編集しないでください。\n\n${parts.join("\n")}`;
}

if (process.argv[1] === import.meta.filename) {
  mkdirSync(join(root, "dist"), { recursive: true });
  writeFileSync(join(root, "dist", "Code.gs"), bundle());
  console.log("wrote apps/gas/dist/Code.gs");
}
