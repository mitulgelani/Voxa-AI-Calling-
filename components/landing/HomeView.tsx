import Link from 'next/link';
import { ArrowRight, Languages, MessageCircle, ShieldCheck } from 'lucide-react';
import { Nav } from '@/components/site/Nav';
import { Footer } from '@/components/site/Footer';
import { Showcase } from '@/components/play/Showcase';
import { SwitchboardFigure } from '@/components/figures/switchboard/SwitchboardFigure';
import type { ShowcasePersona } from '@/lib/server/personas';

const BENEFITS = [
  { icon: MessageCircle, title: 'Sounds like a person', body: 'Listens, waits its turn, and stops talking when the customer does.' },
  { icon: Languages, title: 'Speaks their language', body: 'Hindi, Gujarati, Hinglish and English. It switches when they do.' },
  { icon: ShieldCheck, title: 'Proof for every answer', body: 'Each answer links to the moment it was said. Click it, hear it.' },
];

const STEPS = [
  { title: 'Write what to ask', body: 'A few questions, in plain words.' },
  { title: 'Add your customers', body: 'Upload a list. We skip anyone who opted out.' },
  { title: 'Read the answers', body: 'Ratings, reasons and comments, as each call ends.' },
];

export function HomeView({ showcase }: { showcase: ShowcasePersona[] }) {
  return (
    <>
      <Nav />
      <main>
        {/* Hero: one promise, and the product you can hear right here */}
        <section className="mx-auto grid max-w-7xl items-center gap-12 px-4 pb-20 pt-14 sm:px-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:gap-14 lg:pt-24">
          <div>
            <h1 className="font-display text-display font-semibold">AI that calls your customers in their language.</h1>
            <p className="mt-6 max-w-lg text-lg leading-relaxed text-ink-2">
              VaniDial phones every customer, has a real conversation, and tells you what they think.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <Link href="/playground" className="btn btn-lamp min-h-[52px] px-6">
                Talk to it now <ArrowRight size={18} aria-hidden />
              </Link>
              <Link href="/login" className="btn btn-quiet min-h-[52px] px-6">Get started</Link>
            </div>
            <p className="mt-5 text-sm text-ink-3">Free to try. No sign-up.</p>
          </div>
          <div>
            <SwitchboardFigure />
            <p className="mt-3 text-center text-sm text-ink-3">Tap a language to hear it.</p>
          </div>
        </section>

        {/* Why */}
        <section className="border-t border-line">
          <ul className="mx-auto grid max-w-7xl gap-10 px-4 py-16 sm:px-6 md:grid-cols-3">
            {BENEFITS.map(({ icon: Icon, title, body }) => (
              <li key={title}>
                <Icon size={22} className="text-lamp" aria-hidden />
                <h2 className="mt-4 font-display text-xl">{title}</h2>
                <p className="mt-2 text-ink-2">{body}</p>
              </li>
            ))}
          </ul>
        </section>

        {/* How */}
        <section id="how" className="scroll-mt-20 border-t border-line">
          <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
            <h2 className="font-display text-h2">How it works.</h2>
            <ol className="mt-10 grid gap-8 md:grid-cols-3">
              {STEPS.map((s, i) => (
                <li key={s.title} className="border-t border-line-2 pt-5">
                  <span className="tnum font-display text-3xl text-lamp">{i + 1}</span>
                  <h3 className="mt-3 font-display text-xl">{s.title}</h3>
                  <p className="mt-1.5 text-ink-2">{s.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Try */}
        {showcase.length ? (
          <section className="border-t border-line">
            <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <h2 className="font-display text-h2">Call one now.</h2>
                <Link href="/playground" className="inline-flex items-center gap-1.5 text-lamp hover:underline">
                  Make your own <ArrowRight size={16} aria-hidden />
                </Link>
              </div>
              <div className="mt-8"><Showcase personas={showcase} /></div>
            </div>
          </section>
        ) : null}

        {/* Close */}
        <section className="border-t border-line">
          <div className="mx-auto max-w-3xl px-4 py-24 text-center sm:px-6">
            <h2 className="font-display text-h2">₹3 per connected minute.</h2>
            <p className="mt-4 text-lg text-ink-2">No setup fee. No contract. Pay only when someone picks up.</p>
            <div className="mt-9 flex flex-wrap justify-center gap-3">
              <Link href="/playground" className="btn btn-lamp min-h-[52px] px-6">Talk to it now</Link>
              <Link href="/pricing" className="btn btn-quiet min-h-[52px] px-6">See pricing</Link>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
