"use client";

import { useState } from "react";
import { heightFor } from "@/lib/orbs";
import type { Row } from "@/lib/store";
import { Orbs } from "./Orbs";

const KIND: Record<string, string> = { page: "Page", article: "Article", image: "Image", video: "Video", pdf: "PDF" };

export function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}

export function Card({ item, tags, index = 0, selected, onOpen }: { item: Row; tags: string[]; index?: number; selected?: boolean; onOpen: () => void }) {
  const [broken, setBroken] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const id = item.id ?? "";
  const title = item.title || item.domain || item.original_url || "";
  const image = !broken && /^https:\/\//i.test(item.image_url ?? "") ? item.image_url : "";
  const status = item.capture_status;

  return (
    <article className="anim-rise mb-7 break-inside-avoid" style={{ animationDelay: `${Math.min(index, 14) * 40}ms` }}>
      <button type="button" onClick={onOpen} aria-pressed={selected} className="group block w-full cursor-pointer text-left">
        <div
          data-media={id}
          className="relative overflow-hidden rounded-[14px] bg-surface"
          style={image ? { minHeight: 120 } : { height: heightFor(id) }}
        >
          <Orbs seed={id} count={image ? 3 : 4} />
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={image}
              alt=""
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
              onLoad={() => setLoaded(true)}
              onError={() => setBroken(true)}
              className={`relative block h-auto w-full transition-[transform,opacity] duration-700 group-hover:scale-[1.02] ${loaded ? "opacity-100" : "opacity-0"}`}
            />
          ) : (
            <span className="absolute inset-x-4 bottom-4 font-display text-[22px] font-light leading-tight tracking-tight">
              {title}
            </span>
          )}
          {selected !== undefined && (
            <span aria-hidden="true" className={`absolute right-2.5 top-2.5 flex h-7 w-7 items-center justify-center rounded-full border text-sm transition-colors ${selected ? "border-ink bg-ink text-bg" : "border-white bg-white/70 text-transparent"}`}>
              ✓
            </span>
          )}
          {selected && <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-[14px] ring-2 ring-inset ring-ink" />}
          {status === "pending" && (
            <span className="absolute left-2.5 top-2.5 rounded-full bg-white px-2 py-1 text-[11px]">取得中</span>
          )}
          {status === "failed" && (
            <span className="absolute left-2.5 top-2.5 rounded-full bg-white px-2 py-1 text-[11px] text-danger">
              取得できませんでした
            </span>
          )}
        </div>
        <div className="mt-2.5 space-y-1.5">
          <p className="text-sm font-medium leading-snug">
            {item.is_favorite === "true" && <span aria-label="お気に入り">★ </span>}
            {title}
          </p>
          <p className="text-xs text-ink-secondary">
            {[item.domain, KIND[item.content_type ?? ""] ?? "Page", shortDate(item.created_at ?? "")].filter(Boolean).join(" · ")}
          </p>
          {tags.length > 0 && (
            <p className="flex flex-wrap gap-1.5">
              {tags.map((t) => (
                <span key={t} className="rounded-full border border-line px-2 py-0.5 text-[11px] text-ink-secondary">
                  {t}
                </span>
              ))}
            </p>
          )}
        </div>
      </button>
    </article>
  );
}
