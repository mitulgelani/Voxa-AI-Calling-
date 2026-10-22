import type { Metadata } from 'next';
import Link from 'next/link';
import { Logo } from '@/components/site/Logo';
import { LoginForm } from '@/components/console/LoginForm';
import { hasSupabase } from '@/lib/env';

export const metadata: Metadata = { title: 'Sign in' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const sp = await searchParams;
  return (
    <main className="grid min-h-dvh lg:grid-cols-2">
      <section className="flex flex-col px-6 py-8 sm:px-12">
        <Link href="/" aria-label="VaniDial home"><Logo /></Link>
        <div className="my-auto w-full max-w-sm py-16">
          <h1 className="font-display text-4xl">Sign in to VaniDial</h1>
          <p className="mt-3 text-ink-2">We email you a one-time link. No password to remember.</p>
          {sp.error ? <p role="alert" className="mt-6 rounded-xl border border-fail/40 bg-fail/10 px-4 py-3 text-sm">That sign-in link has expired or was already used. Request a new one.</p> : null}
          {hasSupabase ? <LoginForm next={sp.next} /> : <p className="mt-8 rounded-xl border border-line-2 bg-panel px-4 py-3 text-sm text-ink-2">Sign-in opens once the database is connected.</p>}
          <p className="mt-10 text-sm text-ink-3">Just want to hear it? <Link className="text-lamp hover:underline" href="/playground">Try the playground</Link>, no account needed.</p>
        </div>
      </section>
      <aside className="relative hidden overflow-hidden border-l border-line bg-panel lg:block" aria-hidden>
        <div className="absolute inset-0 bg-[radial-gradient(700px_400px_at_70%_20%,rgb(244_165_60/0.12),transparent_60%)]" />
        <div className="relative flex h-full flex-col justify-end p-12">
          <blockquote className="indic max-w-md font-display text-3xl leading-tight">“Box पिचक गया था, बस वो देख लो।”</blockquote>
          <p className="mt-4 text-ink-2">Every answer arrives with the second it was said. This one was at 1:48.</p>
        </div>
      </aside>
    </main>
  );
}
