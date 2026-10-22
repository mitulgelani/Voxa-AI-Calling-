import Link from 'next/link';
import { orgContext } from '@/lib/console/context';
import { PageHeader, Section, Table, Empty, Stat } from '@/components/console/ui';
import { count, money } from '@/lib/console/format';

export const metadata = { title: 'Usage & billing' };

const KIND: Record<string, string> = { telephony: 'Phone line (carrier minutes)', stt: 'Listening (speech to text)', tts: 'Speaking (voice)', llm: 'Thinking (language model)', storage: 'Recording storage', review: 'Human review' };

export default async function Billing({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const sp = await searchParams;
  const { db, org } = await orgContext();
  const now = new Date();
  const month = /^\d{4}-\d{2}$/.test(sp.m ?? '') ? sp.m! : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const start = new Date(`${month}-01T00:00:00Z`);
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  const prev = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
  const next = end.toISOString().slice(0, 7);
  const currency = org.country === 'IN' ? 'INR' : 'USD';

  const [{ data: events }, { data: calls }] = await Promise.all([
    db.from('usage_events').select('kind, quantity, unit, cost_minor, provider').eq('org_id', org.id).gte('at', start.toISOString()).lt('at', end.toISOString()).limit(100000),
    db.from('calls').select('id, outcome, duration_ms, cost_minor, campaign_id, campaigns(name)').eq('org_id', org.id).gte('created_at', start.toISOString()).lt('created_at', end.toISOString()).limit(100000),
  ]);
  const byKind = new Map<string, { cost: number; qty: number; unit: string; providers: Set<string> }>();
  for (const e of events ?? []) {
    const k = byKind.get(e.kind) ?? { cost: 0, qty: 0, unit: e.unit, providers: new Set<string>() };
    k.cost += Number(e.cost_minor); k.qty += Number(e.quantity); k.providers.add(e.provider);
    byKind.set(e.kind, k);
  }
  const total = [...byKind.values()].reduce((s, k) => s + k.cost, 0);
  const all = calls ?? [];
  const finished = all.filter((c) => c.outcome === 'completed').length;
  const minutes = all.reduce((s, c) => s + (c.duration_ms ?? 0), 0) / 60000;
  const byCampaign = new Map<string, { name: string; calls: number; finished: number; cost: number }>();
  for (const c of all) {
    const name = ((Array.isArray(c.campaigns) ? c.campaigns[0] : c.campaigns) as { name: string } | null)?.name ?? 'Test calls';
    const key = c.campaign_id ?? 'test';
    const r = byCampaign.get(key) ?? { name, calls: 0, finished: 0, cost: 0 };
    r.calls++; r.cost += Number(c.cost_minor); if (c.outcome === 'completed') r.finished++;
    byCampaign.set(key, r);
  }
  const label = new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(start);

  return (
    <>
      <PageHeader title="Usage & billing" lede="What your calls cost, broken down to the provider. The number that matters is the cost of one finished survey, not the cost of a minute."
        actions={<nav className="flex items-center gap-2" aria-label="Month">
          <Link className="btn btn-quiet btn-sm" href={`?m=${prev}`}>Previous</Link>
          <span className="px-2 font-medium">{label}</span>
          {end <= now ? <Link className="btn btn-quiet btn-sm" href={`?m=${next}`}>Next</Link> : null}
        </nav>} />
      <dl className="surface grid grid-cols-2 divide-line sm:grid-cols-4 sm:divide-x max-sm:[&>*:nth-child(-n+2)]:border-b max-sm:[&>*]:border-line">
        <Stat label="Total" value={money(total, currency)} />
        <Stat label="Per finished survey" value={finished ? money(Math.round(total / finished), currency) : '—'} note={`${count(finished)} finished`} />
        <Stat label="Calls" value={count(all.length)} />
        <Stat label="Talk minutes" value={count(Math.round(minutes))} />
      </dl>

      <div className="mt-10 grid gap-10 lg:grid-cols-2">
        <Section title="By component">
          {byKind.size ? (
            <ul className="surface divide-y divide-line">
              {[...byKind.entries()].sort((a, b) => b[1].cost - a[1].cost).map(([k, v]) => (
                <li key={k} className="px-4 py-3">
                  <div className="flex items-baseline justify-between gap-3"><span>{KIND[k] ?? k}</span><span className="tnum">{money(v.cost, currency)}</span></div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-panel-2"><div className="h-full bg-lamp/80" style={{ width: `${total ? (v.cost / total) * 100 : 0}%` }} /></div>
                  <p className="tnum mt-1 text-xs text-ink-3">{count(Math.round(v.qty))} {v.unit}, {[...v.providers].join(', ')}</p>
                </li>
              ))}
            </ul>
          ) : <Empty title="No usage this month" />}
        </Section>
        <Section title="By campaign">
          {byCampaign.size ? (
            <Table label="Spend by campaign" head={['Campaign', 'Calls', 'Finished', 'Cost']}>
              {[...byCampaign.entries()].sort((a, b) => b[1].cost - a[1].cost).map(([k, r]) => (
                <tr key={k}><td className="px-4 py-2.5">{r.name}</td><td className="tnum px-4 py-2.5">{count(r.calls)}</td><td className="tnum px-4 py-2.5">{count(r.finished)}</td><td className="tnum px-4 py-2.5">{money(r.cost, currency)}</td></tr>
              ))}
            </Table>
          ) : <Empty title="No calls this month" />}
        </Section>
      </div>
      <p className="mt-10 max-w-2xl text-sm text-ink-3">Carrier minutes are billed by {org.country === 'IN' ? 'Plivo' : 'Telnyx'} to your own account at their rates and shown here for the full picture. VaniDial’s platform charges are the listening, speaking, thinking and review lines.</p>
    </>
  );
}
