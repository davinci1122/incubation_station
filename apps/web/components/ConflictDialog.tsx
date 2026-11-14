"use client";

import type { Conflict } from "@/lib/mutate";

const LABELS: Record<string, string> = { title: "タイトル", user_note: "メモ", is_favorite: "お気に入り", summary: "要約", description: "説明" };
const show = (key: string, value: string) => (key === "is_favorite" ? (value === "true" ? "オン" : "オフ") : value === "" ? "（空）" : value);

/** 他の端末の変更とぶつかったとき、どちらを残すかを選ぶ。自動では上書きしない。 */
export function ConflictDialog({ conflict, remaining, onResolve }: {
  conflict: Conflict;
  remaining: number;
  onResolve: (choice: "mine" | "theirs") => void;
}) {
  const keys = Object.keys(conflict.patch);
  return (
    <div className="anim-fade fixed inset-0 z-50 flex items-end justify-center bg-ink/20 sm:items-center sm:p-6">
      <div role="alertdialog" aria-modal="true" aria-labelledby="conflict-title" className="anim-sheet max-h-[86dvh] w-full max-w-2xl overflow-y-auto rounded-t-[22px] border border-white/70 bg-glass p-6 backdrop-blur-2xl sm:rounded-[22px]">
        <h2 id="conflict-title" className="font-display text-3xl font-light tracking-tight">他の端末でも編集されています</h2>
        <p className="mt-2 text-sm text-ink-secondary">
          「{conflict.current.title || conflict.current.domain}」が、この端末の編集を送る前に別の端末で更新されていました。残す方を選んでください。
          {remaining > 1 && `（あと ${remaining - 1} 件）`}
        </p>
        <div className="mt-5 space-y-4">
          {keys.map((k) => (
            <div key={k}>
              <p className="text-[11px] uppercase tracking-[0.14em] text-ink-secondary">{LABELS[k] ?? k}</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <div className="rounded-[14px] border border-line bg-white/70 p-3">
                  <p className="text-xs text-ink-secondary">この端末</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">{show(k, conflict.patch[k] ?? "")}</p>
                </div>
                <div className="rounded-[14px] border border-line bg-white/70 p-3">
                  <p className="text-xs text-ink-secondary">他の端末（現在保存されている内容）</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">{show(k, conflict.current[k] ?? "")}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-6 flex flex-wrap justify-end gap-2.5">
          <button type="button" onClick={() => onResolve("theirs")} className="min-h-11 cursor-pointer rounded-[22px] border border-line px-5 text-sm">他の端末の内容を使う</button>
          <button type="button" onClick={() => onResolve("mine")} className="min-h-11 cursor-pointer rounded-[22px] bg-ink px-5 text-sm text-bg">この端末の内容で上書き</button>
        </div>
      </div>
    </div>
  );
}
