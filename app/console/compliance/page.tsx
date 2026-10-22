import Link from 'next/link';
import { orgContext, atLeast } from '@/lib/console/context';
import { PageHeader, Section, Table, Empty, Stat } from '@/components/console/ui';
import { count, when } from '@/lib/console/format';

export const metadata = { title: 'Compliance' };

const ACTION: Record<string, string> = {
  'campaign.launch': 'Launched a campaign', 'campaign.paused': 'Paused a campaign', 'campaign.running': 'Resumed a campaign',
  'campaign.completed': 'Completed a campaign', 'campaign.cancelled': 'Cancelled a campaign', 'campaigns.insert': 'Created a campaign draft', 'campaigns.delete': 'Deleted a campaign draft',
  'agent.version_created': 'Saved an agent version', 'agent.version_approved': 'Approved an agent version',
  'dnc.add': 'Added a number to do-not-call', 'list.import': 'Imported contacts', 'list.dnd_scrub': 'Recorded a DND scrub',
  'contact_lists.insert': 'Created a contact list', 'contact_lists.delete': 'Deleted a contact list',
  'phone_numbers.insert': 'Added a caller ID', 'phone_numbers.update': 'Changed a caller ID', 'phone_numbers.delete': 'Removed a caller ID',
  'memberships.insert': 'Added a team member', 'memberships.update': 'Changed a role', 'memberships.delete': 'Removed a team member',
  'invites.insert': 'Sent an invite', 'invites.delete': 'Withdrew an invite', 'invite.accepted': 'Accepted an invite',
  'api_keys.insert': 'Created an API key', 'api_keys.update': 'Revoked an API key', 'webhook_endpoints.insert': 'Added a webhook',
  'webhook_endpoints.update': 'Changed a webhook', 'webhook_endpoints.delete': 'Removed a webhook',
  'organizations.insert': 'Created the organisation', 'organizations.update': 'Changed organisation settings',
  'review.done': 'Reviewed a call', 'review.skipped': 'Skipped a review',
};
const LINK: Record<string, (id: string) => string> = { campaign: (id) => `/console/campaigns/${id}`, campaigns: (id) => `/console/campaigns/${id}`, call: (id) => `/console/calls/${id}`, contact_list: (id) => `/console/contacts/${id}` };

function summary(detail: Record<string, unknown>) {
  const parts: string[] = [];
  if (detail.name) parts.push(String(detail.name));
  if (detail.version) parts.push(`v${detail.version}`);
  if (detail.role) parts.push(`role ${detail.role}`);
  if (detail.e164) parts.push(String(detail.e164));
  if (detail.inserted !== undefined) parts.push(`${detail.inserted} of ${detail.received} saved`);
  if (detail.attestation) parts.push(`consent: ${detail.attestation}`);
  if (detail.removed !== undefined) parts.push(`${detail.removed} of ${detail.checked} removed via ${detail.provider}`);
  if (detail.to) parts.push(`${detail.from} → ${detail.to}`);
  if (detail.corrected !== undefined) parts.push(`${detail.corrected} corrected`);
  if (detail.reason) parts.push(String(detail.reason).replace('_', ' '));
  return parts.join(', ');
}

