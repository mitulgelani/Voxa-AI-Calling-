import Link from 'next/link';
import { orgContext, atLeast } from '@/lib/console/context';
import { PageHeader, Empty, Pill, Table } from '@/components/console/ui';
import { count, when } from '@/lib/console/format';

export const metadata = { title: 'Contacts' };

export default async function Contacts() {
  const { db, org, role } = await orgContext();
  const { data: lists } = await db.from('contact_lists').select('id, name, created_at').eq('org_id', org.id).order('created_at', { ascending: false });
  const ids = (lists ?? []).map((l) => l.id);
  const [{ data: scrubs }, stats] = await Promise.all([
    ids.length ? db.from('dnd_scrubs').select('list_id, scrubbed_at').in('list_id', ids).order('scrubbed_at', { ascending: false }) : Promise.resolve({ data: [] as { list_id: string; scrubbed_at: string }[] }),
    Promise.all(ids.map(async (id) => {
      const [all, consented] = await Promise.all([
        db.from('contacts').select('id', { count: 'exact', head: true }).eq('list_id', id),
        db.from('contacts').select('id', { count: 'exact', head: true }).eq('list_id', id).not('consent_source', 'is', null).not('consent_at', 'is', null),
      ]);
      return [id, { total: all.count ?? 0, consented: consented.count ?? 0 }] as const;
    })),
  ]);
  const byList = new Map(stats);
  const lastScrub = new Map<string, string>();
  for (const s of scrubs ?? []) if (!lastScrub.has(s.list_id)) lastScrub.set(s.list_id, s.scrubbed_at);
  const canWrite = atLeast(role, 'operator');

  return (
    <>
      <PageHeader title="Contacts" lede="Lists of people you may call, each with the evidence of how they agreed to it. Numbers on your do-not-call list are never dialled, whichever list they are in."
        actions={<>
          {atLeast(role, 'reviewer') ? <Link href="/console/contacts/dnc" className="btn btn-quiet">Do-not-call list</Link> : null}
          {canWrite ? <Link href="/console/contacts/import" className="btn btn-lamp">Import a CSV</Link> : null}
        </>} />
      {(lists ?? []).length ? (
        <Table label="Contact lists" head={['List', 'Contacts', 'With consent', 'Last DND scrub', 'Created']}>
          {lists!.map((l) => {
            const s = byList.get(l.id) ?? { total: 0, consented: 0 };
            const scrub = lastScrub.get(l.id);
            const fresh = scrub && Date.now() - new Date(scrub).getTime() < 864e5;
            return (
              <tr key={l.id} className="hover:bg-panel-2">
                <td className="px-4 py-3"><Link className="font-medium hover:text-lamp" href={`/console/contacts/${l.id}`}>{l.name}</Link></td>
                <td className="tnum px-4 py-3">{count(s.total)}</td>
                <td className="px-4 py-3">{s.total ? <Pill tone={s.consented === s.total ? 'pass' : s.consented ? 'warn' : 'fail'}>{count(s.consented)} of {count(s.total)}</Pill> : '—'}</td>
                <td className="px-4 py-3">{org.country !== 'IN' ? <span className="text-ink-3">Not required</span> : scrub ? <Pill tone={fresh ? 'pass' : 'warn'}>{when(scrub, org.timezone)}</Pill> : <Pill tone="fail">Never</Pill>}</td>
                <td className="px-4 py-3 text-ink-3">{when(l.created_at, org.timezone)}</td>
              </tr>
            );
          })}
        </Table>
      ) : (
        <Empty title="No contact lists yet" action={canWrite ? <Link href="/console/contacts/import" className="btn btn-lamp">Import a CSV</Link> : null}>
          Export customers from your store or CRM with a phone column. You map the columns and confirm how consent was collected before anything is saved.
        </Empty>
      )}
    </>
  );
}
