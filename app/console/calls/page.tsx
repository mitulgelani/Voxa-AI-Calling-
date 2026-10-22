import Link from 'next/link';
import { orgContext, atLeast } from '@/lib/console/context';
import { PageHeader, Pill, Table, Empty } from '@/components/console/ui';
import { duration, maskPhone, when, OUTCOME_LABEL } from '@/lib/console/format';

export const metadata = { title: 'Calls' };
const PAGE = 50;

export default async function Calls({ searchParams }: { searchParams: Promise<{ outcome?: string; campaign?: string; review?: string; q?: string; page?: string }> }) {
  const sp = await searchParams;
  const { db, org, role } = await orgContext();
  const page = Math.max(0, Number(sp.page ?? 0) || 0);
  let q = db.from('calls').select('id, to_e164, outcome, status, duration_ms, language_detected, created_at, needs_review, campaigns(name)', { count: 'exact' }).eq('org_id', org.id);
  if (sp.outcome && sp.outcome in OUTCOME_LABEL) q = q.eq('outcome', sp.outcome);
  if (sp.campaign && /^[0-9a-f-]{36}$/.test(sp.campaign)) q = q.eq('campaign_id', sp.campaign);
  if (sp.review === '1') q = q.eq('needs_review', true);
  const digits = (sp.q ?? '').replace(/\D/g, '').slice(0, 15);
  if (digits.length >= 4) q = q.like('to_e164', `%${digits}%`);
  const [{ data, count }, { data: campaigns }] = await Promise.all([
    q.order('created_at', { ascending: false }).range(page * PAGE, page * PAGE + PAGE - 1),
    db.from('campaigns').select('id, name').eq('org_id', org.id).neq('status', 'draft').order('created_at', { ascending: false }),
  ]);
  const showFull = atLeast(role, 'operator');
  const qs = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.entries({ ...sp, ...patch }).filter(([, v]) => v) as [string, string][]);
    return `?${p.toString()}`;
  };
  const pages = Math.ceil((count ?? 0) / PAGE);

  return (
    <>
      <PageHeader title="Calls" lede="Every call, with its recording, transcript and the answers taken from it. Click a call to hear the exact second each answer came from." />
      <form className="surface mb-4 flex flex-wrap items-end gap-3 p-4" role="search">
        <label className="block"><span className="mb-1 block text-xs text-ink-3">Number contains</span>
          <input name="q" defaultValue={sp.q} inputMode="tel" className="field w-44 py-2" placeholder="43210" /></label>
        <label className="block"><span className="mb-1 block text-xs text-ink-3">Campaign</span>
          <select name="campaign" defaultValue={sp.campaign ?? ''} className="field w-52 py-2"><option value="">All campaigns</option>{(campaigns ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label className="block"><span className="mb-1 block text-xs text-ink-3">Outcome</span>
          <select name="outcome" defaultValue={sp.outcome ?? ''} className="field w-44 py-2"><option value="">Any outcome</option>{Object.entries(OUTCOME_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="flex items-center gap-2 pb-2 text-sm text-ink-2"><input type="checkbox" name="review" value="1" defaultChecked={sp.review === '1'} className="accent-[var(--color-lamp)]" /> Needs review</label>
        <button className="btn btn-quiet btn-sm mb-0.5">Filter</button>
        {Object.values(sp).some(Boolean) ? <Link href="/console/calls" className="mb-2 text-sm text-ink-3 hover:text-ink">Clear</Link> : null}
      </form>
      {data?.length ? (
        <>
          <Table label="Calls" head={['Number', 'Campaign', 'Outcome', 'Language', 'Length', 'When']}>
            {data.map((c) => {
              const camp = (Array.isArray(c.campaigns) ? c.campaigns[0] : c.campaigns) as { name: string } | null;
              return (
                <tr key={c.id} className="hover:bg-panel-2">
                  <td className="tnum px-4 py-2.5"><Link href={`/console/calls/${c.id}`} className="hover:text-lamp">{showFull ? c.to_e164 : maskPhone(c.to_e164)}</Link></td>
                  <td className="max-w-[200px] truncate px-4 py-2.5 text-ink-2">{camp?.name ?? 'Test call'}</td>
                  <td className="px-4 py-2.5">{c.needs_review ? <Pill tone="warn">Needs review</Pill> : <Pill tone={c.outcome === 'completed' ? 'pass' : c.outcome === 'failed' ? 'fail' : 'idle'}>{c.outcome ? OUTCOME_LABEL[c.outcome] : c.status.replace('_', ' ')}</Pill>}</td>
                  <td className="px-4 py-2.5 text-ink-2">{c.language_detected ?? '—'}</td>
                  <td className="tnum px-4 py-2.5 text-ink-2">{duration(c.duration_ms)}</td>
                  <td className="px-4 py-2.5 text-ink-3">{when(c.created_at, org.timezone)}</td>
                </tr>
              );
            })}
          </Table>
          {pages > 1 ? (
            <nav className="mt-4 flex items-center gap-3 text-sm" aria-label="Pages">
              {page > 0 ? <Link className="btn btn-quiet btn-sm" href={qs({ page: String(page - 1) })}>Previous</Link> : null}
              <span className="tnum text-ink-3">Page {page + 1} of {pages}</span>
              {page + 1 < pages ? <Link className="btn btn-quiet btn-sm" href={qs({ page: String(page + 1) })}>Next</Link> : null}
            </nav>
          ) : null}
        </>
      ) : <Empty title={Object.values(sp).some(Boolean) ? 'No calls match these filters' : 'No calls yet'}>{Object.values(sp).some(Boolean) ? undefined : 'Calls appear here as soon as a campaign starts dialling.'}</Empty>}
    </>
  );
}
