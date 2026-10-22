import Link from 'next/link';
import { orgContext } from '@/lib/console/context';
import { PageHeader, Table, Empty, Stat } from '@/components/console/ui';
import { count, maskPhone, when } from '@/lib/console/format';

export const metadata = { title: 'Review queue' };

export default async function Review({ searchParams }: { searchParams: Promise<{ done?: string }> }) {
  const sp = await searchParams;
  const { db, org } = await orgContext('reviewer');
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const [{ data, count: open }, done] = await Promise.all([
    db.from('review_tasks').select('call_id, reason, created_at, calls(to_e164, campaigns(name))', { count: 'exact' }).eq('org_id', org.id).eq('state', 'open').order('created_at').limit(100),
    db.from('review_tasks').select('id', { count: 'exact', head: true }).eq('org_id', org.id).eq('state', 'done').gte('done_at', today.toISOString()),
  ]);
  const oldest = data?.[0]?.created_at;
  return (
    <>
      <PageHeader title="Review queue" lede="Calls where the agent was unsure of an answer, the customer was upset, or the call ended oddly. Listen to the evidence, fix what is wrong, confirm the rest."
        actions={data?.length ? <Link href={`/console/calls/${data[0].call_id}?review=1`} className="btn btn-lamp">Start reviewing</Link> : null} />
      {sp.done ? <p role="status" className="mb-6 rounded-xl border border-pass/40 bg-pass/10 px-4 py-3 text-sm">Queue cleared. Nice work.</p> : null}
      <dl className="surface mb-8 grid grid-cols-1 divide-line sm:grid-cols-3 sm:divide-x max-sm:divide-y">
        <Stat label="Waiting" value={count(open ?? 0)} tone={(open ?? 0) > 0 ? 'warn' : 'pass'} />
        <Stat label="Oldest waiting since" value={oldest ? when(oldest, org.timezone) : '—'} />
        <Stat label="Reviewed today" value={count(done.count ?? 0)} />
      </dl>
      {data?.length ? (
        <Table label="Calls waiting for review" head={['Call', 'Campaign', 'Why', 'Waiting since']}>
          {data.map((t) => {
            const call = (Array.isArray(t.calls) ? t.calls[0] : t.calls) as { to_e164: string; campaigns: { name: string } | { name: string }[] | null } | null;
            const camp = call ? (Array.isArray(call.campaigns) ? call.campaigns[0] : call.campaigns) : null;
            return (
              <tr key={t.call_id} className="hover:bg-panel-2">
                <td className="tnum px-4 py-2.5"><Link className="hover:text-lamp" href={`/console/calls/${t.call_id}?review=1`}>{call ? maskPhone(call.to_e164) : 'Call'}</Link></td>
                <td className="px-4 py-2.5 text-ink-2">{camp?.name ?? '—'}</td>
                <td className="px-4 py-2.5">{t.reason}</td>
                <td className="px-4 py-2.5 text-ink-3">{when(t.created_at, org.timezone)}</td>
              </tr>
            );
          })}
        </Table>
      ) : <Empty title="Nothing to review">Low-confidence answers land here automatically. Everything else is confirmed by the agent.</Empty>}
    </>
  );
}
