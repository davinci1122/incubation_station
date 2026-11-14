"use client";

import type { Row } from "@/lib/store";
import { Orbs } from "./Orbs";

export type CollectionSummary = { row: Row; itemIds: string[]; cover: string };

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
          {collections.map(({ row, itemIds, cover }) => (
            <li key={row.id}>
              <button type="button" onClick={() => onOpen(row.id ?? "")} className="group block w-full cursor-pointer text-left">
                <div className="relative aspect-[4/3] overflow-hidden rounded-[14px] bg-surface">
                  <Orbs seed={row.id ?? ""} count={4} scale={1.2} />
                  {cover && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={cover} alt="" loading="lazy" referrerPolicy="no-referrer" className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" onError={(e) => { e.currentTarget.style.display = "none"; }} />
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

export function TagsView({ tags, onOpen }: { tags: { name: string; count: number }[]; onOpen: (name: string) => void }) {
  return (
    <section aria-labelledby="tags-title">
      <p className="text-[11px] uppercase tracking-[0.14em] text-ink-secondary">{tags.length} tags</p>
      <h1 id="tags-title" className="mt-3 font-display text-5xl font-light leading-none tracking-tight sm:text-7xl">Tags</h1>
      {tags.length === 0 ? (
        <p className="mt-16 text-sm text-ink-secondary">アイテムの詳細からタグを付けると、ここに並びます。</p>
      ) : (
        <ul className="mt-10 flex flex-wrap gap-2.5">
          {tags.map((t) => (
            <li key={t.name}>
              <button type="button" onClick={() => onOpen(t.name)} className="flex min-h-11 cursor-pointer items-baseline gap-2 rounded-full border border-line bg-white/50 px-4 text-sm backdrop-blur">
                <span>{t.name}</span>
                <span className="text-xs text-ink-secondary">{t.count}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
