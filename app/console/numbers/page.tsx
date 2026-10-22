import { orgContext, atLeast } from '@/lib/console/context';
import { PageHeader, Section, Table, Pill, Empty } from '@/components/console/ui';
import { ActionButton } from '@/components/console/forms';
import { AddNumberForm } from '@/components/console/numbers/AddNumberForm';
import { removeNumber } from '@/app/console/_actions/numbers';
import { when } from '@/lib/console/format';

export const metadata = { title: 'Caller IDs' };

export default async function Numbers() {
  const { db, org, role } = await orgContext();
  const { data } = await db.from('phone_numbers').select('id, e164, label, country, carrier, purpose, dlt_header, verified_at, created_at').eq('org_id', org.id).order('created_at');
  const isAdmin = atLeast(role, 'admin');
  return (
    <>
      <PageHeader title="Caller IDs" lede="The numbers your customers see. Each one is registered for one purpose, service or promotional, and a campaign can only use a number registered for its purpose." />
      {data?.length ? (
        <Table label="Caller IDs" head={['Number', 'Purpose', 'Carrier', 'DLT header', 'Status', '']}>
          {data.map((n) => (
            <tr key={n.id}>
              <td className="px-4 py-3"><span className="tnum font-medium">{n.e164}</span>{n.label ? <p className="text-ink-3">{n.label}</p> : null}</td>
              <td className="px-4 py-3 capitalize">{n.purpose}</td>
              <td className="px-4 py-3 capitalize text-ink-2">{n.carrier}</td>
              <td className="px-4 py-3 text-ink-2">{n.dlt_header ?? (n.country === 'IN' ? <Pill tone="fail">Missing</Pill> : 'n/a')}</td>
              <td className="px-4 py-3">{n.verified_at ? <Pill tone="pass">Verified {when(n.verified_at, org.timezone)}</Pill> : <Pill tone="warn">Awaiting verification</Pill>}</td>
              <td className="px-4 py-3 text-right">{isAdmin ? <ActionButton action={removeNumber} fields={{ id: n.id }} confirm="Remove?">Remove</ActionButton> : null}</td>
            </tr>
          ))}
        </Table>
      ) : <Empty title="No caller IDs yet">Rent a number in your {org.country === 'IN' ? 'Plivo' : 'Telnyx'} account, then add it here.</Empty>}

      {isAdmin ? (
        <Section title="Add a caller ID">
          <AddNumberForm country={org.country} />
        </Section>
      ) : null}

      <Section title="How verification works">
        <ol className="max-w-2xl list-decimal space-y-2 pl-5 text-ink-2">
          <li>Buy or port the number in your {org.country === 'IN' ? 'Plivo' : 'Telnyx'} account{org.country === 'IN' ? ' and register its header and call templates on your DLT portal' : ''}.</li>
          <li>Add it here with the purpose it is registered for.</li>
          <li>The VaniDial voice gateway checks that the number belongs to your carrier account and marks it verified. Nobody in your team can mark a number verified by hand.</li>
        </ol>
      </Section>
    </>
  );
}
