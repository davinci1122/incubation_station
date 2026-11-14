// 画面の状態をURLに載せる（?v=… は画面、#item=… は詳細パネル）。ブラウザの戻る・進むでそのまま動く。
export type Sort = "new" | "old" | "title";
export type HomeRoute = { view: "home"; tag: string; fav: boolean; sort: Sort };
export type Route =
  | HomeRoute
  | { view: "collections" }
  | { view: "collection"; id: string }
  | { view: "tags" }
  | { view: "settings" };

export const HOME: HomeRoute = { view: "home", tag: "", fav: false, sort: "new" };

export function readRoute(): Route {
  const q = new URLSearchParams(window.location.search);
  const v = q.get("v");
  if (v === "collections") return { view: "collections" };
  if (v === "tags") return { view: "tags" };
  if (v === "settings") return { view: "settings" };
  const id = q.get("id") ?? "";
  if (v === "c" && /^[0-9a-f-]{36}$/.test(id)) return { view: "collection", id };
  const sort = q.get("sort");
  return { view: "home", tag: q.get("tag") ?? "", fav: q.get("fav") === "1", sort: sort === "old" || sort === "title" ? sort : "new" };
}

export function routeHref(r: Route): string {
  const q = new URLSearchParams();
  if (r.view === "collections") q.set("v", "collections");
  if (r.view === "tags") q.set("v", "tags");
  if (r.view === "settings") q.set("v", "settings");
  if (r.view === "collection") {
    q.set("v", "c");
    q.set("id", r.id);
  }
  if (r.view === "home") {
    if (r.tag) q.set("tag", r.tag);
    if (r.fav) q.set("fav", "1");
    if (r.sort !== "new") q.set("sort", r.sort);
  }
  const s = q.toString();
  return `${window.location.pathname}${s ? `?${s}` : ""}`;
}
