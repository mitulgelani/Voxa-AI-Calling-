'use client';

import { updateOrg } from '@/app/console/_actions/org';
import { ActionForm, Submit } from '../forms';

export function OrgForm({ name, timezone, retention }: { name: string; timezone: string; retention: number }) {
  return (
    <ActionForm action={updateOrg} className="surface grid gap-4 p-6 md:grid-cols-3">
      <label className="block"><span className="mb-1.5 block text-sm font-medium text-ink-2">Name</span>
        <input name="name" className="field" defaultValue={name} required maxLength={80} /></label>
      <label className="block"><span className="mb-1.5 block text-sm font-medium text-ink-2">Default timezone</span>
        <input name="timezone" className="field" defaultValue={timezone} required list="tz" />
        <datalist id="tz"><option value="Asia/Kolkata" /><option value="America/New_York" /><option value="America/Chicago" /><option value="America/Denver" /><option value="America/Los_Angeles" /><option value="America/Toronto" /><option value="America/Vancouver" /></datalist>
        <span className="mt-1 block text-xs text-ink-3">Used when a contact has no timezone of their own</span></label>
      <label className="block"><span className="mb-1.5 block text-sm font-medium text-ink-2">Keep recordings for (days)</span>
        <input name="retention" type="number" min={7} max={3650} className="field tnum" defaultValue={retention} required />
        <span className="mt-1 block text-xs text-ink-3">Transcripts and answers are kept; audio is deleted</span></label>
      <div className="md:col-span-3"><Submit pending="Saving">Save settings</Submit></div>
    </ActionForm>
  );
}
