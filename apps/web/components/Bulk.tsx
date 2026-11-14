"use client";

import { useEffect, useState } from "react";
import type { Row } from "@/lib/store";
import { Orbs } from "./Orbs";

const BTN = "min-h-11 shrink-0 cursor-pointer rounded-[22px] border border-line bg-white/60 px-4 text-sm disabled:opacity-40";

/** 複数選択中に画面下に出る操作バー。 */
export function BulkBar({ count, inCollection, onTags, onCollection, onRemoveFromCollection, onDelete, onCancel }: {
  count: number;
  inCollection: boolean;
  onTags: () => void;
  onCollection: () => void;
  onRemoveFromCollection: () => void;
  onDelete: () => void;
  onCancel: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  useEffect(() => { if (count === 0) setConfirming(false); }, [count]);
  const none = count === 0;
  return (
    <div role="toolbar" aria-label="選択したアイテムの操作" className="anim-sheet fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+76px)] z-10 mx-auto flex max-w-3xl items-center gap-2 overflow-x-auto rounded-[26px] border border-white/70 bg-glass p-2 backdrop-blur-2xl sm:bottom-6">
      <span className="shrink-0 px-3 text-sm tabular-nums">{count} 件を選択</span>
      {confirming ? (
        <>
          <button type="button" onClick={() => { setConfirming(false); onDelete(); }} className="min-h-11 shrink-0 cursor-pointer rounded-[22px] bg-danger px-4 text-sm text-white">{count} 件を削除する</button>
          <button type="button" onClick={() => setConfirming(false)} className={BTN}>やめる</button>
        </>
      ) : (
        <>
          <button type="button" disabled={none} onClick={onTags} className={BTN}>タグを追加</button>
          <button type="button" disabled={none} onClick={onCollection} className={BTN}>コレクションに追加</button>
          {inCollection && <button type="button" disabled={none} onClick={onRemoveFromCollection} className={BTN}>このコレクションから外す</button>}
          <button type="button" disabled={none} onClick={() => setConfirming(true)} className={`${BTN} text-danger`}>削除</button>
        </>
      )}
      <button type="button" onClick={onCancel} className="ml-auto min-h-11 shrink-0 cursor-pointer rounded-[22px] bg-ink px-4 text-sm text-bg">完了</button>
    </div>
  );
}

/** コレクションを1つ選ぶダイアログ。 */
export function CollectionPicker({ collections, onPick, onNew, onClose }: {
  collections: Row[];
  onPick: (id: string) => void;
  onNew: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="anim-fade fixed inset-0 z-40 flex items-end justify-center bg-ink/20 sm:items-center sm:p-6" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="picker-title" onClick={(e) => e.stopPropagation()} className="anim-sheet max-h-[80dvh] w-full max-w-md overflow-y-auto rounded-t-[22px] border border-white/70 bg-glass p-6 backdrop-blur-2xl sm:rounded-[22px]">
        <h2 id="picker-title" className="font-display text-3xl font-light tracking-tight">コレクションに追加</h2>
        <ul className="mt-5 space-y-2">
          {collections.map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => onPick(c.id ?? "")} className="min-h-11 w-full cursor-pointer rounded-[22px] border border-line bg-white/60 px-4 text-left text-sm">{c.name}</button>
            </li>
          ))}
          <li>
            <button type="button" onClick={onNew} className="min-h-11 w-full cursor-pointer rounded-[22px] border border-dashed border-muted px-4 text-left text-sm text-ink-secondary">＋ 新しいコレクション</button>
          </li>
        </ul>
        <div className="mt-6 flex justify-end">
          <button type="button" onClick={onClose} className={BTN}>キャンセル</button>
        </div>
      </div>
    </div>
  );
}

/** コレクション内の並べ替え。ドラッグ（PC）または上下ボタンで順番を変える。 */
export function ReorderList({ items, onSave, onCancel }: { items: Row[]; onSave: (ids: string[]) => void; onCancel: () => void }) {
  const [order, setOrder] = useState(() => items.map((i) => i.id ?? ""));
  const [dragging, setDragging] = useState<string | null>(null);
  const byId = new Map(items.map((i) => [i.id ?? "", i]));
  const move = (from: number, to: number) => {
    if (to < 0 || to >= order.length || from === to) return;
    const next = [...order];
    const [id] = next.splice(from, 1);
    if (id === undefined) return;
    next.splice(to, 0, id);
    setOrder(next);
  };
  const ARROW = "flex h-11 w-11 cursor-pointer items-center justify-center rounded-full border border-line bg-white/60 text-sm disabled:opacity-30";
  return (
    <div className="mt-8 max-w-2xl">
      <div className="flex flex-wrap items-center gap-2.5">
        <p className="mr-auto text-sm text-ink-secondary">ドラッグするか、矢印で順番を変えてください。</p>
        <button type="button" onClick={onCancel} className={BTN}>キャンセル</button>
        <button type="button" onClick={() => onSave(order)} className="min-h-11 cursor-pointer rounded-[22px] bg-ink px-5 text-sm text-bg">順番を保存</button>
      </div>
      <ol className="mt-5 space-y-2">
        {order.map((id, i) => {
          const item = byId.get(id);
          if (!item) return null;
          const image = /^https:\/\//i.test(item.image_url ?? "") ? item.image_url : "";
          return (
            <li
              key={id}
              draggable
              onDragStart={(e) => { setDragging(id); e.dataTransfer.effectAllowed = "move"; }}
              onDragEnd={() => setDragging(null)}
              onDragOver={(e) => {
                e.preventDefault();
                if (dragging && dragging !== id) move(order.indexOf(dragging), i);
              }}
              className={`flex cursor-grab items-center gap-3 rounded-[18px] border border-white/70 bg-white/60 p-2 backdrop-blur transition-opacity ${dragging === id ? "opacity-40" : ""}`}
            >
              <span className="w-6 shrink-0 text-center text-xs tabular-nums text-ink-secondary">{i + 1}</span>
              <span className="relative h-12 w-16 shrink-0 overflow-hidden rounded-[10px] bg-surface">
                <Orbs seed={id} count={2} scale={0.5} />
                {image && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={image} alt="" loading="lazy" referrerPolicy="no-referrer" className="absolute inset-0 h-full w-full object-cover" onError={(e) => { e.currentTarget.style.display = "none"; }} />
                )}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm">{item.title || item.domain || item.original_url}</span>
              <button type="button" aria-label="上へ" disabled={i === 0} onClick={() => move(i, i - 1)} className={ARROW}>↑</button>
              <button type="button" aria-label="下へ" disabled={i === order.length - 1} onClick={() => move(i, i + 1)} className={ARROW}>↓</button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
