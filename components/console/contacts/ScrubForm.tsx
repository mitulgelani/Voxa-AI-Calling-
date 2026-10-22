'use client';

import { recordScrub } from '@/app/console/_actions/contacts';
import { ActionForm, Submit } from '../forms';

export function ScrubForm({ listId }: { listId: string }) {
  return (
    <ActionForm action={recordScrub} resetOnSuccess className="surface p-6">
      <input type="hidden" name="list" value={listId} />
      <p className="max-w-2xl text-sm text-ink-2">
        Scrub the list against the NCPR (DND) registry through your DLT portal or telecom provider, then give us the numbers it flagged.
        We remove them from this list and stamp the scrub time. Launch stays blocked until a scrub is less than 24 hours old.
      </p>
      <div className="mt-5 grid gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
        <label className="block"><span className="mb-1.5 block text-sm font-medium text-ink-2">Provider or portal</span>
          <input name="provider" className="field" required minLength={2} maxLength={80} placeholder="Jio DLT portal" /></label>
        <label className="block"><span className="mb-1.5 block text-sm font-medium text-ink-2">Flagged numbers</span>
          <textarea name="flagged" className="field tnum min-h-20" placeholder="Paste numbers, one per line. Leave empty if none were flagged." /></label>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-4">
        <label className="text-sm text-ink-2">Or upload the provider’s file <input name="file" type="file" accept=".csv,.txt" className="ml-2 text-sm file:mr-3 file:rounded-full file:border file:border-line-2 file:bg-transparent file:px-3 file:py-1 file:text-ink" /></label>
        <span className="ml-auto"><Submit pending="Recording">Record scrub</Submit></span>
      </div>
    </ActionForm>
  );
}
