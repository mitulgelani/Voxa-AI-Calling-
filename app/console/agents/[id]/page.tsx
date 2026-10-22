import { notFound } from 'next/navigation';
import { orgContext, atLeast } from '@/lib/console/context';
import { PageHeader, Pill, Section } from '@/components/console/ui';
import { ActionButton } from '@/components/console/forms';
import { AgentEditor } from '@/components/console/agents/AgentEditor';
import { approveVersion, archiveAgent, testInBrowser } from '@/app/console/_actions/agents';
import { when } from '@/lib/console/format';
import type { QuestionT } from '@/lib/console/agent-schema';

export const metadata = { title: 'Agent' };

type Version = {
  id: string; version: number; opening_line: string; disclosure_line: string; goal: string; persona: string;
  questions: QuestionT[]; languages: string[]; voice: { id?: string; rate?: string }; approved_at: string | null; created_at: string; created_by: string | null;
};

export default async function AgentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ v?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const { db, org, role, user } = await orgContext();
  const [{ data: agent }, { data: vs }] = await Promise.all([
    db.from('agents').select('id, name, description, current_version_id, archived_at').eq('id', id).eq('org_id', org.id).maybeSingle(),
    db.from('agent_versions').select('id, version, opening_line, disclosure_line, goal, persona, questions, languages, voice, approved_at, created_at, created_by').eq('agent_id', id).order('version', { ascending: false }),
  ]);
  if (!agent) notFound();
  const versions = (vs ?? []) as Version[];
  const shown = versions.find((v) => String(v.version) === sp.v) ?? versions[0] ?? null;
  const canWrite = atLeast(role, 'operator') && !agent.archived_at;
  const canApprove = atLeast(role, 'admin');

  return (
    <>
      <PageHeader title={agent.name} back={{ href: '/console/agents', label: 'Agents' }}
        lede={agent.description || undefined}
        actions={canWrite ? <ActionButton action={archiveAgent} fields={{ agent: agent.id }} confirm="Archive this agent? Running campaigns keep their version.">Archive</ActionButton> : null} />

      <div className="grid gap-10 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0">
          {canWrite ? (
            <AgentEditor key={shown?.id ?? "new"} agentId={agent.id} base={shown ? {
              opening: shown.opening_line, disclosure: shown.disclosure_line, goal: shown.goal, persona: shown.persona,
              questions: shown.questions, languages: shown.languages, voice: shown.voice?.id ?? '', rate: (shown.voice?.rate as '-8%' | '+0%' | '+8%') ?? '+0%',
            } : null} baseVersion={shown?.version ?? null} />
          ) : shown ? (
            <ReadOnly v={shown} />
          ) : <p className="text-ink-2">No script has been written yet.</p>}
        </div>

        <aside aria-label="Versions">
          <Section title="Versions">
            {versions.length ? (
              <ol className="space-y-2">
                {versions.map((v) => {
                  const live = v.id === agent.current_version_id;
                  return (
                    <li key={v.id} className={`rounded-xl border px-4 py-3 ${shown?.id === v.id ? 'border-line-2 bg-panel' : 'border-line'}`}>
                      <div className="flex items-center gap-2">
                        <a href={`?v=${v.version}`} className="tnum font-medium hover:text-lamp">v{v.version}</a>
                        {live ? <Pill tone="pass">Live</Pill> : v.approved_at ? <Pill>Approved</Pill> : <Pill tone="warn">Draft</Pill>}
                        <span className="ml-auto text-xs text-ink-3">{when(v.created_at, org.timezone)}</span>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {atLeast(role, 'operator') ? <ActionButton action={testInBrowser} fields={{ version: v.id }} pending="Preparing">Hear it</ActionButton> : null}
                        {!v.approved_at && canApprove ? (
                          <ActionButton action={approveVersion} fields={{ version: v.id }} className="btn btn-lamp btn-sm"
                            confirm={v.created_by === user.id ? 'Approve your own script?' : `Approve v${v.version}?`}>Approve</ActionButton>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ol>
            ) : <p className="text-sm text-ink-3">Save the script to create v1.</p>}
            <p className="mt-4 text-sm text-ink-3">Approved versions never change. Campaigns lock the version they launched with, so every call can be traced to the exact words used.</p>
          </Section>
        </aside>
      </div>
    </>
  );
}

function ReadOnly({ v }: { v: Version }) {
  return (
    <div className="surface space-y-5 p-6">
      <div><p className="text-sm text-ink-3">Opening</p><p className="indic">{v.opening_line}</p></div>
      <div><p className="text-sm text-ink-3">Disclosure</p><p className="indic">{v.disclosure_line}</p></div>
      <div><p className="text-sm text-ink-3">Goal</p><p>{v.goal}</p></div>
      <div><p className="text-sm text-ink-3">Questions</p><ol className="mt-1 list-decimal space-y-1 pl-5">{v.questions.map((q) => <li key={q.key} className="indic">{q.prompt}</li>)}</ol></div>
    </div>
  );
}
