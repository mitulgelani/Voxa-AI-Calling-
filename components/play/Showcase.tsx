import Link from 'next/link';
import { getLanguage } from '@/lib/voice/languages';
import type { ShowcasePersona } from '@/lib/server/personas';

export function Showcase({ personas }: { personas: ShowcasePersona[] }) {
  if (!personas.length) return null;
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {personas.map((p) => {
        const lang = getLanguage(p.language);
        return (
          <li key={p.share_slug}>
            <Link href={`/p/${p.share_slug}`} className="group flex h-full flex-col rounded-[var(--radius-card)] border border-line bg-panel p-5 transition-colors hover:border-line-2">
              <span className="font-display text-2xl">{p.name}</span>
              <span className="mt-1 flex-1 text-sm text-ink-2">{p.tagline}</span>
              <span className="mt-4 flex items-center justify-between text-sm">
                <span className="text-ink-3">{lang.label}{lang.native !== lang.label && lang.native !== 'English' ? <span className="indic"> ({lang.native})</span> : null}</span>
                <span className="text-lamp group-hover:underline">Call</span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
