import Link from 'next/link';
import { Logo } from './Logo';

export function Footer() {
  return (
    <footer className="mt-24 border-t border-line">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-[1.4fr_repeat(3,1fr)]">
        <div className="max-w-sm">
          <Logo />
          <p className="mt-4 text-sm text-ink-3">
            AI calls in your customers’ language. Built in India.
          </p>
        </div>
        {[
          { h: 'Product', l: [['/#how', 'How it works'], ['/pricing', 'Pricing'], ['/playground', 'Playground']] },
          { h: 'Trust', l: [['/compliance', 'Compliance'], ['/security', 'Security'], ['/compliance#data', 'Data deletion']] },
          { h: 'Company', l: [['/login', 'Sign in'], ['/docs', 'API docs'], ['mailto:hello@vanidial.com', 'hello@vanidial.com']] },
        ].map((c) => (
          <div key={c.h}>
            <h3 className="font-sans text-sm font-semibold text-ink">{c.h}</h3>
            <ul className="mt-3 space-y-2 text-sm text-ink-3">
              {c.l.map(([href, label]) => (
                <li key={href}><Link className="hover:text-ink" href={href}>{label}</Link></li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="mx-auto max-w-7xl px-4 pb-10 text-xs text-ink-3 sm:px-6">© {new Date().getFullYear()} VaniDial. Every call starts by saying it is automated.</div>
    </footer>
  );
}
