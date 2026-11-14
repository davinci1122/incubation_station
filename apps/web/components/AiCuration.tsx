"use client";

import { useRef, useState } from "react";
import { ApiError, call } from "@/lib/api";
import { sync } from "@/lib/store";

const H2 = "font-display text-2xl font-light tracking-tight";
const BTN = "min-h-11 cursor-pointer rounded-[22px] border border-line bg-white/50 px-4 text-sm disabled:cursor-default disabled:opacity-40";

type Estimate = {
  count: number; model: string; inputTokens: number; outputTokens: number;
  costJpy: number; spentJpy: number; limitJpy: number; withinLimit: boolean; hasKey: boolean;
};
type Suggestion = { id: string; title: string; domain: string; tags: string[]; summary: string };
type Batch = {
  suggestions: Suggestion[]; processed: string[]; remaining: number;
  costJpy: number; spentJpy: number; limitJpy: number; stopped: string;
};

const yen = (v: number) => (v < 1 ? `${Math.round(v * 100) / 100}円` : `${Math.round(v)}円`);
const errorText = (e: unknown) => (e instanceof ApiError ? e.message : "処理できませんでした。通信を確認してもう一度お試しください。");

export function AiCuration() {
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [phase, setPhase] = useState<"idle" | "running" | "review">("idle");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [found, setFound] = useState<Suggestion[]>([]);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const cancelled = useRef(false);

  const checkEstimate = async () => {
    setMessage("");
    setBusy(true);
    try {
      setEstimate(await call<Estimate>("ai.estimate"));
    } catch (e) {
      setMessage(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const run = async () => {
    cancelled.current = false;
    setPhase("running");
    setFound([]);
    setPicked({});
    setMessage("");
    const exclude: string[] = [];
    const all: Suggestion[] = [];
    let stopped = "";
    try {
      for (;;) {
        const r = await call<Batch>("ai.curate", { exclude });
        exclude.push(...r.processed);
        all.push(...r.suggestions);
        setFound([...all]);
        setProgress({ done: exclude.length, total: exclude.length + r.remaining });
        setEstimate((prev) => (prev ? { ...prev, spentJpy: r.spentJpy } : prev));
        if (r.stopped) { stopped = r.stopped; break; }
        if (r.processed.length === 0 || r.remaining === 0) break;
        if (cancelled.current) { stopped = "途中で止めました。ここまでの提案は確認して反映できます。"; break; }
      }
    } catch (e) {
      stopped = errorText(e);
    }
    setPicked(Object.fromEntries(all.map((s) => [s.id, true])));
    setMessage(stopped);
    setPhase("review");
  };

  const apply = async () => {
    const chosen = found.filter((s) => picked[s.id]);
    if (chosen.length === 0) return;
    setBusy(true);
    try {
      await call("ai.apply", {
        suggestions: chosen.map((s) => ({ id: s.id, tags: s.tags, summary: s.summary })),
      });
      await sync();
      setMessage(`${chosen.length} 件に反映しました。`);
      setFound([]);
      setPicked({});
      setPhase("idle");
      setEstimate(null);
    } catch (e) {
      setMessage(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const canRun = !!estimate && estimate.hasKey && estimate.count > 0 && estimate.withinLimit;
  const selectedCount = found.filter((s) => picked[s.id]).length;

  return (
    <div>
      <h2 className={H2}>AIで整理（任意）</h2>
      <p className="mt-2 text-sm text-ink-secondary">
        タグや要約がないアイテムに、AIが提案を付けます。提案は確認してから反映されます。保存のたびに自動で動くことはありません。
      </p>

      {phase === "idle" && (
        <>
          <div className="mt-4 flex flex-wrap gap-2.5">
            <button type="button" onClick={checkEstimate} disabled={busy} className={BTN}>見積もりを見る</button>
            <button type="button" onClick={run} disabled={busy || !canRun} className={BTN}>
              {estimate ? `${estimate.count} 件を整理する` : "整理する"}
            </button>
          </div>
          {estimate && (
            <dl className="mt-4 space-y-1 text-sm text-ink-secondary">
              <div>対象: {estimate.count} 件（{estimate.model}）</div>
              <div>予想費用: 最大 約{yen(estimate.costJpy)}</div>
              <div>今月の累計: {yen(estimate.spentJpy)} / 上限 {yen(estimate.limitJpy)}</div>
              {!estimate.hasKey && <div className="text-ink">APIキーが未設定です。スプレッドシートの「スクリプト プロパティ」に AI_API_KEY を設定してください。</div>}
              {estimate.hasKey && !estimate.withinLimit && <div className="text-ink">今月の上限を超えるため実行できません。</div>}
              {estimate.count === 0 && <div>整理が必要なアイテムはありません。</div>}
            </dl>
          )}
        </>
      )}

      {phase === "running" && (
        <div className="mt-4 space-y-3">
          <p className="text-sm">
            整理中… {progress.done} / {progress.total} 件
          </p>
          <button type="button" onClick={() => { cancelled.current = true; }} className={BTN}>止める</button>
        </div>
      )}

      {phase === "review" && (
        <div className="mt-4 space-y-4">
          {found.length === 0 ? (
            <p className="text-sm text-ink-secondary">提案はありませんでした。</p>
          ) : (
            <>
              <p className="text-sm text-ink-secondary">{found.length} 件の提案があります。反映するものを選んでください。</p>
              <ul className="divide-y divide-line border-y border-line">
                {found.map((s) => (
                  <li key={s.id} className="flex gap-3 py-3">
                    <input
                      type="checkbox"
                      aria-label={`${s.title} を反映`}
                      checked={!!picked[s.id]}
                      onChange={(e) => setPicked((p) => ({ ...p, [s.id]: e.target.checked }))}
                      className="mt-1 h-5 w-5 shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm">{s.title || s.domain}</p>
                      {s.tags.length > 0 && (
                        <p className="mt-1 flex flex-wrap gap-1.5">
                          {s.tags.map((t) => (
                            <span key={t} className="rounded-full border border-line px-2 py-0.5 text-xs">{t}</span>
                          ))}
                        </p>
                      )}
                      {s.summary && <p className="mt-1 text-xs text-ink-secondary">{s.summary}</p>}
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className="flex flex-wrap gap-2.5">
            {found.length > 0 && (
              <button type="button" onClick={apply} disabled={busy || selectedCount === 0} className={BTN}>
                選んだ {selectedCount} 件を反映
              </button>
            )}
            <button type="button" onClick={() => { setPhase("idle"); setFound([]); setPicked({}); setMessage(""); }} className={BTN}>
              破棄する
            </button>
          </div>
        </div>
      )}

      {message && <p className="mt-3 text-sm text-ink-secondary" role="status">{message}</p>}
    </div>
  );
}
