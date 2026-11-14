// Apps Script のサービスを最小限まねたテスト用の実装。
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";

type Cell = string | boolean | number;

class FakeRange {
  sheet: FakeSheet; r: number; c: number; nr: number; nc: number;
  constructor(sheet: FakeSheet, r: number, c: number, nr: number, nc: number) {
    if (r < 1 || c < 1 || nr < 1 || nc < 1 || r + nr - 1 > sheet.maxRows || c + nc - 1 > sheet.maxCols) {
      throw new Error(`範囲がシートの大きさを超えています (${sheet.name} ${r},${c},${nr},${nc} / ${sheet.maxRows}x${sheet.maxCols})`);
    }
    this.sheet = sheet; this.r = r; this.c = c; this.nr = nr; this.nc = nc;
  }
  getValues(): Cell[][] {
    const out: Cell[][] = [];
    for (let i = 0; i < this.nr; i++) {
      const row: Cell[] = [];
      for (let j = 0; j < this.nc; j++) row.push(this.sheet.data[this.r - 1 + i]?.[this.c - 1 + j] ?? "");
      out.push(row);
    }
    return out;
  }
  setValues(values: Cell[][]): this {
    if (values.length !== this.nr || values.some((v) => v.length !== this.nc)) throw new Error("setValues の大きさが範囲と一致しません");
    for (let i = 0; i < this.nr; i++) {
      for (let j = 0; j < this.nc; j++) {
        let v = values[i]![j]!;
        if (typeof v === "string") {
          if (v.startsWith("=")) throw new Error(`数式として解釈される値が書き込まれました: ${v}`);
          if (v.startsWith("'")) v = v.slice(1);
        }
        const row = (this.sheet.data[this.r - 1 + i] ??= []);
        while (row.length < this.c - 1 + j) row.push("");
        row[this.c - 1 + j] = v;
      }
    }
    return this;
  }
  clearContent(): this {
    for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) {
      const row = this.sheet.data[this.r - 1 + i];
      if (row && row.length > this.c - 1 + j) row[this.c - 1 + j] = "";
    }
    return this;
  }
  setNumberFormat(): this { return this; }
  setFontWeight(): this { return this; }
  insertCheckboxes(): this { return this; }
}

export class FakeSheet {
  name: string; data: Cell[][] = []; maxRows = 1000; maxCols = 26; frozen = 0;
  constructor(name: string) { this.name = name; }
  getName() { return this.name; }
  getMaxRows() { return this.maxRows; }
  getMaxColumns() { return this.maxCols; }
  getLastRow() {
    for (let i = this.data.length - 1; i >= 0; i--) if ((this.data[i] ?? []).some((v) => v !== "")) return i + 1;
    return 0;
  }
  getLastColumn() {
    let max = 0;
    for (const row of this.data) for (let j = row.length - 1; j >= 0; j--) if (row[j] !== "") { max = Math.max(max, j + 1); break; }
    return max;
  }
  getRange(r: number, c: number, nr = 1, nc = 1) { return new FakeRange(this, r, c, nr, nc); }
  getDataRange() { return new FakeRange(this, 1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())); }
  deleteColumns(_start: number, n: number) { this.maxCols -= n; }
  deleteRows(_start: number, n: number) { this.maxRows -= n; }
  insertRowsAfter(_after: number, n: number) { this.maxRows += n; }
  insertColumnsAfter(_after: number, n: number) { this.maxCols += n; }
  setFrozenRows(n: number) { this.frozen = n; }
}

export class FakeSpreadsheet {
  sheets: FakeSheet[] = [new FakeSheet("シート1")];
  getSheetByName(name: string) { return this.sheets.find((s) => s.name === name) ?? null; }
  insertSheet(name: string) { const s = new FakeSheet(name); this.sheets.push(s); return s; }
  getSheets() { return [...this.sheets]; }
  deleteSheet(sheet: FakeSheet) { this.sheets = this.sheets.filter((s) => s !== sheet); }
}

export type Env = {
  ctx: any; ss: FakeSpreadsheet; props: Map<string, string>; cache: Map<string, string>;
  tokens: Map<string, { code: number; body: unknown }>; fetchCount: { n: number }; activeEmail: { value: string };
  alerts: string[];
};

export function createEnv(): Env {
  const ss = new FakeSpreadsheet();
  const props = new Map<string, string>();
  const cache = new Map<string, string>();
  const tokens = new Map<string, { code: number; body: unknown }>();
  const fetchCount = { n: 0 };
  const activeEmail = { value: "owner@example.com" };
  const alerts: string[] = [];
  let locked = false;
  const ui = {
    ButtonSet: { OK: "OK", OK_CANCEL: "OK_CANCEL" }, Button: { OK: "OK", CANCEL: "CANCEL" },
    alert: (...args: string[]) => { alerts.push(args.filter((a) => typeof a === "string").join(" | ")); return "OK"; },
    createMenu: () => { const m: any = { addItem: () => m, addSeparator: () => m, addToUi: () => undefined }; return m; },
  };
  const sandbox: Record<string, unknown> = {
    console: { error: () => undefined, log: () => undefined },
    JSON, Math, Date, Object, Array, String, Number, Error, encodeURIComponent,
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, getUi: () => ui },
    LockService: { getScriptLock: () => ({ tryLock: () => { if (locked) return false; locked = true; return true; }, releaseLock: () => { locked = false; } }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k: string) => props.get(k) ?? null, setProperty: (k: string, v: string) => { props.set(k, v); } }) },
    CacheService: { getScriptCache: () => ({ get: (k: string) => cache.get(k) ?? null, put: (k: string, v: string) => { cache.set(k, v); } }) },
    Session: { getActiveUser: () => ({ getEmail: () => activeEmail.value }) },
    Utilities: {
      DigestAlgorithm: { SHA_256: "sha256" }, Charset: { UTF_8: "utf8" },
      getUuid: () => randomUUID(),
      computeDigest: (_alg: string, text: string) => [...createHash("sha256").update(text, "utf8").digest()].map((b) => (b > 127 ? b - 256 : b)),
    },
    UrlFetchApp: {
      fetch: (url: string) => {
        fetchCount.n++;
        const token = decodeURIComponent(url.split("id_token=")[1] ?? "");
        const hit = tokens.get(token) ?? { code: 400, body: { error: "invalid_token" } };
        return { getResponseCode: () => hit.code, getContentText: () => JSON.stringify(hit.body) };
      },
    },
    ContentService: {
      MimeType: { JSON: "application/json" },
      createTextOutput: (text: string) => { const o: any = { text, setMimeType: () => o }; return o; },
    },
  };
  const ctx = vm.createContext(sandbox);
  const dir = join(import.meta.dirname, "..", "src");
  const source = readdirSync(dir).filter((f) => f.endsWith(".js")).sort().map((f) => readFileSync(join(dir, f), "utf8")).join("\n");
  vm.runInContext(source, ctx, { filename: "gas-bundle.js" });
  return { ctx, ss, props, cache, tokens, fetchCount, activeEmail, alerts };
}
