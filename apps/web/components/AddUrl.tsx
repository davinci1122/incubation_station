"use client";

import { useEffect, useRef, useState } from "react";

export function AddUrl({ busy, error, onSubmit, onClose }: {
  busy: boolean;
  error: string;
  onSubmit: (url: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState("");
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-30 anim-fade flex items-end justify-center bg-ink/20 p-0 sm:items-center sm:p-6" onClick={onClose}>
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-url-title"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy && value.trim() !== "") onSubmit(value.trim());
        }}
        className="anim-sheet w-full max-w-lg rounded-t-[22px] border border-white/70 bg-glass p-6 backdrop-blur-2xl sm:rounded-[22px]"
      >
        <h2 id="add-url-title" className="font-display text-3xl font-light tracking-tight">
          URLを保存
        </h2>
        <label htmlFor="add-url-input" className="mt-5 block text-xs text-ink-secondary">
          保存するページのURL
        </label>
        <input
          id="add-url-input"
          ref={input}
          type="url"
          inputMode="url"
          autoComplete="off"
          placeholder="https://"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="mt-2 block min-h-11 w-full rounded-[22px] border border-line bg-white/70 px-4 text-sm outline-none focus:border-ink"
        />
        {error !== "" && (
          <p role="alert" className="mt-3 text-sm text-danger">
            {error}
          </p>
        )}
        <div className="mt-6 flex justify-end gap-2.5">
          <button type="button" onClick={onClose} className="min-h-11 cursor-pointer rounded-[22px] border border-line px-5 text-sm">
            キャンセル
          </button>
          <button
            type="submit"
            disabled={busy || value.trim() === ""}
            className="min-h-11 cursor-pointer rounded-[22px] bg-ink px-5 text-sm text-bg disabled:cursor-default disabled:opacity-40"
          >
            {busy ? "保存中…" : "保存"}
          </button>
        </div>
      </form>
    </div>
  );
}
