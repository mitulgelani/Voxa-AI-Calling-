import type { Metadata } from 'next';
import { Nav } from '@/components/site/Nav';
import { Footer } from '@/components/site/Footer';
import { PersonaBuilder } from '@/components/play/PersonaBuilder';
import { Showcase } from '@/components/play/Showcase';
import { getShowcase } from '@/lib/server/personas';

export const metadata: Metadata = {
  title: 'Playground',
  description: 'Create an AI voice persona, pick its language and voice, and share a link anyone can call.',
};
export const dynamic = 'force-dynamic';

export default async function PlaygroundPage() {
  const showcase = await getShowcase(8);
  return (
    <>
      <Nav />
      <main className="mx-auto max-w-7xl px-4 sm:px-6">
        <section className="pb-10 pt-14 sm:pt-20">
          <h1 className="max-w-3xl font-display text-[clamp(2.4rem,1.6rem+3vw,4rem)] leading-[1.02]">
            Hear it before you buy it.
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-ink-2">
            Talk to one of our callers, or write a personality of your own, choose its language and voice, and share a link anyone can call from their browser. No sign-up.
          </p>
        </section>

        {showcase.length ? (
          <section aria-labelledby="showcase-h" className="pb-14">
            <h2 id="showcase-h" className="font-display text-2xl">Call one now</h2>
            <div className="mt-5"><Showcase personas={showcase} /></div>
          </section>
        ) : null}

        <section aria-labelledby="build-h">
          <h2 id="build-h" className="font-display text-2xl">Make your own</h2>
          <div className="mt-5"><PersonaBuilder /></div>
        </section>
      </main>
      <Footer />
    </>
  );
}
