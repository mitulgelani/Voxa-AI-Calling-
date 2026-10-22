'use client';

import { useState } from 'react';
import { addNumber } from '@/app/console/_actions/numbers';
import { ActionForm, Submit } from '../forms';

export function AddNumberForm({ country }: { country: string }) {
  const [phone, setPhone] = useState('');
  const india = country === 'IN' ? !phone.trim().startsWith('+') || phone.trim().startsWith('+91') : phone.trim().startsWith('+91');
  return (
    <ActionForm action={addNumber} resetOnSuccess className="surface grid gap-4 p-6 md:grid-cols-2">
      <label className="block"><span className="mb-1.5 block text-sm font-medium text-ink-2">Number</span>
        <input name="phone" className="field tnum" required inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={country === 'IN' ? '+91 80 4567 8900' : '+1 415 555 0134'} /></label>
      <label className="block"><span className="mb-1.5 block text-sm font-medium text-ink-2">Label <span className="font-normal text-ink-3">(optional)</span></span>
        <input name="label" className="field" maxLength={60} placeholder="Support line, Mumbai" /></label>
      <fieldset>
        <legend className="mb-1.5 text-sm font-medium text-ink-2">Registered for</legend>
        <div className="flex gap-2">
          {[['service', 'Service calls'], ['promotional', 'Promotional calls']].map(([v, l], i) => (
            <label key={v} className="flex cursor-pointer items-center gap-2 rounded-xl border border-line-2 px-3 py-2 text-sm has-[:checked]:border-lamp has-[:checked]:bg-lamp/10">
              <input type="radio" name="purpose" value={v} defaultChecked={i === 0} className="accent-[var(--color-lamp)]" />{l}
            </label>
          ))}
        </div>
      </fieldset>
      {india ? (
        <label className="block"><span className="mb-1.5 block text-sm font-medium text-ink-2">DLT header</span>
          <input name="dlt" className="field uppercase" maxLength={20} placeholder="GLWLEF" /></label>
      ) : <div />}
      <div className="md:col-span-2"><Submit pending="Adding">Add caller ID</Submit></div>
    </ActionForm>
  );
}
