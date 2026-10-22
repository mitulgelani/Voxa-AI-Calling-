import Link from 'next/link';
import { orgContext, atLeast } from '@/lib/console/context';
import { PageHeader, Empty, Pill, STATUS_TONE, Table } from '@/components/console/ui';
import { money, when } from '@/lib/console/format';

export const metadata = { title: 'Campaigns' };

export default async function Campaigns() {
  const { db, org, role } = await orgContext();
  const { data } = await db.from('campaigns')
    .select('id, name, status, purpose, spent_minor, budget_cap_minor, currency, updated_at, contact_lists(name)')
    .eq('org_id', org.id).order('updated_at', { ascending: false });
  return (
    <>
      <PageHeader title="Campaigns" lede="Who to call, with which agent, from which number, and when. Configuration locks at launch so every call can be traced to the exact setup that made it."
        actions={atLeast(role, 'operator') ? <Link href="/console/campaigns/new" className="btn btn-lamp">New campaign</Link> : null} />
      {data?.length ? (
        <Table label="Campaigns" head={['Campaign', 'Status', 'List', 'Spend', 'Updated']}>
          {data.map((c) => {
            const list = (Array.isArray(c.contact_lists) ? c.contact_lists[0] : c.contact_lists) as { name: string } | null;
            const share = c.budget_cap_minor ? Math.min(1, c.spent_minor / c.budget_cap_minor) : 0;
            return (
              <tr key={c.id} className="hover:bg-panel-2">
                <td className="px-4 py-3"><Link href={`/console/campaigns/${c.id}`} className="font-medium hover:text-lamp">{c.name}</Link><p className="text-ink-3 capitalize">{c.purpose ?? 'purpose not set'}</p></td>
                <td className="px-4 py-3"><Pill tone={STATUS_TONE[c.status]}>{c.status}</Pill></td>
                <td className="px-4 py-3 text-ink-2">{list?.name ?? '—'}</td>
                <td className="px-4 py-3">
                  <span className="tnum">{money(c.spent_minor, c.currency)}</span><span className="tnum text-ink-3"> of {money(c.budget_cap_minor, c.currency)}</span>
                  <span className="mt-1.5 block h-1 w-28 overflow-hidden rounded-full bg-panel-2" aria-hidden><span className={`block h-full ${share > 0.9 ? 'bg-fail' : 'bg-lamp'}`} style={{ width: `${share * 100}%` }} /></span>
                </td>
                <td className="px-4 py-3 text-ink-3">{when(c.updated_at, org.timezone)}</td>
              </tr>
            );
          })}
        </Table>
      ) : (
        <Empty title="No campaigns yet" action={atLeast(role, 'operator') ? <Link href="/console/campaigns/new" className="btn btn-lamp">Plan a campaign</Link> : null}>
          You need an approved agent, a verified caller ID and a contact list with consent. Drafts are free; nothing dials until launch.
        </Empty>
      )}
    </>
  );
}
