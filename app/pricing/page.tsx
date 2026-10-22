import Link from 'next/link';
import type { Metadata } from 'next';
import { ReadingPage, Block } from '@/components/site/Page';
import { PLANS } from '@/lib/pricing';

export const metadata: Metadata = { title: 'Pricing', description: 'Pay per connected minute. See the cost of every finished feedback record.' };

export default function Pricing() {
  return (
    <ReadingPage title="Pricing" lede="You pay for minutes that reached a person. Rings, busy lines and voicemail detection are free. The console shows the number that matters: what one finished, trustworthy feedback record cost you.">
      <section aria-label="Plans" className="grid gap-4 md:grid-cols-3">
        {PLANS.map((p, i) => (
          <article key={p.name} className={`surface flex flex-col p-6 ${i === 1 ? 'border-lamp/60' : ''}`}>
            <h2 className="font-sans text-base font-semibold">{p.name}</h2>
            <p className="mt-1 text-sm text-ink-3">{p.for}</p>
            <p className="mt-6"><span className="tnum font-display text-5xl">{p.price}</span>{p.unit ? <span className="ml-2 text-ink-3">{p.unit}</span> : null}</p>
            <ul className="mt-6 flex-1 space-y-2 text-sm text-ink-2">
              {p.includes.map((x) => <li key={x} className="flex gap-2"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-lamp" aria-hidden />{x}</li>)}
            </ul>
            <Link href={p.cta.href} className={`btn mt-8 ${i === 1 ? 'btn-lamp' : 'btn-quiet'}`}>{p.cta.label}</Link>
          </article>
        ))}
      </section>

      <Block id="example" title="What a campaign costs">
        <p>A typical feedback call lasts about two and a half minutes. For 1,000 customers with a 60% answer rate:</p>
        <dl className="surface tnum divide-y divide-line text-sm">
          {[
            ['Connected calls', '600 × 2.5 min = 1,500 min'],
            ['VaniDial', '1,500 × ₹3 = ₹4,500'],
            ['Carrier (paid to Plivo, approx.)', '1,500 × ₹0.50 = ₹750'],
            ['Finished records (≈ 80% of connected)', '480'],
            ['Cost per finished record', '≈ ₹11'],
          ].map(([k, v]) => <div key={k} className="flex justify-between gap-4 px-4 py-3"><dt>{k}</dt><dd className="text-ink">{v}</dd></div>)}
        </dl>
        <p className="text-sm text-ink-3">Your real numbers appear in Usage & billing as soon as calls run, broken down by phone line, listening, speaking and thinking.</p>
      </Block>

      <Block id="questions" title="Common questions">
        <p><strong>Is a minute rounded up?</strong> Per call, to the next minute, the same way carriers bill.</p>
        <p><strong>Do failed calls cost anything?</strong> No. Busy, unanswered and voicemail calls are free on our side; your carrier may charge a few paise for call attempts.</p>
        <p><strong>Can a campaign overspend?</strong> No. Each campaign has a budget cap and the dialler stops claiming new calls once it is reached.</p>
        <p><strong>Why bring our own Plivo or Telnyx account?</strong> Caller IDs, DLT registration and call records stay in your name, which is what Indian regulation expects.</p>
      </Block>
    </ReadingPage>
  );
}
