'use client';

import { addDnc } from '@/app/console/_actions/contacts';
import { ActionForm, Submit } from '../forms';

export function DncForm() {
  return (
    <ActionForm action={addDnc} resetOnSuccess className="surface flex flex-wrap items-end gap-3 p-5">
      <label className="block min-w-56 flex-1"><span className="mb-1.5 block text-sm font-medium text-ink-2">Phone number</span>
        <input name="phone" className="field tnum" required inputMode="tel" placeholder="+91 98765 43210" /></label>
      <label className="block"><span className="mb-1.5 block text-sm font-medium text-ink-2">Reason</span>
        <select name="reason" className="field" defaultValue="manual">
          <option value="manual">Asked us directly</option><option value="complaint">Complaint</option><option value="legal">Legal request</option>
        </select></label>
      <Submit pending="Adding">Block number</Submit>
    </ActionForm>
  );
}
