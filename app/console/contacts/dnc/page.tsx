import { orgContext, atLeast } from '@/lib/console/context';
import { PageHeader, Section, Table, Empty, Pill } from '@/components/console/ui';
import { DncForm } from '@/components/console/contacts/DncForm';
import { maskPhone, when } from '@/lib/console/format';

export const metadata = { title: 'Do-not-call list' };
const REASON: Record<string, string> = { opt_out: 'Asked on a call', complaint: 'Complaint', manual: 'Added by a teammate', legal: 'Legal request' };

export default async function Dnc() {
  const { db, org, role } = await orgContext('reviewer');
  const { data, count } = await db.from('dnc_entries').select('e164, reason, created_at, source_call_id', { count: 'exact' }).eq('org_id', org.id).order('created_at', { ascending: false }).limit(200);
  return (
    <>
      <PageHeader title="Do-not-call list" back={{ href: '/console/contacts', label: 'Contacts' }}
        lede="When someone says “don’t call me again” on a call, the agent confirms it and the number lands here within a second. Numbers can be added but never removed from the app, so an opt-out can’t be undone by mistake." />
      {atLeast(role, 'reviewer') ? <Section title="Add a number"><DncForm /></Section> : null}
      <Section title="Blocked numbers" aside={`${count ?? 0} in total`}>
        {data?.length ? (
          <Table label="Do-not-call numbers" head={['Number', 'Why', 'Added']}>
            {data.map((d) => (
              <tr key={d.e164}>
                <td className="tnum px-4 py-2.5">{atLeast(role, 'operator') ? d.e164 : maskPhone(d.e164)}</td>
                <td className="px-4 py-2.5"><Pill tone={d.reason === 'opt_out' ? 'live' : 'idle'}>{REASON[d.reason] ?? d.reason}</Pill></td>
                <td className="px-4 py-2.5 text-ink-3">{when(d.created_at, org.timezone)}</td>
              </tr>
            ))}
          </Table>
        ) : <Empty title="Nobody has opted out yet" />}
      </Section>
    </>
  );
}
