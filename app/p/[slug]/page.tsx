import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getPersona } from '@/lib/server/personas';
import { CallRoom } from '@/components/call/CallRoom';
import { Logo } from '@/components/site/Logo';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const p = await getPersona(slug);
  if (!p) return { title: 'Persona not found' };
  return {
    title: `Talk to ${p.name}`,
    description: p.tagline || `A live AI voice call with ${p.name}, built on VaniDial.`,
    robots: { index: false },
  };
}

export default async function PersonaCallPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const p = await getPersona(slug);
  if (!p) notFound();
  return (
    <main className="mx-auto min-h-dvh max-w-6xl px-4 pb-16 sm:px-6">
      <header className="flex h-16 items-center justify-between">
        <Link href="/" aria-label="VaniDial home"><Logo /></Link>
        <Link href="/playground" className="text-sm text-ink-2 hover:text-ink">Make your own</Link>
      </header>
      <div className="pt-6 sm:pt-10">
        <CallRoom slug={slug} persona={{ name: p.name, tagline: p.tagline, greeting: p.greeting, language: p.language, voice: p.voice, rate: p.rate }} />
        <p className="mt-6 max-w-2xl text-sm text-ink-3">
          {p.name} is an AI voice persona made on VaniDial’s playground. Calls are not recorded. Your audio is sent to our speech and AI providers only to hold this conversation. Free calls last up to five minutes.
        </p>
      </div>
    </main>
  );
}
