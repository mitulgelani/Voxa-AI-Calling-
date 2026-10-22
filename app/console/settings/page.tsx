import { orgContext, atLeast } from '@/lib/console/context';
import { PageHeader, Section, Table, Pill, Empty } from '@/components/console/ui';
import { ActionButton } from '@/components/console/forms';
import { OrgForm } from '@/components/console/settings/OrgForm';
import { RoleSelect } from '@/components/console/settings/RoleSelect';
import { SecretForm } from '@/components/console/settings/SecretForm';
import { addWebhook, createKey, invite, removeMember, removeWebhook, revokeKey, toggleWebhook, withdrawInvite } from '@/app/console/_actions/settings';
import { when } from '@/lib/console/format';

export const metadata = { title: 'Settings' };

const ROLE_HELP: [string, string][] = [
  ['Viewer', 'Sees campaigns, calls and answers. Phone numbers are partly hidden.'],
  ['Reviewer', 'Also reviews and corrects answers, and adds numbers to do-not-call.'],
  ['Operator', 'Also writes agents, imports contacts and plans campaigns.'],
  ['Admin', 'Also approves scripts, launches campaigns, manages caller IDs, team, keys and webhooks.'],
  ['Owner', 'Everything an admin can do. Cannot be removed.'],
];

export default async function Settings() {
  const { db, org, role, user } = await orgContext();
  const isAdmin = atLeast(role, 'admin');
  const [members, invites, keys, hooks] = await Promise.all([
    db.rpc('org_members', { p_org: org.id }),
    isAdmin ? db.from('invites').select('id, email, role, expires_at, accepted_at').eq('org_id', org.id).is('accepted_at', null).order('created_at', { ascending: false }) : Promise.resolve({ data: [] }),
    isAdmin ? db.from('api_keys').select('id, name, prefix, scopes, last_used_at, revoked_at, created_at').eq('org_id', org.id).order('created_at', { ascending: false }) : Promise.resolve({ data: [] }),
    isAdmin ? db.from('webhook_endpoints').select('id, url, events, active, created_at').eq('org_id', org.id).order('created_at') : Promise.resolve({ data: [] }),
  ]);
  const team = (members.data ?? []) as { user_id: string; email: string; role: string; joined_at: string }[];
  const check = (name: string, value: string, label: string, on = false) => (
    <label key={value} className="flex cursor-pointer items-center gap-2 rounded-lg border border-line-2 px-2.5 py-1.5 text-sm has-[:checked]:border-lamp has-[:checked]:bg-lamp/10">
      <input type="checkbox" name={name} value={value} defaultChecked={on} className="accent-[var(--color-lamp)]" />{label}
    </label>
  );

  return (
    <>
      <PageHeader title="Settings" lede={`${org.name}, ${org.country === 'IN' ? 'India' : org.country === 'US' ? 'United States' : 'Canada'}.`} />

      {isAdmin ? <Section title="Organisation"><OrgForm name={org.name} timezone={org.timezone} retention={org.recording_retention_days} /></Section> : null}

      <Section title="Team" aside={`${team.length} member${team.length === 1 ? '' : 's'}`}>
        <Table label="Team members" head={['Member', 'Role', 'Joined', '']}>
          {team.map((m) => (
            <tr key={m.user_id}>
              <td className="px-4 py-2.5">{m.email}{m.user_id === user.id ? <span className="text-ink-3"> (you)</span> : null}</td>
              <td className="px-4 py-2.5">{isAdmin && m.role !== 'owner' && m.user_id !== user.id ? <RoleSelect user={m.user_id} role={m.role} /> : <span className="capitalize">{m.role}</span>}</td>
              <td className="px-4 py-2.5 text-ink-3">{when(m.joined_at, org.timezone)}</td>
              <td className="px-4 py-2.5 text-right">{isAdmin && m.role !== 'owner' && m.user_id !== user.id ? <ActionButton action={removeMember} fields={{ user: m.user_id }} confirm="Remove?">Remove</ActionButton> : null}</td>
            </tr>
          ))}
        </Table>
        {isAdmin ? (
          <div className="surface mt-4 p-5">
            <SecretForm action={invite} submit="Create invite link">
              <label className="block min-w-60 flex-1"><span className="mb-1.5 block text-sm font-medium text-ink-2">Email</span><input name="email" type="email" required className="field" placeholder="teammate@company.com" /></label>
              <label className="block"><span className="mb-1.5 block text-sm font-medium text-ink-2">Role</span>
                <select name="role" className="field" defaultValue="reviewer">{['viewer', 'reviewer', 'operator', 'admin'].map((r) => <option key={r} value={r}>{r[0].toUpperCase() + r.slice(1)}</option>)}</select></label>
            </SecretForm>
            {(invites.data ?? []).length ? (
              <ul className="mt-5 divide-y divide-line border-t border-line text-sm">
                {(invites.data as { id: string; email: string; role: string; expires_at: string }[]).map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center gap-3 py-2.5">
                    <span>{i.email}</span><Pill>{i.role}</Pill>
                    <span className="text-ink-3">{new Date(i.expires_at) < new Date() ? 'Expired' : `Expires ${when(i.expires_at, org.timezone)}`}</span>
                    <span className="ml-auto"><ActionButton action={withdrawInvite} fields={{ id: i.id }}>Withdraw</ActionButton></span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
        <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          {ROLE_HELP.map(([r, d]) => <div key={r}><dt className="inline font-medium">{r}. </dt><dd className="inline text-ink-2">{d}</dd></div>)}
        </dl>
      </Section>

      {isAdmin ? (
        <>
          <Section title="API keys">
            <p className="mb-4 max-w-2xl text-sm text-ink-2">For pulling answers into your CRM or pushing contacts from your store. Keys are stored as hashes; a leaked database would not reveal them.</p>
            {(keys.data ?? []).length ? (
              <Table label="API keys" head={['Name', 'Key', 'Permissions', 'Last used', '']}>
                {(keys.data as { id: string; name: string; prefix: string; scopes: string[]; last_used_at: string | null; revoked_at: string | null }[]).map((k) => (
                  <tr key={k.id} className={k.revoked_at ? 'opacity-50' : ''}>
                    <td className="px-4 py-2.5">{k.name}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-ink-2">{k.prefix}…</td>
                    <td className="px-4 py-2.5 text-ink-2">{k.scopes.join(', ')}</td>
                    <td className="px-4 py-2.5 text-ink-3">{k.revoked_at ? 'Revoked' : when(k.last_used_at, org.timezone)}</td>
                    <td className="px-4 py-2.5 text-right">{!k.revoked_at ? <ActionButton action={revokeKey} fields={{ id: k.id }} confirm="Revoke? Anything using it stops working.">Revoke</ActionButton> : null}</td>
                  </tr>
                ))}
              </Table>
            ) : <Empty title="No API keys" />}
            <div className="surface mt-4 p-5">
              <SecretForm action={createKey} submit="Create key">
                <label className="block min-w-60 flex-1"><span className="mb-1.5 block text-sm font-medium text-ink-2">Name</span><input name="name" required maxLength={60} className="field" placeholder="HubSpot sync" /></label>
                <fieldset><legend className="mb-1.5 text-sm font-medium text-ink-2">Permissions</legend>
                  <div className="flex flex-wrap gap-2">{check('scopes', 'calls:read', 'Read calls', true)}{check('scopes', 'campaigns:read', 'Read campaigns')}{check('scopes', 'contacts:write', 'Add contacts')}</div></fieldset>
              </SecretForm>
            </div>
          </Section>

          <Section title="Webhooks">
            <p className="mb-4 max-w-2xl text-sm text-ink-2">We POST a JSON event to your URL, signed with HMAC-SHA256 in the VaniDial-Signature header. Failed deliveries retry with backoff for 24 hours.</p>
            {(hooks.data ?? []).length ? (
              <Table label="Webhooks" head={['URL', 'Events', 'Status', '']}>
                {(hooks.data as { id: string; url: string; events: string[]; active: boolean }[]).map((h) => (
                  <tr key={h.id}>
                    <td className="max-w-[280px] truncate px-4 py-2.5 font-mono text-xs">{h.url}</td>
                    <td className="px-4 py-2.5 text-ink-2">{h.events.join(', ')}</td>
                    <td className="px-4 py-2.5"><Pill tone={h.active ? 'pass' : 'idle'}>{h.active ? 'Active' : 'Paused'}</Pill></td>
                    <td className="px-4 py-2.5 text-right"><span className="inline-flex gap-2">
                      <ActionButton action={toggleWebhook} fields={{ id: h.id, active: h.active ? '0' : '1' }}>{h.active ? 'Pause' : 'Resume'}</ActionButton>
                      <ActionButton action={removeWebhook} fields={{ id: h.id }} confirm="Remove?">Remove</ActionButton>
                    </span></td>
                  </tr>
                ))}
              </Table>
            ) : <Empty title="No webhooks" />}
            <div className="surface mt-4 p-5">
              <SecretForm action={addWebhook} submit="Add webhook">
                <label className="block min-w-72 flex-1"><span className="mb-1.5 block text-sm font-medium text-ink-2">Endpoint URL</span><input name="url" type="url" required className="field" placeholder="https://api.yourstore.com/vanidial" /></label>
                <fieldset><legend className="mb-1.5 text-sm font-medium text-ink-2">Events</legend>
                  <div className="flex flex-wrap gap-2">{check('events', 'call.completed', 'Call completed', true)}{check('events', 'answer.reviewed', 'Answer reviewed')}{check('events', 'contact.opted_out', 'Opt-out')}{check('events', 'campaign.finished', 'Campaign finished')}</div></fieldset>
              </SecretForm>
            </div>
          </Section>
        </>
      ) : null}
    </>
  );
}
