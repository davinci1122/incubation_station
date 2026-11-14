"use client";

import { useEffect, useState } from "react";
import type { Row } from "@/lib/store";
import { shortDate } from "./Card";
import { Orbs } from "./Orbs";

export type ItemActions = {
  update: (item: Row, patch: Record<string, string | boolean>) => Promise<void>;
  setTags: (item: Row, tags: string[]) => Promise<void>;
  refetch: (item: Row) => Promise<void>;
  remove: (item: Row) => Promise<void>;
};

const LABEL = "block text-[11px] uppercase tracking-[0.14em] text-ink-secondary";
const FIELD = "mt-2 block w-full rounded-[14px] border border-line bg-white/70 px-3.5 py-2.5 text-sm outline-none focus:border-ink";
const GHOST = "min-h-11 cursor-pointer rounded-[22px] border border-line px-4 text-sm disabled:opacity-40";

export function ItemPanel({ item, tags, actions, onClose }: {
  item: Row;
  tags: string[];
  actions: ItemActions;
  onClose: () => void;
}) {
  const id = item.id ?? "";
  const [title, setTitle] = useState(item.title ?? "");
  const [note, setNote] = useState(item.user_note ?? "");
  const [tagText, setTagText] = useState(tags.join(", "));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [broken, setBroken] = useState(false);
  const [confirming, setConfirming] = useState(false);

  // 別のアイテムに切り替わったとき、または同期で値が変わったときに入力欄を合わせる。
  useEffect(() => { setTitle(item.title ?? ""); }, [id, item.title]);
  useEffect(() => { setNote(item.user_note ?? ""); }, [id, item.user_note]);
  const joined = tags.join(", ");
  useEffect(() => { setTagText(joined); }, [id, joined]);
  useEffect(() => { setBroken(false); setConfirming(false); setMessage(""); }, [id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(true);
    setMessage("");
    try {
      await fn();
      setMessage(label);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "保存できませんでした。");
    } finally {
      setBusy(false);
    }
  };

  const url = item.original_url ?? "";
  const image = !broken && /^https:\/\//i.test(item.image_url ?? "") ? item.image_url : "";

  return (
    <aside
      aria-label="アイテム詳細"
      className="fixed inset-y-0 right-0 z-20 flex w-full max-w-[480px] flex-col gap-6 overflow-y-auto border-l border-white/70 bg-glass px-6 pb-12 pt-4 backdrop-blur-2xl sm:px-8"
    >
      <button type="button" onClick={onClose} className="min-h-11 cursor-pointer self-end text-sm">
        閉じる
      </button>

      <div className="relative min-h-40 shrink-0 overflow-hidden rounded-[14px] bg-surface">
        <Orbs seed={id} count={4} scale={1.4} />
        {image && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)} className="relative block h-auto w-full" />
        )}
      </div>

      <div>
        <label htmlFor="item-title" className={LABEL}>タイトル</label>
        <input
          id="item-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => { if (title !== (item.title ?? "")) void run("保存しました", () => actions.update(item, { title })); }}
          className={`${FIELD} font-display text-xl font-light`}
        />
        <a href={url} target="_blank" rel="noopener noreferrer" className="mt-3 block break-all text-[13px] underline underline-offset-2">
          {url}
        </a>
        <p className="mt-2 text-xs text-ink-secondary">
          保存 {shortDate(item.created_at ?? "")}
          {item.capture_status === "failed" && " · ページ情報を取得できませんでした"}
          {item.capture_status === "pending" && " · 取得中"}
        </p>
        {item.description && <p className="mt-3 text-[13px] leading-relaxed">{item.description}</p>}
      </div>

      <div className="flex flex-wrap gap-2.5">
        <a href={url} target="_blank" rel="noopener noreferrer" className="flex min-h-11 items-center rounded-[22px] bg-ink px-5 text-sm text-bg no-underline">
          元サイトを開く
        </a>
        <button
          type="button"
          disabled={busy}
          aria-pressed={item.is_favorite === "true"}
          onClick={() => void run("保存しました", () => actions.update(item, { is_favorite: item.is_favorite !== "true" }))}
          className={GHOST}
        >
          {item.is_favorite === "true" ? "★ お気に入り" : "☆ お気に入り"}
        </button>
        <button type="button" disabled={busy} onClick={() => void run("再取得しました", () => actions.refetch(item))} className={GHOST}>
          再取得
        </button>
        <a
          href={`https://web.archive.org/web/${url}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-h-11 items-center rounded-[22px] border border-line px-4 text-sm no-underline"
        >
          Wayback Machineで開く
        </a>
      </div>

      <div>
        <label htmlFor="item-tags" className={LABEL}>タグ（カンマ区切り）</label>
        <input
          id="item-tags"
          value={tagText}
          onChange={(e) => setTagText(e.target.value)}
          onBlur={() => {
            if (tagText.trim() !== joined) {
              const next = tagText.split(/[,、，]/).map((t) => t.trim()).filter(Boolean);
              void run("保存しました", () => actions.setTags(item, next));
            }
          }}
          className={FIELD}
        />
      </div>

      <div>
        <label htmlFor="item-note" className={LABEL}>メモ</label>
        <textarea
          id="item-note"
          rows={5}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => { if (note !== (item.user_note ?? "")) void run("保存しました", () => actions.update(item, { user_note: note })); }}
          className={`${FIELD} resize-y leading-relaxed`}
        />
      </div>

      <p role="status" className="min-h-5 text-xs text-ink-secondary">{busy ? "保存中…" : message}</p>

      {confirming ? (
        <div className="flex flex-wrap items-center gap-2.5 text-sm">
          <span>このアイテムを削除しますか？</span>
          <button type="button" disabled={busy} onClick={() => void run("", async () => { await actions.remove(item); onClose(); })} className="min-h-11 cursor-pointer rounded-[22px] bg-danger px-4 text-white">
            削除する
          </button>
          <button type="button" onClick={() => setConfirming(false)} className={GHOST}>やめる</button>
        </div>
      ) : (
        <button type="button" onClick={() => setConfirming(true)} className="min-h-11 cursor-pointer self-start text-sm text-danger">
          このアイテムを削除
        </button>
      )}
    </aside>
  );
}
