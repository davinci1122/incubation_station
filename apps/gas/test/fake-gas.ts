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

let nextId = 1;
export const registry = new Map<string, FakeSpreadsheet>();

export class FakeSpreadsheet {
  id = `ss-${nextId++}`;
  name = "";
  sheets: FakeSheet[] = [new FakeSheet("シート1")];
  constructor() { registry.set(this.id, this); }
  getId() { return this.id; }
  copy(name: string) {
    const c = new FakeSpreadsheet();
    c.name = name;
    c.sheets = this.sheets.map((s) => { const n = new FakeSheet(s.name); n.data = s.data.map((r) => [...r]); n.maxRows = s.maxRows; n.maxCols = s.maxCols; return n; });
    return c;
  }
  getSheetByName(name: string) { return this.sheets.find((s) => s.name === name) ?? null; }
  insertSheet(name: string) { const s = new FakeSheet(name); this.sheets.push(s); return s; }
  getSheets() { return [...this.sheets]; }
  deleteSheet(sheet: FakeSheet) { this.sheets = this.sheets.filter((s) => s !== sheet); }
}

export type Env = {
  ctx: any; ss: FakeSpreadsheet; props: Map<string, string>; cache: Map<string, string>;
  tokens: Map<string, { code: number; body: unknown }>; fetchCount: { n: number }; activeEmail: { value: string };
  alerts: string[]; pages: Map<string, { code: number; headers?: Record<string, string>; body?: string; throws?: string }>;
  triggers: string[]; menus: { n: number }; ai: { handler: null | ((body: any) => { code: number; body: unknown }); calls: number };
  drive: { files: Map<string, { name: string; mime: string; shared: boolean; trashed: boolean }>; folders: Map<string, string>; denySharing: boolean };
};

