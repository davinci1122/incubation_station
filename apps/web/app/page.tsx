"use client";

import { displayDomain, normalizeUrl } from "@cabinet/url";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { AddUrl } from "@/components/AddUrl";
import { Card } from "@/components/Card";
import { ItemPanel, type ItemActions } from "@/components/ItemPanel";
import { Login } from "@/components/Login";
import { Orbs } from "@/components/Orbs";
import { ApiError } from "@/lib/api";
import { getToken, signOut, subscribeToken } from "@/lib/google";
import { createItem, deleteItem, refetchItem, setItemTags, updateItem } from "@/lib/mutate";
import { clearLocal, getSnapshot, restore, subscribe, sync, type Snapshot } from "@/lib/store";

const EMPTY: Snapshot = {
  cursor: 0, syncing: false, loaded: false,
  tables: { items: [], captures: [], tags: [], item_tags: [], collections: [], collection_items: [], capture_jobs: [] },
};

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : "エラーが発生しました。";
}

export default function HomePage() {
  const token = useSyncExternalStore(subscribeToken, getToken, () => null);
  const data = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY);
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    restore();
  }, []);

  const refresh = useCallback(async () => {
    try {
      await sync();
      setNotice("");
    } catch (e) {
      if (e instanceof ApiError && e.code === "FORBIDDEN") {
        clearLocal();
        await signOut();
        setNotice("このアカウントでは利用できません。");
      } else if (!(e instanceof ApiError && e.code === "UNAUTHENTICATED")) {
        setNotice(messageOf(e));
      }
    }
  }, []);

  useEffect(() => {
    if (token) void refresh();
  }, [token, refresh]);

  const tagsByItem = useMemo(() => {
    const names = new Map<string, string>();
    for (const t of data.tables.tags) if (t.deleted_at === "") names.set(t.id ?? "", t.name ?? "");
    const out = new Map<string, string[]>();
    for (const link of data.tables.item_tags) {
      const name = names.get(link.tag_id ?? "");
      if (link.deleted_at !== "" || !name) continue;
      const key = link.item_id ?? "";
      out.set(key, [...(out.get(key) ?? []), name]);
    }
    for (const list of out.values()) list.sort((a, b) => a.localeCompare(b, "ja"));
    return out;
  }, [data.tables.tags, data.tables.item_tags]);

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.tables.items
      .filter((i) => i.deleted_at === "")
      .filter((i) => {
        if (q === "") return true;
        const text = [i.title, i.original_url, i.domain, i.description, i.excerpt, i.user_note, i.summary, ...(tagsByItem.get(i.id ?? "") ?? [])];
        return text.join("\n").toLowerCase().includes(q);
      })
      .sort((a, b) => ((a.created_at ?? "") < (b.created_at ?? "") ? 1 : -1));
  }, [data.tables.items, query, tagsByItem]);

  const total = useMemo(() => data.tables.items.filter((i) => i.deleted_at === "").length, [data.tables.items]);
  const open = openId ? data.tables.items.find((i) => i.id === openId && i.deleted_at === "") : undefined;

  // 詳細パネルの開閉をブラウザの履歴に載せ、「戻る」で閉じられるようにする。
  useEffect(() => {
    const read = () => {
      const m = /^#item=([0-9a-f-]{36})$/.exec(window.location.hash);
      setOpenId(m ? (m[1] ?? null) : null);
    };
    read();
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, []);

  const openItem = useCallback((id: string) => {
    const target = `#item=${id}`;
    if (window.location.hash.startsWith("#item=")) window.history.replaceState(null, "", target);
    else window.history.pushState(null, "", target);
    setOpenId(id);
  }, []);

  const closeItem = useCallback(() => {
    if (window.location.hash.startsWith("#item=")) window.history.back();
    else setOpenId(null);
  }, []);

  const addUrl = (input: string) => {
    const normalized = normalizeUrl(input);
    if (!normalized) {
      setAddError("http または https で始まるURLを入力してください。");
      return;
    }
    setAdding(false);
    setAddError("");
    setNotice("");
    const { done } = createItem(input, normalized, displayDomain(normalized) ?? "");
    done
      .then((r) => {
        if (r.duplicateOf !== null) {
          setNotice("このURLは保存済みです。");
          openItem(r.duplicateOf);
        }
      })
      .catch((e: unknown) => setNotice(`保存できませんでした。${messageOf(e)}`));
  };

  const friendly = (p: Promise<void>) =>
    p.catch((e: unknown) => {
      if (e instanceof ApiError && e.code === "CONFLICT") throw new Error("他の端末で更新されていたため、最新の内容を読み込みました。もう一度編集してください。");
      throw e;
    });

  const actions: ItemActions = {
    update: (id, patch) => friendly(updateItem(id, patch)),
    setTags: (id, tags) => friendly(setItemTags(id, tags)),
    refetch: (id) => friendly(refetchItem(id)),
    remove: (id) => friendly(deleteItem(id)),
  };

  if (!token) return <Login notice={notice} />;

  return (
    <div className="relative mx-auto min-h-dvh max-w-[1680px] overflow-hidden">
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-[420px] opacity-50">
        <Orbs seed="internet-cabinet-home" count={5} scale={2.6} />
      </div>

      <div className="relative px-5 pb-24 pt-6 sm:px-10">
        <header className="flex flex-wrap items-center gap-3">
          <p className="mr-auto font-display text-2xl font-light leading-none tracking-tight">Internet Cabinet</p>
          <label className="relative order-last flex min-h-11 w-full items-center rounded-[22px] border border-white/80 bg-white/60 px-4 backdrop-blur-xl sm:order-none sm:w-80">
            <span className="sr-only">検索</span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="タイトル、URL、タグ、メモを検索"
              className="w-full bg-transparent text-sm outline-none"
            />
          </label>
          <button type="button" onClick={() => { setAddError(""); setAdding(true); }} className="min-h-11 cursor-pointer rounded-[22px] bg-ink px-5 text-sm text-bg">
            URLを追加
          </button>
          <button type="button" onClick={() => { clearLocal(); void signOut(); }} className="min-h-11 cursor-pointer rounded-[22px] border border-line px-4 text-sm">
            ログアウト
          </button>
        </header>

        <div className="mt-12 flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="font-display text-5xl font-light leading-none tracking-tight sm:text-6xl">
            {query.trim() === "" ? "Recently saved" : "Search"}
          </h1>
          <p className="text-[13px] text-ink-secondary" role="status">
            {data.syncing ? "同期中…" : `${items.length} / ${total} items`}
          </p>
        </div>

        {notice !== "" && (
          <p role="alert" className="mt-4 text-sm text-danger">
            {notice}
          </p>
        )}

        {items.length > 0 ? (
          <div className="mt-9 columns-2 gap-4 sm:gap-6 md:columns-3 xl:columns-4 2xl:columns-5">
            {items.map((item) => (
              <Card key={item.id} item={item} tags={tagsByItem.get(item.id ?? "") ?? []} onOpen={() => openItem(item.id ?? "")} />
            ))}
          </div>
        ) : (
          <div className="mt-24 text-center">
            <p className="font-display text-3xl font-light tracking-tight">
              {data.syncing && total === 0 ? "読み込んでいます…" : total === 0 ? "まだ何も保存されていません" : "見つかりませんでした"}
            </p>
            {!data.syncing && total === 0 && (
              <p className="mt-4 text-sm text-ink-secondary">「URLを追加」から、最初のページを保存してください。</p>
            )}
          </div>
        )}
      </div>

      {open && <ItemPanel item={open} tags={tagsByItem.get(open.id ?? "") ?? []} actions={actions} onClose={closeItem} />}
      {adding && <AddUrl busy={false} error={addError} onSubmit={addUrl} onClose={() => setAdding(false)} />}
    </div>
  );
}
