import Link from 'next/link';
import { notFound } from 'next/navigation';
import { orgContext, atLeast } from '@/lib/console/context';
import { PageHeader, Pill } from '@/components/console/ui';
import { EvidencePlayer, type EvAnswer, type EvTurn } from '@/components/console/calls/EvidencePlayer';
import { duration, maskPhone, money, when, OUTCOME_LABEL } from '@/lib/console/format';
import type { QuestionT } from '@/lib/console/agent-schema';

export const metadata = { title: 'Call' };

export default async function CallPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ review?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const { db, org, role } = await orgContext();
  const { data: call } = await db.from('calls')
    .select('id, to_e164, from_e164, carrier, status, outcome, language_detected, started_at, answered_at, ended_at, duration_ms, recording_path, cost_minor, metrics, needs_review, campaign_id, campaigns(name, currency, agent_version_id)')
    .eq('id', id).eq('org_id', org.id).maybeSingle();
  if (!call) notFound();
  const camp = (Array.isArray(call.campaigns) ? call.campaigns[0] : call.campaigns) as { name: string; currency: string; agent_version_id: string } | null;

  const [turns, answers, task, version, recording] = await Promise.all([
    db.from('call_turns').select('seq, speaker, text, lang, start_ms, end_ms, interrupted').eq('call_id', id).order('seq'),
    db.from('answers').select('id, question_key, type, value, confidence, evidence_start_ms, evidence_end_ms, review_state, original_value').eq('call_id', id),
    db.from('review_tasks').select('reason, state').eq('call_id', id).maybeSingle(),
    camp?.agent_version_id ? db.from('agent_versions').select('questions').eq('id', camp.agent_version_id).maybeSingle() : Promise.resolve({ data: null }),
    call.recording_path ? db.storage.from('recordings').createSignedUrl(call.recording_path, 60 * 30) : Promise.resolve({ data: null }),
  ]);
  const questions = ((version.data?.questions ?? []) as QuestionT[]);
  const order = new Map(questions.map((q, i) => [q.key, i]));
  const prompts = Object.fromEntries(questions.map((q) => [q.key, q.prompt]));
  const ans = ((answers.data ?? []) as EvAnswer[]).sort((a, b) => (order.get(a.question_key) ?? 99) - (order.get(b.question_key) ?? 99));
  const reviewing = sp.review === '1' && atLeast(role, 'reviewer');
  const metrics = (call.metrics ?? {}) as { p50_turn_ms?: number; interruptions?: number };

  return (
    <>
      <PageHeader
        title={atLeast(role, 'operator') ? call.to_e164 : maskPhone(call.to_e164)}
        back={reviewing ? { href: '/console/review', label: 'Review queue' } : { href: '/console/calls', label: 'Calls' }}
        lede={<>{camp ? <Link className="hover:text-ink" href={`/console/campaigns/${call.campaign_id}`}>{camp.name}</Link> : 'Test call'}, {when(call.started_at ?? call.ended_at, org.timezone)}</>}
        actions={<>
          {call.needs_review ? <Pill tone="warn">Needs review</Pill> : null}
          <Pill tone={call.outcome === 'completed' ? 'pass' : call.outcome === 'failed' ? 'fail' : 'idle'}>{call.outcome ? OUTCOME_LABEL[call.outcome] : call.status.replace('_', ' ')}</Pill>
        </>} />

      {task.data?.state === 'open' ? <p className="mb-6 rounded-xl border border-warn/40 bg-warn/10 px-4 py-3 text-sm">Sent for review: {task.data.reason}</p> : null}

      <EvidencePlayer
        callId={id}
        src={recording.data?.signedUrl ?? null}
        durationMs={call.duration_ms ?? 0}
        turns={(turns.data ?? []) as EvTurn[]}
        answers={ans}
        prompts={prompts}
        canReview={atLeast(role, 'reviewer')}
        reviewing={reviewing}
      />

      <dl className="mt-10 grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        {[
          ['Length', duration(call.duration_ms)],
          ['Language heard', call.language_detected ?? '—'],
          ['Caller ID', call.from_e164 ?? '—'],
          ['Carrier', call.carrier],
          ['Cost', money(call.cost_minor, camp?.currency ?? (org.country === 'IN' ? 'INR' : 'USD'))],
          ['Typical reply time', metrics.p50_turn_ms ? `${(metrics.p50_turn_ms / 1000).toFixed(2)} s` : '—'],
          ['Interruptions', metrics.interruptions ?? '—'],
          ['Recording kept', `${org.recording_retention_days} days`],
        ].map(([k, v]) => <div key={String(k)}><dt className="text-ink-3">{k}</dt><dd className="tnum capitalize">{v}</dd></div>)}
      </dl>
    </>
  );
}
