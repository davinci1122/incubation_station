"use client";

import type { Row } from "@/lib/store";
import { Orbs } from "./Orbs";

/** covers: 表紙に並べるアイテム（先頭から最大4件）。 */
export type CollectionSummary = { row: Row; itemIds: string[]; covers: { id: string; image: string }[] };

const LAYOUT: Record<number, string[]> = {
  1: ["col-span-2 row-span-2"],
  2: ["row-span-2", "row-span-2"],
  3: ["row-span-2", "", ""],
  4: ["", "", "", ""],
};

function Tile({ id, image, span }: { id: string; image: string; span: string }) {
  return (
    <div className={`relative overflow-hidden bg-surface ${span}`}>
      <Orbs seed={id} count={3} scale={0.9} />
      {image && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image} alt="" loading="lazy" referrerPolicy="no-referrer" className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.04]" onError={(e) => { e.currentTarget.style.display = "none"; }} />
      )}
    </div>
  );
}

export function CollectionsView({ collections, onOpen, onCreate }: {
  collections: CollectionSummary[];
  onOpen: (id: string) => void;
  onCreate: () => void;
}) {
  return (
    <section aria-labelledby="collections-title">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-[0.14em] text-ink-secondary">{collections.length} collections</p>
          <h1 id="collections-title" className="mt-3 font-display text-5xl font-light leading-none tracking-tight sm:text-7xl">Collections</h1>
        </div>
        <button type="button" onClick={onCreate} className="min-h-11 cursor-pointer rounded-[22px] bg-ink px-5 text-sm text-bg">
          新しいコレクション
        </button>
      </div>

      {collections.length === 0 ? (
        <div className="mt-24 text-center">
          <p className="font-display text-3xl font-light tracking-tight">まだコレクションがありません</p>
          <p className="mt-4 text-sm text-ink-secondary">テーマごとに保存物をまとめられます。同じアイテムを複数のコレクションに入れられます。</p>
        </div>
      ) : (
        <ul className="mt-10 grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-[repeat(auto-fill,minmax(240px,1fr))] sm:gap-x-7 sm:gap-y-10">
          {collections.map(({ row, itemIds, covers }, i) => (
            <li key={row.id} className="anim-rise" style={{ animationDelay: `${Math.min(i, 12) * 50}ms` }}>
              <button type="button" onClick={() => onOpen(row.id ?? "")} className="group block w-full cursor-pointer text-left">
                <div data-media={row.id} className="relative aspect-[4/3] overflow-hidden rounded-[14px] bg-surface">
                  {covers.length === 0 ? (
                    <Orbs seed={row.id ?? ""} count={4} scale={1.2} />
                  ) : (
                    <div className="grid h-full grid-cols-2 grid-rows-2 gap-[3px]">
                      {covers.map((c, k) => (
                        <Tile key={c.id} id={c.id} image={c.image} span={LAYOUT[covers.length]?.[k] ?? ""} />
                      ))}
                    </div>
                  )}
                </div>
                <p className="mt-3 font-display text-xl font-light leading-tight tracking-tight sm:text-2xl">{row.name}</p>
                <p className="mt-1 text-xs text-ink-secondary">{itemIds.length} items</p>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function TagsView({ tags, editing, onToggleEdit, onOpen, onEdit }: {
  tags: { name: string; count: number }[];
  editing: boolean;
  onToggleEdit: () => void;
  onOpen: (name: string) => void;
  onEdit: (name: string) => void;
}) {
  return (
    <section aria-labelledby="tags-title">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-[0.14em] text-ink-secondary">{tags.length} tags</p>
          <h1 id="tags-title" className="mt-3 font-display text-5xl font-light leading-none tracking-tight sm:text-7xl">Tags</h1>
        </div>
        {tags.length > 0 && (
          <button type="button" aria-pressed={editing} onClick={onToggleEdit} className={`min-h-11 cursor-pointer rounded-[22px] border px-4 text-sm ${editing ? "border-ink bg-ink text-bg" : "border-line bg-white/50"}`}>
            {editing ? "完了" : "タグを整理"}
          </button>
        )}
      </div>
      {editing && <p className="mt-4 text-sm text-ink-secondary">タグを押すと、名前の変更・統合・削除ができます。既にある名前に変えると、そのタグに統合されます。</p>}
      {tags.length === 0 ? (
        <p className="mt-16 text-sm text-ink-secondary">アイテムの詳細からタグを付けると、ここに並びます。</p>
      ) : (
        <ul className="mt-10 flex flex-wrap gap-2.5">
          {tags.map((t, i) => (
            <li key={t.name} className="anim-rise" style={{ animationDelay: `${Math.min(i, 20) * 25}ms` }}>
              <button type="button" onClick={() => (editing ? onEdit(t.name) : onOpen(t.name))} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-white/80 bg-white/75 py-0 pl-4 pr-3 text-sm leading-none shadow-[0_1px_0_rgba(30,30,30,0.04)] backdrop-blur-xl">
                <span>{t.name}</span>
                <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-accent-light px-1.5 text-[11px] tabular-nums text-ink-secondary">{t.count}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
