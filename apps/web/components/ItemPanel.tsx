"use client";

import { useEffect, useState } from "react";
import type { Row } from "@/lib/store";
import { shortDate } from "./Card";
import { Orbs } from "./Orbs";

export type ItemActions = {
  update: (id: string, patch: Record<string, string | boolean>) => Promise<void>;
  setTags: (id: string, tags: string[]) => Promise<void>;
  refetch: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  toggleCollection: (itemId: string, collectionId: string, on: boolean) => Promise<void>;
  newCollection: (itemId: string) => void;
};

const LABEL = "block text-[11px] uppercase tracking-[0.14em] text-ink-secondary";
const FIELD = "mt-2 block w-full rounded-[14px] border border-line bg-white/70 px-3.5 py-2.5 text-sm outline-none focus:border-ink";
const GHOST = "min-h-11 cursor-pointer rounded-[22px] border border-line px-4 text-sm disabled:opacity-40";

/** 保存日ごろの姿を Internet Archive（Wayback Machine）で開くURL。 */
function waybackUrl(url: string, savedAt: string): string {
  const d = new Date(savedAt);
  const stamp = Number.isNaN(d.getTime())
    ? ""
    : `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
  return `https://web.archive.org/web/${stamp}/${url}`;
}

export function ItemPanel({ item, tags, collections, memberOf, actions, onClose }: {
  item: Row;
  tags: string[];
  collections: Row[];
  memberOf: Set<string>;
  actions: ItemActions;
  onClose: () => void;
}) {
  const id = item.id ?? "";
  const [title, setTitle] = useState(item.title ?? "");
  const [editingTitle, setEditingTitle] = useState(false);
  const [note, setNote] = useState(item.user_note ?? "");
  const [tagText, setTagText] = useState(tags.join(", "));
  const [message, setMessage] = useState("");
  const [broken, setBroken] = useState(false);
  const [confirming, setConfirming] = useState(false);

  // 別のアイテムに切り替わったとき、または同期で値が変わったときに入力欄を合わせる。
  useEffect(() => { setTitle(item.title ?? ""); }, [id, item.title]);
  useEffect(() => { setNote(item.user_note ?? ""); }, [id, item.user_note]);
  const joined = tags.join(", ");
  useEffect(() => { setTagText(joined); }, [id, joined]);
  useEffect(() => { setBroken(false); setConfirming(false); setMessage(""); setEditingTitle(false); }, [id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // 画面は先に変わっているので、ここでは失敗したときだけ知らせる。
  const guard = (p: Promise<void>) => {
    setMessage("");
    p.catch((e: unknown) => setMessage(e instanceof Error ? e.message : "保存できませんでした。"));
  };

  const url = item.original_url ?? "";
  const image = !broken && /^https:\/\//i.test(item.image_url ?? "") ? item.image_url : "";
  const shownTitle = item.title || item.domain || url;
  const favorite = item.is_favorite === "true";

  return (
    <aside
      aria-label="アイテム詳細"
      className="item-panel fixed inset-y-0 right-0 z-20 flex w-full max-w-[480px] flex-col gap-6 overflow-y-auto border-l border-white/70 bg-glass px-6 pb-12 pt-4 backdrop-blur-2xl sm:px-8"
    >
      <button type="button" onClick={onClose} className="min-h-11 cursor-pointer self-end text-sm">
        閉じる
      </button>

      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`元サイトを開く: ${shownTitle}`}
        className="vt-hero relative block min-h-40 shrink-0 overflow-hidden rounded-[14px] bg-surface"
      >
        <Orbs seed={id} count={4} scale={1.4} />
        {image && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)} className="relative block h-auto w-full" />
        )}
      </a>

      <div>
        {editingTitle ? (
          <>
            <label htmlFor="item-title" className={LABEL}>タイトル</label>
            <textarea
              id="item-title"
              autoFocus
              rows={3}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => {
                setEditingTitle(false);
                const next = title.replace(/\s+/g, " ").trim();
                if (next !== (item.title ?? "")) guard(actions.update(id, { title: next }));
              }}
              className={`${FIELD} resize-none font-display text-xl font-light leading-snug`}
            />
          </>
        ) : (
          <h2 className="font-display text-[26px] font-light leading-snug tracking-tight [overflow-wrap:anywhere]">{shownTitle}</h2>
        )}
        <p className="mt-2 text-xs text-ink-secondary">
          {[item.domain, `保存 ${shortDate(item.created_at ?? "")}`].filter(Boolean).join(" · ")}
          {item.capture_status === "failed" && " · ページ情報を取得できませんでした"}
          {item.capture_status === "pending" && " · 取得中"}
        </p>
        {item.description && <p className="mt-3 text-[13px] leading-relaxed">{item.description}</p>}
      </div>

      <div className="flex flex-wrap gap-2.5">
        <a href={url} target="_blank" rel="noopener noreferrer" className="flex min-h-11 items-center rounded-[22px] bg-ink px-5 text-sm text-bg no-underline">
          元サイトを開く
        </a>
        <button type="button" aria-pressed={favorite} onClick={() => guard(actions.update(id, { is_favorite: !favorite }))} className={GHOST}>
          {favorite ? "★ お気に入り" : "☆ お気に入り"}
        </button>
        {!editingTitle && (
          <button type="button" onClick={() => setEditingTitle(true)} className={GHOST}>
            タイトルを編集
          </button>
        )}
      </div>

      <div>
        <label htmlFor="item-tags" className={LABEL}>タグ（カンマ区切り）</label>
        <input
          id="item-tags"
          value={tagText}
          onChange={(e) => setTagText(e.target.value)}
          onBlur={() => {
            if (tagText.trim() !== joined) {
              guard(actions.setTags(id, tagText.split(/[,、，]/).map((t) => t.trim()).filter(Boolean)));
            }
          }}
          className={FIELD}
        />
      </div>

      <div>
        <p className={LABEL}>コレクション</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {collections.map((c) => {
            const on = memberOf.has(c.id ?? "");
            return (
              <button
                key={c.id}
                type="button"
                aria-pressed={on}
                onClick={() => guard(actions.toggleCollection(id, c.id ?? "", !on))}
                className={`min-h-11 cursor-pointer rounded-full border px-4 text-sm ${on ? "border-ink bg-ink text-bg" : "border-line bg-white/50"}`}
              >
                {c.name}
              </button>
            );
          })}
          <button type="button" onClick={() => actions.newCollection(id)} className="min-h-11 cursor-pointer rounded-full border border-dashed border-muted px-4 text-sm text-ink-secondary">
            ＋ 新しいコレクション
          </button>
        </div>
      </div>

      <div>
        <label htmlFor="item-note" className={LABEL}>メモ</label>
        <textarea
          id="item-note"
          rows={5}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => { if (note !== (item.user_note ?? "")) guard(actions.update(id, { user_note: note })); }}
          className={`${FIELD} resize-y leading-relaxed`}
        />
      </div>

      {message !== "" && <p role="alert" className="text-sm text-danger">{message}</p>}

      <div className="flex flex-wrap gap-2.5">
        <button type="button" disabled={item.capture_status === "pending"} onClick={() => guard(actions.refetch(id))} className={GHOST}>
          ページ情報を再取得
        </button>
        <a
          href={waybackUrl(url, item.created_at ?? "")}
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-h-11 items-center rounded-[22px] border border-line px-4 text-sm no-underline"
        >
          保存した頃の姿を見る（Wayback Machine）
        </a>
      </div>

      {confirming ? (
        <div className="flex flex-wrap items-center gap-2.5 text-sm">
          <span>このアイテムを削除しますか？</span>
          <button type="button" onClick={() => { guard(actions.remove(id)); onClose(); }} className="min-h-11 cursor-pointer rounded-[22px] bg-danger px-4 text-white">
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
