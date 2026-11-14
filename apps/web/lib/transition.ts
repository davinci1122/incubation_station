import { flushSync } from "react-dom";

// 画面の切り替えを View Transitions API でなめらかにする。非対応のブラウザや「視差効果を減らす」設定ではそのまま切り替える。
type ViewTransition = { finished: Promise<void> };
type DocWithVT = Document & { startViewTransition?: (update: () => void) => ViewTransition };

function supported(): boolean {
  const doc = document as DocWithVT;
  return typeof doc.startViewTransition === "function" && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function start(update: () => void, kind?: string): ViewTransition | null {
  if (!supported()) {
    update();
    return null;
  }
  const root = document.documentElement;
  if (kind) root.dataset.vt = kind;
  const vt = (document as DocWithVT).startViewTransition!(() => flushSync(update));
  vt.finished.finally(() => {
    if (root.dataset.vt === kind) delete root.dataset.vt;
  });
  return vt;
}

function media(id: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-media="${CSS.escape(id)}"]`);
}

/** 画面（ビュー）の切り替え。 */
export function routeTransition(update: () => void): void {
  start(update, "route");
}

/** カードから詳細パネルへ。カードの画像がパネルの画像へ移っていくように見せる。 */
export function openTransition(id: string, update: () => void): void {
  const from = supported() ? media(id) : null;
  if (from) from.style.setProperty("view-transition-name", "hero");
  start(() => {
    if (from) from.style.removeProperty("view-transition-name");
    update();
  }, "panel");
}

/** 詳細パネルからカードへ戻る。 */
export function closeTransition(update: () => void): void {
  // 閉じるときは画像を別扱いにせず、パネル全体をひとまとまりで右へ送り出す。
  start(update, "close");
}
