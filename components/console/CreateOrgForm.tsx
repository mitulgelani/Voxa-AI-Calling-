'use client';

import { createOrg } from '@/app/console/_actions/org';
import { ActionForm, Submit } from './forms';
import { Field } from './ui';

export function CreateOrgForm() {
  return (
    <ActionForm action={createOrg} className="space-y-5">
      <Field label="Organisation name" htmlFor="org-name" hint="Your company or brand. Customers never see this.">
        <input id="org-name" name="name" className="field" required minLength={2} maxLength={80} placeholder="Glowleaf Naturals" />
      </Field>
      <fieldset>
        <legend className="mb-1.5 text-sm font-medium text-ink-2">Where are most of the people you call?</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {[['IN', 'India', 'Plivo, TRAI rules'], ['US', 'United States', 'Telnyx, TCPA rules'], ['CA', 'Canada', 'Telnyx, CRTC rules']].map(([v, l, n], i) => (
            <label key={v} className="flex cursor-pointer flex-col rounded-xl border border-line-2 px-3 py-2.5 has-[:checked]:border-lamp has-[:checked]:bg-lamp/10">
              <span className="flex items-center gap-2"><input type="radio" name="country" value={v} defaultChecked={i === 0} className="accent-[var(--color-lamp)]" /> {l}</span>
              <span className="mt-0.5 pl-5 text-xs text-ink-3">{n}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <Submit pending="Creating">Create organisation</Submit>
    </ActionForm>
  );
}
