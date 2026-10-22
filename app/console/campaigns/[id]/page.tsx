import Link from 'next/link';
import { notFound } from 'next/navigation';
import { orgContext, atLeast } from '@/lib/console/context';
import { campaignOptions } from '@/lib/console/campaign-options';
import { PageHeader, Pill, Section, Stat, STATUS_TONE, Table, Empty } from '@/components/console/ui';
import { ActionButton } from '@/components/console/forms';
import { CampaignForm } from '@/components/console/campaigns/CampaignForm';
import { GateFigure } from '@/components/figures/gate/GateFigure';
import { launch, setStatus } from '@/app/console/_actions/campaigns';
import { count, duration, money, pct, when, OUTCOME_LABEL } from '@/lib/console/format';
import type { QuestionT } from '@/lib/console/agent-schema';

export const metadata = { title: 'Campaign' };

const CHECK_LABEL: Record<string, string> = { purpose: 'Purpose', caller_id: 'Caller ID', consent: 'Consent', dnd_scrub: 'DND scrub', script: 'Approved script', window: 'Calling hours' };
const CHECK_FIX: Record<string, string> = { caller_id: '/console/numbers', consent: '/console/contacts', dnd_scrub: '/console/contacts', script: '/console/agents' };
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default async function CampaignPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ edit?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const { db, org, role } = await orgContext();
  const { data: c } = await db.from('campaigns').select('*').eq('id', id).eq('org_id', org.id).maybeSingle();
  if (!c) notFound();

  const draft = c.status === 'draft';
  const [checksRes, version, number, list] = await Promise.all([
    draft ? db.rpc('campaign_checks', { p_campaign: id }) : Promise.resolve({ data: null }),
    c.agent_version_id ? db.from('agent_versions').select('version, questions, agents!agent_versions_agent_id_fkey(id, name)').eq('id', c.agent_version_id).maybeSingle() : Promise.resolve({ data: null }),
    c.phone_number_id ? db.from('phone_numbers').select('e164').eq('id', c.phone_number_id).maybeSingle() : Promise.resolve({ data: null }),
    c.list_id ? db.from('contact_lists').select('id, name').eq('id', c.list_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const checks = (checksRes.data ?? []) as { key: string; ok: boolean; message: string }[];
  const passing = checks.filter((x) => x.ok).length;
  const agent = version.data ? ((Array.isArray(version.data.agents) ? version.data.agents[0] : version.data.agents) as { id: string; name: string }) : null;

  const statusActions = (
    <>
      {draft && atLeast(role, 'operator') ? <Link href={sp.edit ? `?` : `?edit=1`} className="btn btn-quiet btn-sm">{sp.edit ? 'Close editor' : 'Edit draft'}</Link> : null}
      {c.status === 'running' && atLeast(role, 'operator') ? <ActionButton action={setStatus} fields={{ id, status: 'paused' }}>Pause</ActionButton> : null}
      {c.status === 'paused' && atLeast(role, 'operator') ? <ActionButton action={setStatus} fields={{ id, status: 'running' }} className="btn btn-lamp btn-sm">Resume</ActionButton> : null}
      {c.status === 'running' && atLeast(role, 'operator') ? <ActionButton action={setStatus} fields={{ id, status: 'completed' }} confirm="Mark complete? Queued calls are cancelled.">Complete</ActionButton> : null}
      {['draft', 'running', 'paused'].includes(c.status) && atLeast(role, 'operator') ? <ActionButton action={setStatus} fields={{ id, status: 'cancelled' }} confirm="Cancel the campaign? This cannot be undone.">Cancel</ActionButton> : null}
      {!draft ? <a href={`/console/campaigns/${id}/export`} className="btn btn-quiet btn-sm">Export answers (CSV)</a> : null}
    </>
  );

  if (draft && sp.edit && atLeast(role, 'operator')) {
    const options = await campaignOptions(db, org.id);
    return (
      <>
        <PageHeader title={`Edit ${c.name}`} back={{ href: `/console/campaigns/${id}`, label: c.name }} />
        <CampaignForm options={options} currency={c.currency} country={org.country} draft={{
          id, name: c.name, purpose: c.purpose ?? 'service', agent_version_id: c.agent_version_id ?? '', phone_number_id: c.phone_number_id ?? '', list_id: c.list_id ?? '',
          window_start: String(c.window_start).slice(0, 5), window_end: String(c.window_end).slice(0, 5), days: c.days, max_concurrent: c.max_concurrent,
          dials_per_minute: c.dials_per_minute, max_attempts: c.max_attempts, retry_after_minutes: c.retry_after_minutes, budget: c.budget_cap_minor / 100,
        }} />
      </>
    );
  }

  const setup = (
    <dl className="surface divide-y divide-line text-sm">
      {[
        ['Agent', agent ? <Link className="hover:text-lamp" href={`/console/agents/${agent.id}?v=${version.data!.version}`}>{agent.name} v{version.data!.version}</Link> : '—'],
        ['Caller ID', number.data?.e164 ?? '—'],
        ['Contact list', list.data ? <Link className="hover:text-lamp" href={`/console/contacts/${list.data.id}`}>{list.data.name}</Link> : '—'],
        ['Hours', `${String(c.window_start).slice(0, 5)}–${String(c.window_end).slice(0, 5)}, ${(c.days as number[]).map((d) => DAYS[d]).join(' ')}`],
        ['Pace', `${c.max_concurrent} at once, ${c.dials_per_minute} dials a minute`],
        ['Retries', `${c.max_attempts} attempts, ${c.retry_after_minutes} min apart`],
        ['Budget cap', money(c.budget_cap_minor, c.currency)],
      ].map(([k, v]) => (
        <div key={String(k)} className="flex gap-4 px-4 py-2.5"><dt className="w-28 shrink-0 text-ink-3">{k}</dt><dd className="min-w-0 tnum">{v}</dd></div>
      ))}
      {c.frozen_at ? <p className="px-4 py-2.5 text-xs text-ink-3">Locked at launch, {when(c.frozen_at, org.timezone)}. Changes need a new campaign.</p> : null}
    </dl>
  );

  if (draft) {
    return (
      <>
        <PageHeader title={c.name} back={{ href: '/console/campaigns', label: 'Campaigns' }} actions={<><Pill tone="idle">Draft</Pill>{statusActions}</>} />
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
          <section aria-labelledby="preflight">
            <h2 id="preflight" className="sr-only">Launch checks</h2>
            <GateFigure state={['purpose', 'caller_id', 'consent', 'dnd_scrub', 'script', 'window'].map((k) => Boolean(checks.find((x) => x.key === k)?.ok))} />
            <ol className="mt-6 space-y-2">
              {checks.map((x) => (
                <li key={x.key} className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${x.ok ? 'border-line' : 'border-fail/40 bg-fail/5'}`}>
                  <span className={`mt-2 h-2 w-2 shrink-0 rounded-full ${x.ok ? 'bg-lamp' : 'bg-fail'}`} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{CHECK_LABEL[x.key] ?? x.key}<span className="sr-only">{x.ok ? ' passes' : ' fails'}</span></span>
                    <span className="block text-sm text-ink-2">{x.message}</span>
                  </span>
                  {!x.ok && CHECK_FIX[x.key] ? <Link href={CHECK_FIX[x.key]} className="btn btn-quiet btn-sm">Fix</Link> : !x.ok && atLeast(role, 'operator') ? <Link href="?edit=1" className="btn btn-quiet btn-sm">Fix</Link> : null}
                </li>
              ))}
            </ol>
            <div className="mt-6 flex flex-wrap items-center gap-4">
              {atLeast(role, 'admin') ? (passing === 6 ? (
                <ActionButton action={launch} fields={{ id }} className="btn btn-lamp" pending="Launching" confirm="Start calling real people now?">Launch campaign</ActionButton>
              ) : (
                <button type="button" className="btn btn-lamp" disabled>Launch locked: {6 - passing} check{6 - passing === 1 ? '' : 's'} failing</button>
              )) : <p className="text-sm text-ink-3">An admin launches campaigns.</p>}
              <p className="text-sm text-ink-3">The database runs the same six checks again at launch, so a stale screen cannot start calls.</p>
            </div>
          </section>
          <Section title="Setup">{setup}</Section>
        </div>
      </>
    );
  }

  // Launched: progress and results.
  const [jobs, calls, answers] = await Promise.all([
    db.from('call_jobs').select('state').eq('campaign_id', id).limit(50000),
    db.from('calls').select('id, to_e164, outcome, status, duration_ms, created_at, needs_review, cost_minor').eq('campaign_id', id).order('created_at', { ascending: false }).limit(2000),
    db.from('answers').select('question_key, type, value, review_state, calls!inner(campaign_id)').eq('calls.campaign_id', id).limit(20000),
  ]);
  const jobCount = (s: string) => (jobs.data ?? []).filter((j) => j.state === s).length;
  const allCalls = calls.data ?? [];
  const finished = allCalls.filter((x) => x.outcome === 'completed').length;
  const optedOut = allCalls.filter((x) => x.outcome === 'opted_out').length;
  const questions = ((version.data?.questions ?? []) as QuestionT[]);
  const byKey = new Map<string, unknown[]>();
  for (const a of answers.data ?? []) byKey.set(a.question_key, [...(byKey.get(a.question_key) ?? []), a.value]);
  const spentShare = c.budget_cap_minor ? c.spent_minor / c.budget_cap_minor : 0;

  return (
    <>
      <PageHeader title={c.name} back={{ href: '/console/campaigns', label: 'Campaigns' }} actions={<><Pill tone={STATUS_TONE[c.status]}>{c.status}</Pill>{statusActions}</>} />
      <dl className="surface grid grid-cols-2 divide-line sm:grid-cols-4 sm:divide-x max-sm:[&>*:nth-child(-n+2)]:border-b max-sm:[&>*]:border-line">
        <Stat label="Still to call" value={count(jobCount('pending') + jobCount('claimed'))} note={`${count(jobCount('skipped') + jobCount('cancelled'))} skipped or cancelled`} />
        <Stat label="Calls placed" value={count(allCalls.length)} />
        <Stat label="Finished the survey" value={pct(finished, allCalls.length)} note={`${count(optedOut)} opted out`} />
        <Stat label="Spend" value={money(c.spent_minor, c.currency)} tone={spentShare > 0.9 ? 'fail' : undefined} note={`${Math.round(spentShare * 100)}% of the cap${finished ? `, ${money(Math.round(c.spent_minor / finished), c.currency)} per finished call` : ''}`} />
      </dl>

      <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Section title="Answers so far">
          {questions.length && (answers.data ?? []).length ? (
            <ul className="space-y-3">{questions.map((q) => <AnswerSummary key={q.key} q={q} values={byKey.get(q.key) ?? []} />)}</ul>
          ) : <Empty title="No answers yet">Answers appear here seconds after each call ends.</Empty>}
        </Section>
        <Section title="Setup">{setup}</Section>
      </div>

      <Section title="Calls" aside={allCalls.length > 50 ? <Link className="hover:text-ink" href={`/console/calls?campaign=${id}`}>All {count(allCalls.length)} calls</Link> : null}>
        {allCalls.length ? (
          <Table label="Calls in this campaign" head={['Number', 'Outcome', 'Length', 'Cost', 'When']}>
            {allCalls.slice(0, 50).map((x) => (
              <tr key={x.id} className="hover:bg-panel-2">
                <td className="tnum px-4 py-2.5"><Link className="hover:text-lamp" href={`/console/calls/${x.id}`}>{x.to_e164}</Link></td>
                <td className="px-4 py-2.5">{x.needs_review ? <Pill tone="warn">Needs review</Pill> : <Pill tone={x.outcome === 'completed' ? 'pass' : x.outcome === 'opted_out' ? 'live' : 'idle'}>{x.outcome ? OUTCOME_LABEL[x.outcome] : x.status.replace('_', ' ')}</Pill>}</td>
                <td className="tnum px-4 py-2.5 text-ink-2">{duration(x.duration_ms)}</td>
                <td className="tnum px-4 py-2.5 text-ink-2">{money(x.cost_minor, c.currency)}</td>
                <td className="px-4 py-2.5 text-ink-3">{when(x.created_at, org.timezone)}</td>
              </tr>
            ))}
          </Table>
        ) : <Empty title="No calls yet">The dialler starts inside the calling window, in each contact’s timezone.</Empty>}
      </Section>
    </>
  );
}

function AnswerSummary({ q, values }: { q: QuestionT; values: unknown[] }) {
  const n = values.length;
  let body: React.ReactNode = <p className="text-sm text-ink-3">No answers yet</p>;
  if (n && q.type === 'rating') {
    const nums = values.map(Number).filter((v) => v >= 1 && v <= 5);
    const dist = [1, 2, 3, 4, 5].map((s) => nums.filter((v) => Math.round(v) === s).length);
    const max = Math.max(1, ...dist);
    const avg = nums.reduce((s, v) => s + v, 0) / Math.max(1, nums.length);
    body = (
      <div className="flex items-end gap-5">
        <p className="tnum font-display text-4xl">{avg.toFixed(1)}<span className="text-base text-ink-3"> / 5</span></p>
        <div className="flex h-12 flex-1 items-end gap-1.5" role="img" aria-label={`Ratings: ${dist.map((d, i) => `${i + 1} star ${d}`).join(', ')}`}>
          {dist.map((d, i) => <span key={i} className="flex-1 rounded-t bg-lamp/80" style={{ height: `${Math.max(4, (d / max) * 100)}%` }} title={`${i + 1}: ${d}`} />)}
        </div>
      </div>
    );
  } else if (n && (q.type === 'yes_no' || q.type === 'choice')) {
    const counts = new Map<string, number>();
    for (const v of values) { const k = typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v); counts.set(k, (counts.get(k) ?? 0) + 1); }
    body = (
      <ul className="space-y-1.5">
        {[...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => (
          <li key={k} className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)_3rem] items-center gap-3 text-sm">
            <span className="truncate">{k}</span>
            <span className="h-2 overflow-hidden rounded-full bg-panel-2"><span className="block h-full bg-lamp/80" style={{ width: `${(v / n) * 100}%` }} /></span>
            <span className="tnum text-right text-ink-2">{Math.round((v / n) * 100)}%</span>
          </li>
        ))}
      </ul>
    );
  } else if (n) {
    body = <ul className="indic space-y-1 text-sm text-ink-2">{values.slice(-3).reverse().map((v, i) => <li key={i}>“{String(v)}”</li>)}</ul>;
  }
  return (
    <li className="surface p-5">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <p className="indic font-medium">{q.prompt}</p>
        <span className="tnum shrink-0 text-sm text-ink-3">{count(n)}</span>
      </div>
      {body}
    </li>
  );
}
