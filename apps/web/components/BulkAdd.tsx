"use client";

import { useState } from "react";
import { displayDomain, normalizeUrl } from "@cabinet/url";
import { createItem } from "@/lib/mutate";
import { getSnapshot } from "@/lib/store";

const H2 = "font-display text-2xl font-light tracking-tight";
const BTN = "min-h-11 cursor-pointer rounded-[22px] border border-line bg-white/50 px-4 text-sm disabled:cursor-default disabled:opacity-40";

type Plan = { fresh: string[]; skipped: number; invalid: number };

/** 貼り付けられた文章から http(s) のURLを順番に取り出す。 */
export function extractUrls(text: string): string[] {
  return text.match(/https?:\/\/[^\s<>"'、。）」]+/gi) ?? [];
}

export function BulkAdd() {
  const [text, setText] = useState("");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [message, setMessage] = useState("");

  const check = () => {
    setMessage("");
    const urls = extractUrls(text);
    const saved = new Set(
      getSnapshot().tables.items.filter((i) => i.deleted_at === "").map((i) => i.normalized_url),
    );
    const seen = new Set<string>();
    const fresh: string[] = [];
    let skipped = 0;
    let invalid = 0;
    for (const url of urls) {
      const normalized = normalizeUrl(url);
      if (!normalized) { invalid += 1; continue; }
      if (saved.has(normalized) || seen.has(normalized)) { skipped += 1; continue; }
      seen.add(normalized);
      fresh.push(url);
    }
    setPlan({ fresh, skipped, invalid });
  };

  const run = () => {
    if (!plan || plan.fresh.length === 0) return;
    let added = 0;
    for (const url of plan.fresh) {
      const normalized = normalizeUrl(url);
      if (!normalized) continue;
      createItem(url, normalized, displayDomain(normalized) ?? "");
      added += 1;
    }
    setMessage(`${added} 件を登録しました。ページ情報は順番に取得します（オフラインなら、つながったときに送ります）。`);
    setText("");
    setPlan(null);
  };

  return (
    <div>
      <h2 className={H2}>URLをまとめて追加</h2>
      <p className="mt-2 text-sm text-ink-secondary">
        URLを含む文章をそのまま貼り付けられます（Notionからコピーしたリンクなど）。登録済みのURLと重複は飛ばします。
      </p>
      <textarea
        aria-label="URLを貼り付け"
        value={text}
        onChange={(e) => { setText(e.target.value); setPlan(null); }}
        rows={6}
        placeholder="https://..."
        className="mt-4 block w-full rounded-[18px] border border-line bg-white/70 px-4 py-3 text-base outline-none focus:border-ink sm:text-sm"
      />
      <div className="mt-3 flex flex-wrap gap-2.5">
        <button type="button" onClick={check} disabled={text.trim() === ""} className={BTN}>確認する</button>
        <button type="button" onClick={run} disabled={!plan || plan.fresh.length === 0} className={BTN}>
          {plan ? `${plan.fresh.length} 件を登録する` : "登録する"}
        </button>
      </div>
      {plan && (
        <dl className="mt-4 space-y-1 text-sm text-ink-secondary">
          <div>新しく登録: {plan.fresh.length} 件</div>
          <div>登録済みなどで飛ばす: {plan.skipped} 件</div>
          {plan.invalid > 0 && <div>URLとして読めない: {plan.invalid} 件</div>}
        </dl>
      )}
      {message && <p className="mt-3 text-sm text-ink-secondary" role="status">{message}</p>}
    </div>
  );
}
