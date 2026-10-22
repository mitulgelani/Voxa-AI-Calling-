import Link from 'next/link';
import { notFound } from 'next/navigation';
import { orgContext, atLeast } from '@/lib/console/context';
import { PageHeader, Pill, Section, Table, Stat } from '@/components/console/ui';
import { ActionButton } from '@/components/console/forms';
import { ScrubForm } from '@/components/console/contacts/ScrubForm';
import { deleteList } from '@/app/console/_actions/contacts';
import { count, maskPhone, when } from '@/lib/console/format';

export const metadata = { title: 'Contact list' };
const PAGE = 50;

export default async function ListPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ page?: string; imported?: string; q?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const page = Math.max(0, Number(sp.page ?? 0) || 0);
  const { db, org, role } = await orgContext();
  const { data: list } = await db.from('contact_lists').select('id, name, created_at').eq('id', id).eq('org_id', org.id).maybeSingle();
  if (!list) notFound();

  let q = db.from('contacts').select('id, e164, name, language, consent_source, consent_at, attrs', { count: 'exact' }).eq('list_id', id);
  const search = (sp.q ?? '').trim().slice(0, 40);
  if (search) q = /^[+\d\s-]+$/.test(search) ? q.like('e164', `%${search.replace(/[^\d]/g, '')}%`) : q.ilike('name', `%${search.replace(/[%_]/g, '')}%`);
  const [{ data: rows, count: total }, consented, { data: scrubs }, { data: used }] = await Promise.all([
    q.order('created_at').range(page * PAGE, page * PAGE + PAGE - 1),
    db.from('contacts').select('id', { count: 'exact', head: true }).eq('list_id', id).not('consent_source', 'is', null).not('consent_at', 'is', null),
    db.from('dnd_scrubs').select('provider, checked_count, removed_count, scrubbed_at').eq('list_id', id).order('scrubbed_at', { ascending: false }).limit(5),
    db.from('campaigns').select('id, name, status').eq('list_id', id),
  ]);
  const all = await db.from('contacts').select('id', { count: 'exact', head: true }).eq('list_id', id);
  const totalAll = all.count ?? 0;
  const last = scrubs?.[0];
  const fresh = last && Date.now() - new Date(last.scrubbed_at).getTime() < 864e5;
  const pages = Math.ceil((total ?? 0) / PAGE);

  return (
    <>
      <PageHeader title={list.name} back={{ href: '/console/contacts', label: 'Contacts' }}
        actions={atLeast(role, 'admin') ? <ActionButton action={deleteList} fields={{ list: id }} confirm="Delete this list and its contacts?">Delete list</ActionButton> : null} />
      {sp.imported ? <p role="status" className="mb-6 rounded-xl border border-pass/40 bg-pass/10 px-4 py-3 text-sm">Import finished. {org.country === 'IN' ? 'Run a DND scrub before launching a campaign with this list.' : ''}</p> : null}

      <dl className="surface grid grid-cols-1 divide-line sm:grid-cols-3 sm:divide-x max-sm:divide-y">
        <Stat label="Contacts" value={count(totalAll)} />
        <Stat label="With consent evidence" value={count(consented.count ?? 0)} tone={(consented.count ?? 0) === totalAll ? 'pass' : 'warn'} note={(consented.count ?? 0) < totalAll ? 'The rest are never called' : 'Everyone can be called'} />
        <Stat label="DND scrub" value={org.country !== 'IN' ? 'n/a' : last ? (fresh ? 'Fresh' : 'Stale') : 'Never'} tone={org.country !== 'IN' ? undefined : fresh ? 'pass' : 'fail'}
          note={last ? `${when(last.scrubbed_at, org.timezone)} via ${last.provider}` : org.country === 'IN' ? 'Required within 24 hours of launch' : 'Not required outside India'} />
      </dl>

      {org.country === 'IN' && atLeast(role, 'operator') ? (
        <Section title="Record a DND scrub">
          <ScrubForm listId={id} />
        </Section>
      ) : null}

      <Section title="Contacts" aside={used?.length ? <>Used by {used.map((c, i) => <span key={c.id}>{i ? ', ' : ''}<Link className="hover:text-ink" href={`/console/campaigns/${c.id}`}>{c.name}</Link></span>)}</> : null}>
        <form className="mb-3 flex gap-2" role="search">
          <label htmlFor="q" className="sr-only">Search by name or number</label>
          <input id="q" name="q" defaultValue={search} className="field max-w-xs py-2" placeholder="Search name or number" />
          <button className="btn btn-quiet btn-sm">Search</button>
        </form>
        <Table label="Contacts" head={['Name', 'Number', 'Language', 'Consent', 'Details']}>
          {(rows ?? []).map((c) => (
            <tr key={c.id}>
              <td className="px-4 py-2.5">{c.name || <span className="text-ink-3">No name</span>}</td>
              <td className="tnum px-4 py-2.5 text-ink-2">{atLeast(role, 'operator') ? c.e164 : maskPhone(c.e164)}</td>
              <td className="px-4 py-2.5 text-ink-2">{c.language ?? '—'}</td>
              <td className="px-4 py-2.5">{c.consent_source && c.consent_at ? <span title={c.consent_source}><Pill tone="pass">{new Date(c.consent_at).toLocaleDateString('en-IN')}</Pill></span> : <Pill tone="fail">Missing</Pill>}</td>
              <td className="max-w-[260px] truncate px-4 py-2.5 text-ink-3">{Object.entries((c.attrs ?? {}) as Record<string, string>).slice(0, 3).map(([k, v]) => `${k}: ${v}`).join(', ') || '—'}</td>
            </tr>
          ))}
        </Table>
        {pages > 1 ? (
          <nav className="mt-4 flex items-center gap-3 text-sm" aria-label="Pages">
            {page > 0 ? <Link className="btn btn-quiet btn-sm" href={`?page=${page - 1}${search ? `&q=${encodeURIComponent(search)}` : ''}`}>Previous</Link> : null}
            <span className="tnum text-ink-3">Page {page + 1} of {pages}</span>
            {page + 1 < pages ? <Link className="btn btn-quiet btn-sm" href={`?page=${page + 1}${search ? `&q=${encodeURIComponent(search)}` : ''}`}>Next</Link> : null}
          </nav>
        ) : null}
      </Section>
    </>
  );
}
