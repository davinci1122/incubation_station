"use client";

import { useEffect, useRef, useState } from "react";

export function NameDialog({ title, label, initial = "", submit, onSubmit, onClose }: {
  title: string;
  label: string;
  initial?: string;
  submit: string;
  onSubmit: (value: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initial);
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
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-ink/20 sm:items-center sm:p-6" onClick={onClose}>
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="name-dialog-title"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          const v = value.trim();
          if (v !== "") onSubmit(v);
        }}
        className="w-full max-w-md rounded-t-[22px] border border-white/70 bg-glass p-6 backdrop-blur-2xl sm:rounded-[22px]"
      >
        <h2 id="name-dialog-title" className="font-display text-3xl font-light tracking-tight">{title}</h2>
        <label htmlFor="name-dialog-input" className="mt-5 block text-xs text-ink-secondary">{label}</label>
        <input
          id="name-dialog-input"
          ref={input}
          value={value}
          maxLength={120}
          onChange={(e) => setValue(e.target.value)}
          className="mt-2 block min-h-11 w-full rounded-[22px] border border-line bg-white/70 px-4 text-sm outline-none focus:border-ink"
        />
        <div className="mt-6 flex justify-end gap-2.5">
          <button type="button" onClick={onClose} className="min-h-11 cursor-pointer rounded-[22px] border border-line px-5 text-sm">キャンセル</button>
          <button type="submit" disabled={value.trim() === ""} className="min-h-11 cursor-pointer rounded-[22px] bg-ink px-5 text-sm text-bg disabled:opacity-40">
            {submit}
          </button>
        </div>
      </form>
    </div>
  );
}
