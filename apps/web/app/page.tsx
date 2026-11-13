const NAV = ["Home", "Collections", "Tags", "Search", "Archive", "Settings"] as const;

export default function HomePage() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-[1440px]">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-line px-6 py-8 lg:flex">
        <p className="font-serif text-2xl leading-none tracking-tight">Internet Cabinet</p>
        <nav aria-label="メイン" className="mt-12">
          <ul className="space-y-1 text-sm">
            {NAV.map((label, i) => (
              <li key={label}>
                <span
                  aria-current={i === 0 ? "page" : undefined}
                  className={
                    i === 0
                      ? "block rounded-md bg-accent-light px-3 py-2 text-ink"
                      : "block rounded-md px-3 py-2 text-ink-secondary"
                  }
                >
                  {label}
                </span>
              </li>
            ))}
          </ul>
        </nav>
      </aside>

      <main className="flex flex-1 flex-col px-5 py-6 sm:px-10 lg:py-8">
        <p className="font-serif text-xl leading-none tracking-tight lg:hidden">Internet Cabinet</p>

        <section className="flex flex-1 flex-col items-center justify-center py-24 text-center">
          <p className="text-xs uppercase tracking-[0.2em] text-accent">A personal archive of the web</p>
          <h1 className="mt-6 font-serif text-5xl leading-[1.05] tracking-tight sm:text-7xl">
            The cabinet is
            <br />
            being built.
          </h1>
          <p className="mt-8 max-w-md text-sm leading-relaxed text-ink-secondary">
            土台を準備しています。保存・整理・検索の各機能は、これから順に追加されます。
          </p>
        </section>

        <footer className="border-t border-line pt-4 text-xs text-muted">P0 — foundation</footer>
      </main>
    </div>
  );
}
