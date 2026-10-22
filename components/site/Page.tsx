import type { ReactNode } from 'react';
import { Nav } from './Nav';
import { Footer } from './Footer';

/** Shell for public reading pages: one left-aligned column, a quiet table of contents on wide screens. */
export function ReadingPage({ title, lede, toc, children }: { title: string; lede: ReactNode; toc?: { id: string; label: string }[]; children: ReactNode }) {
  return (
    <>
      <Nav />
      <main id="main" className="mx-auto max-w-7xl px-4 pb-10 pt-16 sm:px-6 lg:pt-24">
        <header className="max-w-3xl">
          <h1 className="font-display text-display">{title}</h1>
          <p className="mt-6 max-w-2xl text-lg text-ink-2">{lede}</p>
        </header>
        <div className="mt-16 grid gap-12 lg:grid-cols-[200px_minmax(0,1fr)]">
          {toc ? (
            <nav aria-label="On this page" className="hidden lg:block">
              <ul className="sticky top-24 space-y-2 border-l border-line pl-4 text-sm text-ink-3">
                {toc.map((t) => <li key={t.id}><a className="hover:text-ink" href={`#${t.id}`}>{t.label}</a></li>)}
              </ul>
            </nav>
          ) : <div />}
          <div className="min-w-0 max-w-3xl space-y-16">{children}</div>
        </div>
      </main>
      <Footer />
    </>
  );
}

export function Block({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24">
      <h2 className="font-display text-h2">{title}</h2>
      <div className="mt-6 space-y-4 text-ink-2 [&_strong]:text-ink">{children}</div>
    </section>
  );
}
