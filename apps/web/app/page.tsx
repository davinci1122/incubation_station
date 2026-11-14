"use client";

import { displayDomain, normalizeUrl } from "@cabinet/url";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { AddUrl } from "@/components/AddUrl";
import { Card } from "@/components/Card";
import { CollectionsView, TagsView, type CollectionSummary } from "@/components/Collections";
import { ItemPanel, type ItemActions } from "@/components/ItemPanel";
import { Login } from "@/components/Login";
import { NameDialog } from "@/components/NameDialog";
import { Orbs } from "@/components/Orbs";
import { ApiError } from "@/lib/api";
import { getToken, signOut, subscribeToken } from "@/lib/google";
import { createCollection, createItem, deleteCollection, deleteItem, refetchItem, setItemTags, toggleCollection, updateCollection, updateItem } from "@/lib/mutate";
import { HOME, readRoute, routeHref, type HomeRoute, type Route, type Sort } from "@/lib/route";
import { clearLocal, getSnapshot, restore, subscribe, sync, type Row, type Snapshot } from "@/lib/store";

const EMPTY: Snapshot = {
  cursor: 0, syncing: false, loaded: false, tagOverrides: {},
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
  const [route, setRoute] = useState<Route>(HOME);
  const [dialog, setDialog] = useState<null | { kind: "new"; itemId?: string } | { kind: "rename"; id: string; name: string }>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

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
    for (const [id, names] of Object.entries(data.tagOverrides)) out.set(id, [...names]);
    for (const list of out.values()) list.sort((a, b) => a.localeCompare(b, "ja"));
    return out;
  }, [data.tables.tags, data.tables.item_tags, data.tagOverrides]);

  const liveItems = useMemo(() => data.tables.items.filter((i) => i.deleted_at === ""), [data.tables.items]);

  const tagCounts = useMemo(() => {
    const counts = new Map<string, { name: string; count: number }>();
    for (const i of liveItems) {
      for (const name of tagsByItem.get(i.id ?? "") ?? []) {
        const key = name.toLowerCase();
        const cur = counts.get(key) ?? { name, count: 0 };
        cur.count++;
        counts.set(key, cur);
      }
    }
    return [...counts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "ja"));
  }, [liveItems, tagsByItem]);

  const collections = useMemo<CollectionSummary[]>(() => {
    const alive = new Map(liveItems.map((i) => [i.id ?? "", i]));
    const links = new Map<string, Row[]>();
    for (const l of data.tables.collection_items) {
      if (l.deleted_at !== "" || !alive.has(l.item_id ?? "")) continue;
      const key = l.collection_id ?? "";
      links.set(key, [...(links.get(key) ?? []), l]);
    }
    return data.tables.collections
      .filter((c) => c.deleted_at === "")
      .sort((a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0))
      .map((row) => {
        const itemIds = (links.get(row.id ?? "") ?? [])
          .sort((a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0))
          .map((l) => l.item_id ?? "");
        const cover = itemIds.map((id) => alive.get(id)?.image_url ?? "").find((u) => /^https:\/\//i.test(u)) ?? "";
        return { row, itemIds, cover };
      });
  }, [data.tables.collections, data.tables.collection_items, liveItems]);

  const memberOf = useMemo(() => {
    const out = new Map<string, Set<string>>();
    for (const c of collections) for (const id of c.itemIds) out.set(id, (out.get(id) ?? new Set()).add(c.row.id ?? ""));
    return out;
  }, [collections]);

  const currentCollection = route.view === "collection" ? collections.find((c) => c.row.id === route.id) : undefined;

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = liveItems;
    if (route.view === "collection") {
      const order = new Map((currentCollection?.itemIds ?? []).map((id, i) => [id, i]));
      list = list.filter((i) => order.has(i.id ?? "")).sort((a, b) => (order.get(a.id ?? "") ?? 0) - (order.get(b.id ?? "") ?? 0));
    }
    if (route.view === "home" && route.tag !== "") {
      const key = route.tag.toLowerCase();
      list = list.filter((i) => (tagsByItem.get(i.id ?? "") ?? []).some((t) => t.toLowerCase() === key));
    }
    if (route.view === "home" && route.fav) list = list.filter((i) => i.is_favorite === "true");
    if (q !== "") {
      list = list.filter((i) => {
        const text = [i.title, i.original_url, i.domain, i.description, i.excerpt, i.user_note, i.summary, ...(tagsByItem.get(i.id ?? "") ?? [])];
        return text.join("\n").toLowerCase().includes(q);
      });
    }
    if (route.view === "home") {
      const sort = route.sort;
      list = [...list].sort((a, b) => {
        if (sort === "title") return (a.title || a.domain || "").localeCompare(b.title || b.domain || "", "ja");
        const d = (a.created_at ?? "") < (b.created_at ?? "") ? 1 : -1;
        return sort === "old" ? -d : d;
      });
    }
    return list;
  }, [liveItems, query, tagsByItem, route, currentCollection]);

  const total = liveItems.length;
  const open = openId ? data.tables.items.find((i) => i.id === openId && i.deleted_at === "") : undefined;

  // 詳細パネルの開閉をブラウザの履歴に載せ、「戻る」で閉じられるようにする。
  useEffect(() => {
    const read = () => {
      const m = /^#item=([0-9a-f-]{36})$/.exec(window.location.hash);
      setOpenId(m ? (m[1] ?? null) : null);
      setRoute(readRoute());
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

  const go = useCallback((next: Route) => {
    window.history.pushState(null, "", routeHref(next));
    setRoute(next);
    setOpenId(null);
    setConfirmDelete(false);
    window.scrollTo({ top: 0 });
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
    toggleCollection: (itemId, collectionId, on) => friendly(toggleCollection(itemId, collectionId, on)),
    newCollection: (itemId) => setDialog({ kind: "new", itemId }),
  };

  const homeRoute: HomeRoute = route.view === "home" ? route : HOME;
  const setHome = (patch: Partial<Omit<HomeRoute, "view">>) => go({ ...homeRoute, ...patch });
  const NAV: { label: string; route: Route; active: boolean }[] = [
    { label: "Home", route: HOME, active: route.view === "home" },
    { label: "Collections", route: { view: "collections" }, active: route.view === "collections" || route.view === "collection" },
    { label: "Tags", route: { view: "tags" }, active: route.view === "tags" },
  ];
  const chip = (active: boolean) =>
    `flex min-h-11 shrink-0 cursor-pointer items-center rounded-full border px-4 text-sm ${active ? "border-ink bg-ink text-bg" : "border-line bg-white/50 backdrop-blur"}`;
  const showGrid = route.view === "home" || route.view === "collection";

  if (!token) return <Login notice={notice} />;

  return (
    <div className="relative mx-auto min-h-dvh max-w-[1680px] overflow-hidden">
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-[420px] opacity-50">
        <Orbs seed="internet-cabinet-home" count={5} scale={2.6} />
      </div>

      <div className="relative px-5 pb-32 pt-6 sm:px-10 sm:pb-24">
        <header className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => go(HOME)} className="mr-auto cursor-pointer font-display text-2xl font-light leading-none tracking-tight">
            Internet Cabinet
          </button>
          <nav aria-label="メイン" className="hidden gap-1 sm:flex">
            {NAV.map((n) => (
              <a
                key={n.label}
                href={typeof window === "undefined" ? "#" : routeHref(n.route)}
                aria-current={n.active ? "page" : undefined}
                onClick={(e) => { e.preventDefault(); go(n.route); }}
                className={`flex min-h-11 items-center rounded-full px-4 text-sm no-underline ${n.active ? "bg-accent-light" : "text-ink-secondary"}`}
              >
                {n.label}
              </a>
            ))}
          </nav>
          <label className="relative order-last flex min-h-11 w-full items-center rounded-[22px] border border-white/80 bg-white/60 px-4 backdrop-blur-xl lg:order-none lg:w-72">
            <span className="sr-only">検索</span>
            <input
              type="search"
              value={query}
              onChange={(e) => { setQuery(e.target.value); if (!showGrid) go(HOME); }}
              placeholder="タイトル、URL、タグ、メモを検索"
              className="w-full bg-transparent text-sm outline-none"
            />
          </label>
          <button type="button" onClick={() => { setAddError(""); setAdding(true); }} className="hidden min-h-11 cursor-pointer rounded-[22px] bg-ink px-5 text-sm text-bg sm:block">
            URLを追加
          </button>
          <button type="button" onClick={() => { clearLocal(); void signOut(); }} className="min-h-11 cursor-pointer rounded-[22px] border border-line px-4 text-sm">
            ログアウト
          </button>
        </header>

        {notice !== "" && (
          <p role="alert" className="mt-4 text-sm text-danger">
            {notice}
          </p>
        )}

        <div className="mt-12">
          {route.view === "collections" && (
            <CollectionsView collections={collections} onOpen={(id) => go({ view: "collection", id })} onCreate={() => setDialog({ kind: "new" })} />
          )}
          {route.view === "tags" && <TagsView tags={tagCounts} onOpen={(name) => go({ ...HOME, tag: name })} />}

          {route.view === "home" && (
            <>
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <h1 className="font-display text-5xl font-light leading-none tracking-tight sm:text-6xl [overflow-wrap:anywhere]">
                  {query.trim() !== "" ? "Search" : route.tag !== "" ? `# ${route.tag}` : route.fav ? "Favorites" : "Recently saved"}
                </h1>
                <p className="text-[13px] text-ink-secondary" role="status">
                  {data.syncing ? "同期中…" : `${items.length} / ${total} items`}
                </p>
              </div>
              <div className="-mx-5 mt-6 flex gap-2 overflow-x-auto px-5 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
                <button type="button" aria-pressed={route.tag === "" && !route.fav} onClick={() => setHome({ tag: "", fav: false })} className={chip(route.tag === "" && !route.fav)}>すべて</button>
                <button type="button" aria-pressed={route.fav} onClick={() => setHome({ fav: !route.fav })} className={chip(route.fav)}>★ お気に入り</button>
                {tagCounts.slice(0, 12).map((t) => {
                  const on = route.tag.toLowerCase() === t.name.toLowerCase();
                  return (
                    <button key={t.name} type="button" aria-pressed={on} onClick={() => setHome({ tag: on ? "" : t.name })} className={chip(on)}>
                      {t.name}
                    </button>
                  );
                })}
                <label className="ml-auto flex min-h-11 shrink-0 items-center gap-2 rounded-full border border-line bg-white/50 px-4 text-sm backdrop-blur">
                  <span className="sr-only">並び順</span>
                  <select value={route.sort} onChange={(e) => setHome({ sort: e.target.value as Sort })} className="cursor-pointer bg-transparent outline-none">
                    <option value="new">新しい順</option>
                    <option value="old">古い順</option>
                    <option value="title">タイトル順</option>
                  </select>
                </label>
              </div>
            </>
          )}

          {route.view === "collection" && (
            currentCollection ? (
              <div>
                <a href={typeof window === "undefined" ? "#" : routeHref({ view: "collections" })} onClick={(e) => { e.preventDefault(); go({ view: "collections" }); }} className="text-sm text-ink-secondary no-underline">
                  ← Collections
                </a>
                <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
                  <h1 className="font-display text-5xl font-light leading-none tracking-tight sm:text-7xl [overflow-wrap:anywhere]">{currentCollection.row.name}</h1>
                  <div className="flex flex-wrap items-center gap-2.5">
                    <span className="text-[13px] text-ink-secondary">{currentCollection.itemIds.length} items</span>
                    <button type="button" onClick={() => setDialog({ kind: "rename", id: currentCollection.row.id ?? "", name: currentCollection.row.name ?? "" })} className="min-h-11 cursor-pointer rounded-[22px] border border-line px-4 text-sm">
                      名前を変更
                    </button>
                    {confirmDelete ? (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            const id = currentCollection.row.id ?? "";
                            go({ view: "collections" });
                            deleteCollection(id).catch((e: unknown) => setNotice(messageOf(e)));
                          }}
                          className="min-h-11 cursor-pointer rounded-[22px] bg-danger px-4 text-sm text-white"
                        >
                          削除する（中のアイテムは残ります）
                        </button>
                        <button type="button" onClick={() => setConfirmDelete(false)} className="min-h-11 cursor-pointer rounded-[22px] border border-line px-4 text-sm">やめる</button>
                      </>
                    ) : (
                      <button type="button" onClick={() => setConfirmDelete(true)} className="min-h-11 cursor-pointer px-2 text-sm text-danger">削除</button>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <p className="font-display text-3xl font-light tracking-tight">{data.syncing ? "読み込んでいます…" : "コレクションが見つかりませんでした"}</p>
            )
          )}

          {showGrid && (items.length > 0 ? (
            <div className="mt-9 columns-2 gap-4 sm:gap-6 md:columns-3 xl:columns-4 2xl:columns-5">
              {items.map((item) => (
                <Card key={item.id} item={item} tags={tagsByItem.get(item.id ?? "") ?? []} onOpen={() => openItem(item.id ?? "")} />
              ))}
            </div>
          ) : (
            <div className="mt-24 text-center">
              <p className="font-display text-3xl font-light tracking-tight">
                {data.syncing && total === 0 ? "読み込んでいます…" : total === 0 ? "まだ何も保存されていません" : route.view === "collection" ? "このコレクションはまだ空です" : "見つかりませんでした"}
              </p>
              {!data.syncing && total === 0 && <p className="mt-4 text-sm text-ink-secondary">「URLを追加」から、最初のページを保存してください。</p>}
              {route.view === "collection" && total > 0 && <p className="mt-4 text-sm text-ink-secondary">アイテムの詳細から、このコレクションに追加できます。</p>}
            </div>
          ))}
        </div>
      </div>

      <nav aria-label="メイン" className="fixed inset-x-0 bottom-0 z-10 flex items-center border-t border-white/70 bg-glass px-2 pb-[max(env(safe-area-inset-bottom),8px)] pt-1 backdrop-blur-2xl sm:hidden">
        {NAV.slice(0, 2).map((n) => (
          <button key={n.label} type="button" aria-current={n.active ? "page" : undefined} onClick={() => go(n.route)} className={`min-h-14 flex-1 cursor-pointer text-[11px] ${n.active ? "font-semibold" : "text-ink-secondary"}`}>
            {n.label}
          </button>
        ))}
        <button type="button" aria-label="URLを追加" onClick={() => { setAddError(""); setAdding(true); }} className="mx-1 flex h-12 w-14 shrink-0 cursor-pointer items-center justify-center rounded-full bg-ink text-2xl leading-none text-bg">
          ＋
        </button>
        {NAV.slice(2).map((n) => (
          <button key={n.label} type="button" aria-current={n.active ? "page" : undefined} onClick={() => go(n.route)} className={`min-h-14 flex-1 cursor-pointer text-[11px] ${n.active ? "font-semibold" : "text-ink-secondary"}`}>
            {n.label}
          </button>
        ))}
        <button type="button" onClick={() => go(HOME)} className="min-h-14 flex-1 cursor-pointer text-[11px] text-ink-secondary" aria-label="ホームの先頭へ">
          Top
        </button>
      </nav>

      {open && (
        <ItemPanel
          item={open}
          tags={tagsByItem.get(open.id ?? "") ?? []}
          collections={collections.map((c) => c.row)}
          memberOf={memberOf.get(open.id ?? "") ?? new Set()}
          actions={actions}
          onClose={closeItem}
        />
      )}
      {dialog?.kind === "new" && (
        <NameDialog
          title="新しいコレクション"
          label="コレクションの名前"
          submit="作成"
          onClose={() => setDialog(null)}
          onSubmit={(name) => {
            const itemId = dialog.itemId;
            setDialog(null);
            const id = createCollection(name, itemId);
            if (!itemId) go({ view: "collection", id });
          }}
        />
      )}
      {dialog?.kind === "rename" && (
        <NameDialog
          title="名前を変更"
          label="コレクションの名前"
          initial={dialog.name}
          submit="保存"
          onClose={() => setDialog(null)}
          onSubmit={(name) => {
            const id = dialog.id;
            setDialog(null);
            updateCollection(id, { name }).catch((e: unknown) => setNotice(messageOf(e)));
          }}
        />
      )}
      {adding && <AddUrl busy={false} error={addError} onSubmit={addUrl} onClose={() => setAdding(false)} />}
    </div>
  );
}
