import Link from 'next/link';
import { redirect } from 'next/navigation';
import { consoleContext, atLeast } from '@/lib/console/context';
import { PageHeader, Section, Stat, Pill, STATUS_TONE, Empty } from '@/components/console/ui';
import { count, money, pct, when, OUTCOME_LABEL } from '@/lib/console/format';

export const metadata = { title: 'Overview' };

export default async function Overview({ searchParams }: { searchParams: Promise<{ denied?: string; welcome?: string }> }) {
  const sp = await searchParams;
  const { db, org, role } = await consoleContext();
  if (!org) redirect('/console/welcome');
  const since = new Date(Date.now() - 7 * 864e5).toISOString();

  const [agents, numbers, lists, campaigns, calls, review, spend] = await Promise.all([
    db.from('agents').select('id, current_version_id').eq('org_id', org.id).is('archived_at', null),
    db.from('phone_numbers').select('id, verified_at').eq('org_id', org.id),
    db.from('contact_lists').select('id').eq('org_id', org.id).limit(1),
    db.from('campaigns').select('id, name, status, spent_minor, budget_cap_minor, currency').eq('org_id', org.id).order('updated_at', { ascending: false }).limit(6),
    db.from('calls').select('id, outcome, status, duration_ms, to_e164, created_at, needs_review, campaign_id').eq('org_id', org.id).gte('created_at', since).order('created_at', { ascending: false }).limit(500),
    db.from('review_tasks').select('id', { count: 'exact', head: true }).eq('org_id', org.id).eq('state', 'open'),
    db.from('usage_events').select('cost_minor').eq('org_id', org.id).gte('at', since).limit(5000),
  ]);

  const steps = [
    { done: (agents.data ?? []).some((a) => a.current_version_id), label: 'Write and approve an agent', href: '/console/agents' },
    { done: (numbers.data ?? []).some((n) => n.verified_at), label: 'Connect a verified caller ID', href: '/console/numbers' },
    { done: (lists.data ?? []).length > 0, label: 'Import contacts with consent', href: '/console/contacts' },
    { done: (campaigns.data ?? []).some((c) => c.status !== 'draft'), label: 'Launch a campaign', href: '/console/campaigns' },
  ];
  const ready = steps.filter((s) => s.done).length;

  const recent = calls.data ?? [];
  const answered = recent.filter((c) => c.outcome === 'completed' || c.outcome === 'partial').length;
  const spent = (spend.data ?? []).reduce((s, e) => s + Number(e.cost_minor), 0);
  const currency = org.country === 'IN' ? 'INR' : 'USD';

  return (
    <>
      <PageHeader title={sp.welcome ? `Welcome to ${org.name}` : 'Overview'} lede="The last seven days across every campaign." />
      {sp.denied ? <p role="alert" className="mb-6 rounded-xl border border-warn/40 bg-warn/10 px-4 py-3 text-sm">That page needs a higher role than yours ({role}).</p> : null}

      {ready < steps.length ? (
        <section className="surface mb-10 p-6" aria-labelledby="setup">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 id="setup" className="font-display text-xl">Before your first real call</h2>
            <span className="tnum text-sm text-ink-3">{ready} of {steps.length} done</span>
          </div>
          <ol className="mt-4 grid gap-2 sm:grid-cols-2">
            {steps.map((s, i) => (
              <li key={s.label}>
                <Link href={s.href} className="flex items-center gap-3 rounded-xl border border-line px-4 py-3 hover:border-line-2 hover:bg-panel-2">
                  <span className={`tnum grid h-7 w-7 shrink-0 place-items-center rounded-full text-sm ${s.done ? 'bg-pass/15 text-pass' : 'border border-line-2 text-ink-3'}`} aria-hidden>{s.done ? '✓' : i + 1}</span>
                  <span className={s.done ? 'text-ink-3 line-through decoration-line-2' : ''}>{s.label}</span>
                  <span className="sr-only">{s.done ? '(done)' : '(to do)'}</span>
                </Link>
              </li>
            ))}
          </ol>
          <p className="mt-4 text-sm text-ink-3">Want to hear an agent first? <Link href="/playground" className="text-lamp hover:underline">Make a test call in your browser</Link>.</p>
        </section>
      ) : null}

      <dl className="surface grid grid-cols-2 divide-line max-sm:[&>*:nth-child(-n+2)]:border-b max-sm:[&>*]:border-line sm:grid-cols-4 sm:divide-x">
        <Stat label="Calls placed" value={count(recent.length)} />
        <Stat label="Answered and finished" value={pct(answered, recent.length)} note={`${count(answered)} calls`} />
        <Stat label="Waiting for review" value={count(review.count ?? 0)} tone={(review.count ?? 0) > 0 ? 'warn' : undefined} note={atLeast(role, 'reviewer') && (review.count ?? 0) > 0 ? <Link className="text-lamp hover:underline" href="/console/review">Open the queue</Link> : undefined} />
        <Stat label="Spend" value={money(spent, currency)} note={answered ? `${money(Math.round(spent / answered), currency)} per finished call` : undefined} />
      </dl>

      <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <Section title="Campaigns" aside={<Link href="/console/campaigns" className="hover:text-ink">All campaigns</Link>}>
          {(campaigns.data ?? []).length ? (
            <ul className="surface divide-y divide-line">
              {campaigns.data!.map((c) => (
                <li key={c.id}>
                  <Link href={`/console/campaigns/${c.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-panel-2">
                    <span className="min-w-0 flex-1 truncate">{c.name}</span>
                    <span className="tnum text-sm text-ink-3">{money(c.spent_minor, c.currency)}</span>
                    <Pill tone={STATUS_TONE[c.status]}>{c.status}</Pill>
                  </Link>
                </li>
              ))}
            </ul>
          ) : <Empty title="No campaigns yet">A campaign joins an approved agent, a caller ID and a contact list.</Empty>}
        </Section>
        <Section title="Latest calls" aside={<Link href="/console/calls" className="hover:text-ink">All calls</Link>}>
          {recent.length ? (
            <ul className="surface divide-y divide-line">
              {recent.slice(0, 6).map((c) => (
                <li key={c.id}>
                  <Link href={`/console/calls/${c.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-panel-2">
                    <span className="tnum min-w-0 flex-1 truncate">{c.to_e164}</span>
                    <span className="text-sm text-ink-3">{when(c.created_at, org.timezone)}</span>
                    {c.needs_review ? <Pill tone="warn">Review</Pill> : <Pill tone={c.outcome === 'completed' ? 'pass' : 'idle'}>{c.outcome ? OUTCOME_LABEL[c.outcome] : c.status.replace('_', ' ')}</Pill>}
                  </Link>
                </li>
              ))}
            </ul>
          ) : <Empty title="No calls in the last seven days" />}
        </Section>
      </div>
    </>
  );
}
