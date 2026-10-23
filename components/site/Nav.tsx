import Link from 'next/link';
import { Logo } from './Logo';

const LINKS = [
  { href: '/#how', label: 'How it works' },
  { href: '/playground', label: 'Playground' },
  { href: '/pricing', label: 'Pricing' },
];

export function Nav() {
  return (
    <header className="sticky top-0 z-40 border-b border-line/70 bg-ground/80 backdrop-blur-xl">
      <nav className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-4 sm:px-6" aria-label="Main">
        <Link href="/" aria-label="VaniDial home"><Logo /></Link>
        <ul className="hidden items-center gap-1 text-sm text-ink-2 md:flex">
          {LINKS.map((l) => (
            <li key={l.href}><Link className="rounded-full px-3 py-2 hover:text-ink" href={l.href}>{l.label}</Link></li>
          ))}
        </ul>
        <div className="ml-auto flex items-center gap-2">
          <Link href="/login" className="btn btn-sm hidden text-ink-2 hover:text-ink sm:inline-flex">Sign in</Link>
          <Link href="/playground" className="btn btn-lamp btn-sm">Talk to it now</Link>
        </div>
      </nav>
    </header>
  );
}
