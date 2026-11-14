"use client";

import { useEffect, useRef, useState } from "react";
import { loadGoogle } from "@/lib/google";
import { Orbs } from "./Orbs";

export function Login({ notice }: { notice: string }) {
  const slot = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    loadGoogle()
      .then((id) => {
        if (!alive || !slot.current) return;
        id.renderButton(slot.current, { theme: "outline", size: "large", shape: "pill", text: "signin_with", locale: "ja" });
        id.prompt();
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : "Googleログインを読み込めませんでした。");
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <main className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden px-6 text-center">
      <Orbs seed="internet-cabinet-login" count={7} scale={2.4} />
      <div className="relative">
        <p className="text-xs uppercase tracking-[0.2em] text-ink-secondary">A personal archive of the web</p>
        <h1 className="mt-6 font-display text-6xl font-light leading-none tracking-tight sm:text-8xl">
          Internet
          <br />
          Cabinet
        </h1>
        <div ref={slot} className="mt-12 flex min-h-11 justify-center" />
        {(notice !== "" || error !== "") && (
          <p role="alert" className="mt-5 text-sm text-danger">
            {error || notice}
          </p>
        )}
      </div>
    </main>
  );
}
