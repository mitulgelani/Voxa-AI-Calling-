import Link from 'next/link';
import { orgContext, atLeast } from '@/lib/console/context';
import { PageHeader, Empty, Pill, Table } from '@/components/console/ui';
import { when } from '@/lib/console/format';

export const metadata = { title: 'Agents' };

export default async function Agents() {
  const { db, org, role } = await orgContext();
  const { data } = await db.from('agents')
    .select('id, name, description, updated_at, current_version_id, agent_versions!agent_versions_agent_id_fkey(version, approved_at, languages)')
    .eq('org_id', org.id).is('archived_at', null).order('updated_at', { ascending: false });
  const agents = data ?? [];
  const canWrite = atLeast(role, 'operator');
  return (
    <>
      <PageHeader title="Agents" lede="An agent is a script: what it says first, how it discloses that it is automated, and the questions it must get answered. Every edit becomes a new version; only approved versions can call anyone."
        actions={canWrite ? <Link href="/console/agents/new" className="btn btn-lamp">New agent</Link> : null} />
      {agents.length ? (
        <Table label="Agents" head={['Agent', 'Live version', 'Latest draft', 'Languages', 'Updated']}>
          {agents.map((a) => {
            const versions = ((a.agent_versions ?? []) as { version: number; approved_at: string | null; languages: string[] }[]).sort((x, y) => y.version - x.version);
            const approved = versions.find((v) => v.approved_at);
            const latest = versions[0];
            return (
              <tr key={a.id} className="hover:bg-panel-2">
                <td className="px-4 py-3"><Link href={`/console/agents/${a.id}`} className="font-medium hover:text-lamp">{a.name}</Link>{a.description ? <p className="max-w-xs truncate text-ink-3">{a.description}</p> : null}</td>
                <td className="px-4 py-3">{approved ? <Pill tone="pass">v{approved.version} approved</Pill> : <Pill>None yet</Pill>}</td>
                <td className="px-4 py-3">{latest && !latest.approved_at ? <Pill tone="warn">v{latest.version} awaiting approval</Pill> : <span className="text-ink-3">—</span>}</td>
                <td className="px-4 py-3 text-ink-2">{(latest?.languages ?? []).join(', ') || '—'}</td>
                <td className="px-4 py-3 text-ink-3">{when(a.updated_at, org.timezone)}</td>
              </tr>
            );
          })}
        </Table>
      ) : (
        <Empty title="No agents yet" action={canWrite ? <Link href="/console/agents/new" className="btn btn-lamp">Write your first agent</Link> : null}>
          Start from a feedback-call template: an opening line, an AI disclosure and three questions.
        </Empty>
      )}
    </>
  );
}
