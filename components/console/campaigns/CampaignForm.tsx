'use client';

import { useState } from 'react';
import Link from 'next/link';
import { saveDraft } from '@/app/console/_actions/campaigns';
import { ActionForm, Submit } from '../forms';

type Opt = { id: string; label: string };
export type CampaignDraft = {
  id?: string; name: string; purpose: 'service' | 'promotional'; agent_version_id: string; phone_number_id: string; list_id: string;
  window_start: string; window_end: string; days: number[]; max_concurrent: number; dials_per_minute: number;
  max_attempts: number; retry_after_minutes: number; budget: number;
};
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function CampaignForm({ draft, options, currency, country }: {
  draft: CampaignDraft; currency: string; country: string;
  options: { versions: Opt[]; numbers: (Opt & { purpose: string; verified: boolean })[]; lists: Opt[] };
}) {
  const [purpose, setPurpose] = useState(draft.purpose);
  const numbers = options.numbers.filter((n) => n.purpose === purpose);
  const sel = (name: keyof CampaignDraft, label: string, opts: Opt[], empty: React.ReactNode) => (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-ink-2">{label}</span>
      {opts.length ? (
        <select name={name} className="field" defaultValue={String(draft[name] ?? '')} required>
          <option value="" disabled>Choose…</option>
          {opts.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      ) : <p className="rounded-xl border border-dashed border-line-2 px-3 py-2.5 text-sm text-ink-3">{empty}</p>}
    </label>
  );
  const num = (name: keyof CampaignDraft, label: string, min: number, max: number, hint?: string) => (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-ink-2">{label}</span>
      <input name={name} type="number" className="field tnum" min={min} max={max} defaultValue={String(draft[name])} required />
      {hint ? <span className="mt-1 block text-xs text-ink-3">{hint}</span> : null}
    </label>
  );
  const hours = country === 'IN' ? '09:00–21:00' : '08:00–21:00';

  return (
    <ActionForm action={saveDraft} className="space-y-6">
      {draft.id ? <input type="hidden" name="id" value={draft.id} /> : null}
      <section className="surface space-y-5 p-6">
        <label className="block"><span className="mb-1.5 block text-sm font-medium text-ink-2">Campaign name</span>
          <input name="name" className="field" defaultValue={draft.name} required maxLength={80} placeholder="October order feedback" /></label>
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium text-ink-2">Purpose</legend>
          <div className="flex flex-wrap gap-2">
            {(['service', 'promotional'] as const).map((p) => (
              <label key={p} className="flex cursor-pointer items-center gap-2 rounded-xl border border-line-2 px-3 py-2 text-sm has-[:checked]:border-lamp has-[:checked]:bg-lamp/10">
                <input type="radio" name="purpose" value={p} checked={purpose === p} onChange={() => setPurpose(p)} className="accent-[var(--color-lamp)]" />
                {p === 'service' ? 'Service (feedback, confirmations)' : 'Promotional (offers, sales)'}
              </label>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-ink-3">Feedback calls are service calls. Promotional calls need a promotional caller ID and stricter consent.</p>
        </fieldset>
      </section>

      <section className="surface grid gap-5 p-6 md:grid-cols-3">
        {sel('agent_version_id', 'Agent', options.versions, <>No approved agent. <Link className="text-lamp" href="/console/agents">Approve one</Link>.</>)}
        {sel('phone_number_id', 'Caller ID', numbers.map((n) => ({ id: n.id, label: n.label + (n.verified ? '' : ' (not verified)') })), <>No {purpose} caller ID. <Link className="text-lamp" href="/console/numbers">Add one</Link>.</>)}
        {sel('list_id', 'Contact list', options.lists, <>No lists. <Link className="text-lamp" href="/console/contacts/import">Import one</Link>.</>)}
      </section>

      <section className="surface space-y-5 p-6">
        <h2 className="font-display text-xl">When to call</h2>
        <div className="grid gap-5 sm:grid-cols-2 md:grid-cols-[160px_160px_minmax(0,1fr)]">
          <label className="block"><span className="mb-1.5 block text-sm font-medium text-ink-2">From</span>
            <input type="time" name="window_start" className="field tnum" defaultValue={draft.window_start} required /></label>
          <label className="block"><span className="mb-1.5 block text-sm font-medium text-ink-2">Until</span>
            <input type="time" name="window_end" className="field tnum" defaultValue={draft.window_end} required /></label>
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium text-ink-2">Days</legend>
            <div className="flex flex-wrap gap-1.5">
              {DAYS.map((d, i) => (
                <label key={d} className="cursor-pointer rounded-lg border border-line-2 px-2.5 py-1.5 text-sm text-ink-2 has-[:checked]:border-lamp has-[:checked]:bg-lamp/10 has-[:checked]:text-ink">
                  <input type="checkbox" name="days" value={i} defaultChecked={draft.days.includes(i)} className="sr-only" />{d}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
        <p className="text-sm text-ink-3">In each contact’s own timezone. The legal window is {hours}; the launch check blocks anything outside it.</p>
      </section>

      <section className="surface space-y-5 p-6">
        <h2 className="font-display text-xl">Pace and spend</h2>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-5">
          {num('max_concurrent', 'Calls at once', 1, 200)}
          {num('dials_per_minute', 'New dials per minute', 1, 600)}
          {num('max_attempts', 'Attempts per person', 1, 6, 'Busy or no answer counts as one')}
          {num('retry_after_minutes', 'Retry after (minutes)', 15, 4320)}
          <label className="block"><span className="mb-1.5 block text-sm font-medium text-ink-2">Budget cap ({currency})</span>
            <input name="budget" type="number" step="1" min={1} className="field tnum" defaultValue={draft.budget} required />
            <span className="mt-1 block text-xs text-ink-3">The dialler stops at this amount</span></label>
        </div>
      </section>

      <Submit pending="Saving">{draft.id ? 'Save changes' : 'Save draft and run checks'}</Submit>
    </ActionForm>
  );
}