export function createEnv(): Env {
  const ss = new FakeSpreadsheet();
  const props = new Map<string, string>();
  const cache = new Map<string, string>();
  const tokens = new Map<string, { code: number; body: unknown }>();
  const fetchCount = { n: 0 };
  const drive = { files: new Map<string, { name: string; mime: string; shared: boolean; trashed: boolean }>(), folders: new Map<string, string>(), denySharing: false };
  const activeEmail = { value: "owner@example.com" };
  const alerts: string[] = [];
  const pages: Env["pages"] = new Map();
  const triggers: string[] = [];
  const menus = { n: 0 };
  const ai: Env["ai"] = { handler: null, calls: 0 };
  let locked = false;
  const ui = {
    ButtonSet: { OK: "OK", OK_CANCEL: "OK_CANCEL" }, Button: { OK: "OK", CANCEL: "CANCEL" },
    alert: (...args: string[]) => { alerts.push(args.filter((a) => typeof a === "string").join(" | ")); return "OK"; },
    createMenu: () => { const m: any = { addItem: () => m, addSeparator: () => m, addToUi: () => { menus.n++; } }; return m; },
  };
  const ctxRef: { ctx: any } = { ctx: null };
  const folderObj = (id: string) => ({ getId: () => id, createFile: (blob: any) => {
    const fid = randomUUID(); drive.files.set(fid, { name: blob.name, mime: blob.mime, shared: false, trashed: false });
    return { getId: () => fid, setSharing: () => { if (drive.denySharing) throw new Error("policy"); drive.files.get(fid)!.shared = true; }, setTrashed: () => { drive.files.get(fid)!.trashed = true; } };
  } });
  const sandbox: Record<string, unknown> = {
    console: { error: () => undefined, log: () => undefined },
    uiAvailable: true,
    JSON, Math, Date, Object, Array, String, Number, Error, RegExp, encodeURIComponent, parseInt, isNaN,
    ScriptApp: {
      getProjectTriggers: () => triggers.map((h) => ({ getHandlerFunction: () => h })),
      newTrigger: (h: string) => { const b: any = { forSpreadsheet: () => b, onOpen: () => b, timeBased: () => b, everyDays: () => b, atHour: () => b, create: () => { triggers.push(h); } }; return b; },
    },
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, openById: (id: string) => { const hit = registry.get(id); if (!hit) throw new Error("not found"); return hit; }, getUi: () => { if (!ctxRef.ctx.uiAvailable) throw new Error("Cannot call SpreadsheetApp.getUi() from this context."); return ui; } },
    LockService: { getScriptLock: () => ({ tryLock: () => { if (locked) return false; locked = true; return true; }, releaseLock: () => { locked = false; } }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k: string) => props.get(k) ?? null, setProperty: (k: string, v: string) => { props.set(k, v); } }) },
    CacheService: { getScriptCache: () => ({ get: (k: string) => cache.get(k) ?? null, put: (k: string, v: string) => { cache.set(k, v); } }) },
    Session: { getActiveUser: () => ({ getEmail: () => activeEmail.value }) },
    Utilities: {
      DigestAlgorithm: { SHA_256: "sha256" }, Charset: { UTF_8: "utf8" },
      getUuid: () => randomUUID(),
      newBlob: (bytes: any, mime: string, name: string) => ({ bytes, mime, name }),
      base64Decode: (text: string) => [...Buffer.from(text, "base64")],
      computeDigest: (_alg: string, text: string) => [...createHash("sha256").update(text, "utf8").digest()].map((b) => (b > 127 ? b - 256 : b)),
    },
    UrlFetchApp: {
      fetch: (url: string, options?: { payload?: string }) => {
        if (url.startsWith("https://generativelanguage.googleapis.com/")) {
          ai.calls++;
          const r = ai.handler ? ai.handler(JSON.parse(options?.payload ?? "{}")) : { code: 500, body: {} };
          return { getResponseCode: () => r.code, getHeaders: () => ({}), getContentText: () => JSON.stringify(r.body) };
        }
        if (!url.startsWith("https://oauth2.googleapis.com/tokeninfo")) {
          const page = pages.get(url);
          if (!page) throw new Error("DNS error: " + url);
          if (page.throws) throw new Error(page.throws);
          return { getResponseCode: () => page.code, getHeaders: () => page.headers ?? { "Content-Type": "text/html; charset=utf-8" }, getContentText: () => page.body ?? "" };
        }
        fetchCount.n++;
        const token = decodeURIComponent(url.split("id_token=")[1] ?? "");
        const hit = tokens.get(token) ?? { code: 400, body: { error: "invalid_token" } };
        return { getResponseCode: () => hit.code, getContentText: () => JSON.stringify(hit.body) };
      },
    },
    DriveApp: {
      Access: { ANYONE_WITH_LINK: "ANYONE_WITH_LINK" }, Permission: { VIEW: "VIEW" },
      createFolder: (name: string) => { const id = randomUUID(); drive.folders.set(id, name); return folderObj(id); },
      getFolderById: (id: string) => { if (!drive.folders.has(id)) throw new Error("not found"); return folderObj(id); },
      getFileById: (id: string) => { const f = drive.files.get(id); if (!f) throw new Error("not found"); return { setTrashed: () => { f.trashed = true; } }; },
    },
    ContentService: {
      MimeType: { JSON: "application/json" },
      createTextOutput: (text: string) => { const o: any = { text, setMimeType: () => o }; return o; },
    },
  };
  const ctx = vm.createContext(sandbox);
  ctxRef.ctx = ctx;
  const dir = join(import.meta.dirname, "..", "src");
  const source = readdirSync(dir).filter((f) => f.endsWith(".js")).sort().map((f) => readFileSync(join(dir, f), "utf8")).join("\n");
  vm.runInContext(source, ctx, { filename: "gas-bundle.js" });
  return { ctx, ss, props, cache, tokens, fetchCount, activeEmail, alerts, pages, triggers, menus, ai, drive };
}
