import type { Row, Snapshot } from "./store";

function download(name: string, type: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const stamp = () => new Date().toISOString().slice(0, 10);

/** 表計算ソフトで数式として実行されないようにしたCSVのセル。 */
function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function exportJson(data: Snapshot): void {
  download(`internet-cabinet-${stamp()}.json`, "application/json", JSON.stringify({ exported_at: new Date().toISOString(), tables: data.tables }, null, 2));
}

export function exportCsv(items: Row[], tagsOf: (id: string) => string[], collectionsOf: (id: string) => string[]): void {
  const header = ["title", "url", "domain", "tags", "collections", "note", "summary", "favorite", "saved_at"];
  const lines = items.map((i) =>
    [i.title ?? "", i.original_url ?? "", i.domain ?? "", tagsOf(i.id ?? "").join(", "), collectionsOf(i.id ?? "").join(", "),
      i.user_note ?? "", i.summary ?? "", i.is_favorite === "true" ? "yes" : "", i.created_at ?? ""].map(csvCell).join(","));
  download(`internet-cabinet-${stamp()}.csv`, "text/csv;charset=utf-8", `﻿${header.join(",")}\r\n${lines.join("\r\n")}\r\n`);
}

/** ブラウザに取り込めるブックマーク形式（Netscape Bookmark File）。 */
export function exportBookmarks(items: Row[], tagsOf: (id: string) => string[]): void {
  const rows = items.map((i) => {
    const added = Math.floor(new Date(i.created_at ?? "").getTime() / 1000) || 0;
    return `    <DT><A HREF="${esc(i.original_url ?? "")}" ADD_DATE="${added}" TAGS="${esc(tagsOf(i.id ?? "").join(","))}">${esc(i.title || i.original_url || "")}</A>`;
  });
  download(`internet-cabinet-${stamp()}.html`, "text/html;charset=utf-8",
    `<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n<TITLE>Bookmarks</TITLE>\n<H1>Internet Cabinet</H1>\n<DL><p>\n${rows.join("\n")}\n</DL><p>\n`);
}
