"use client";

import { useState } from "react";
import type { Row } from "@/lib/store";
import { shortDate } from "./Card";

const H2 = "font-display text-2xl font-light tracking-tight";
const BTN = "min-h-11 cursor-pointer rounded-[22px] border border-line bg-white/50 px-4 text-sm";

export function SettingsView({ appUrl, trash, onRestore, onExport, onLogout }: {
  appUrl: string;
  trash: Row[];
  onRestore: (id: string) => void;
  onExport: (kind: "json" | "csv" | "html") => void;
  onLogout: () => void;
}) {
  const [copied, setCopied] = useState("");
  const bookmarklet = `javascript:location.href='${appUrl}?add='+encodeURIComponent(location.href)`;
  const copy = (label: string, text: string) => {
    navigator.clipboard.writeText(text).then(() => setCopied(label), () => setCopied(""));
  };

  return (
    <section aria-labelledby="settings-title" className="max-w-2xl">
      <h1 id="settings-title" className="font-display text-5xl font-light leading-none tracking-tight sm:text-7xl">Settings</h1>

      <div className="mt-12 space-y-12">
        <div>
          <h2 className={H2}>すばやく保存する</h2>
          <dl className="mt-4 space-y-5 text-sm leading-relaxed">
            <div>
              <dt className="font-medium">スマホ: ホーム画面に追加</dt>
              <dd className="mt-1 text-ink-secondary">ブラウザの共有メニューから「ホーム画面に追加」を選ぶと、アプリのように開けます。Androidでは、他のアプリの共有メニューに「Cabinet」が出て、そのまま保存できます。</dd>
            </div>
            <div>
              <dt className="font-medium">PC: ブックマークレット</dt>
              <dd className="mt-1 text-ink-secondary">
                下のコードをコピーし、ブックマークのURL欄に貼り付けて登録します。保存したいページでそのブックマークを押すと、このアプリが開いて保存されます。
                <code className="mt-2 block break-all rounded-[14px] border border-line bg-white/60 p-3 text-xs text-ink">{bookmarklet}</code>
                <button type="button" onClick={() => copy("bookmarklet", bookmarklet)} className={`${BTN} mt-2`}>{copied === "bookmarklet" ? "コピーしました" : "コードをコピー"}</button>
              </dd>
            </div>
            <div>
              <dt className="font-medium">iPhone: ショートカット</dt>
              <dd className="mt-1 text-ink-secondary">
                「ショートカット」アプリで、共有シートから受け取ったURLを使って次のURLを開くショートカットを作ると、共有メニューから保存できます。
                <code className="mt-2 block break-all rounded-[14px] border border-line bg-white/60 p-3 text-xs text-ink">{appUrl}?add=［共有されたURL］</code>
                <button type="button" onClick={() => copy("shortcut", `${appUrl}?add=`)} className={`${BTN} mt-2`}>{copied === "shortcut" ? "コピーしました" : "URLの前半をコピー"}</button>
              </dd>
            </div>
          </dl>
        </div>

        <div>
          <h2 className={H2}>エクスポート</h2>
          <p className="mt-2 text-sm text-ink-secondary">この端末に同期済みのデータを書き出します。元データはスプレッドシートにあります。</p>
          <div className="mt-4 flex flex-wrap gap-2.5">
            <button type="button" onClick={() => onExport("json")} className={BTN}>JSON（全データ）</button>
            <button type="button" onClick={() => onExport("csv")} className={BTN}>CSV（一覧）</button>
            <button type="button" onClick={() => onExport("html")} className={BTN}>HTML（ブラウザのブックマーク形式）</button>
          </div>
        </div>

        <div>
          <h2 className={H2}>ゴミ箱</h2>
          {trash.length === 0 ? (
            <p className="mt-2 text-sm text-ink-secondary">削除したアイテムはありません。</p>
          ) : (
            <ul className="mt-4 divide-y divide-line border-y border-line">
              {trash.map((i) => (
                <li key={i.id} className="flex items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{i.title || i.original_url}</p>
                    <p className="text-xs text-ink-secondary">{i.domain} · 削除 {shortDate(i.deleted_at ?? "")}</p>
                  </div>
                  <button type="button" onClick={() => onRestore(i.id ?? "")} className={BTN}>元に戻す</button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <h2 className={H2}>アカウント</h2>
          <button type="button" onClick={onLogout} className={`${BTN} mt-4`}>ログアウト</button>
        </div>
      </div>
    </section>
  );
}