export default async function Compliance({ searchParams }: { searchParams: Promise<{ before?: string }> }) {
  const sp = await searchParams;
  const { db, org, role } = await orgContext('reviewer');
  const isAdmin = atLeast(role, 'admin');
  const since = new Date(Date.now() - 30 * 864e5).toISOString();
  const [dnc, optOuts, members, log] = await Promise.all([
    db.from('dnc_entries').select('e164', { count: 'exact', head: true }).eq('org_id', org.id),
    db.from('calls').select('id', { count: 'exact', head: true }).eq('org_id', org.id).eq('outcome', 'opted_out').gte('created_at', since),
    db.rpc('org_members', { p_org: org.id }),
    isAdmin ? (() => {
      let q = db.from('audit_log').select('id, actor_id, action, entity, entity_id, detail, at').eq('org_id', org.id).order('id', { ascending: false }).limit(100);
      if (sp.before && /^\d+$/.test(sp.before)) q = q.lt('id', Number(sp.before));
      return q;
    })() : Promise.resolve({ data: null }),
  ]);
  const who = new Map(((members.data ?? []) as { user_id: string; email: string }[]).map((m) => [m.user_id, m.email]));
  const rows = (log.data ?? []) as { id: number; actor_id: string | null; action: string; entity: string; entity_id: string | null; detail: Record<string, unknown>; at: string }[];

  return (
    <>
      <PageHeader title="Compliance" lede="What protects the people you call, and a record of every decision your team made. The audit log is append-only: nobody, including VaniDial staff using the app, can edit or delete an entry." />
      <dl className="surface grid grid-cols-1 divide-line sm:grid-cols-3 sm:divide-x max-sm:divide-y">
        <Stat label="Numbers on do-not-call" value={count(dnc.count ?? 0)} note={<Link className="text-lamp hover:underline" href="/console/contacts/dnc">Open the list</Link>} />
        <Stat label="Opt-outs in 30 days" value={count(optOuts.count ?? 0)} note="Added to do-not-call during the call" />
        <Stat label="Recordings kept for" value={`${org.recording_retention_days} days`} note="Then deleted automatically" />
      </dl>

      <Section title="Rules every call follows">
        <ul className="grid gap-3 sm:grid-cols-2">
          {[
            ['The agent says it is an AI', 'The disclosure line is spoken on every call and cannot be removed from an approved script.'],
            ['Only legal hours', `${org.country === 'IN' ? '09:00–21:00' : '08:00–21:00'} in the contact’s timezone, checked at launch and again before every dial.`],
            ['No repeat calls', 'A number that answered in the last 7 days is not called again by any campaign.'],
            ['Opt-outs are instant', '“Don’t call me” ends the call politely and blocks the number before the line drops.'],
            ['Consent or no call', 'Contacts without a consent source and date are never dialled.'],
            ['Spend stops at the cap', 'The dialler stops claiming calls once a campaign reaches its budget.'],
          ].map(([t, d]) => (
            <li key={t} className="rounded-xl border border-line p-4"><p className="font-medium">{t}</p><p className="mt-1 text-sm text-ink-2">{d}</p></li>
          ))}
        </ul>
      </Section>

      <Section title="Audit log" aside={isAdmin ? 'Newest first' : undefined}>
        {!isAdmin ? <p className="text-sm text-ink-2">Admins can read the audit log.</p> : rows.length ? (
          <>
            <Table label="Audit log" head={['When', 'Who', 'What', 'Details']}>
              {rows.map((r) => {
                const href = r.entity_id && LINK[r.entity] ? LINK[r.entity](r.entity_id) : null;
                return (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap px-4 py-2.5 text-ink-3">{when(r.at, org.timezone)}</td>
                    <td className="max-w-[180px] truncate px-4 py-2.5 text-ink-2">{r.actor_id ? who.get(r.actor_id) ?? 'Former member' : 'VaniDial system'}</td>
                    <td className="px-4 py-2.5">{href ? <Link className="hover:text-lamp" href={href}>{ACTION[r.action] ?? r.action}</Link> : ACTION[r.action] ?? r.action}</td>
                    <td className="max-w-[360px] truncate px-4 py-2.5 text-ink-3" title={summary(r.detail)}>{summary(r.detail) || '—'}</td>
                  </tr>
                );
              })}
            </Table>
            {rows.length === 100 ? <Link className="btn btn-quiet btn-sm mt-4" href={`?before=${rows[rows.length - 1].id}`}>Older entries</Link> : null}
          </>
        ) : <Empty title="No entries yet" />}
      </Section>
    </>
  );
}
