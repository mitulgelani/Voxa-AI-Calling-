'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { orgContext } from '@/lib/console/context';
import { friendly, type ActionResult } from '@/lib/console/result';

const Form = z.object({
  phone: z.string().min(6),
  label: z.string().trim().max(60).default(''),
  purpose: z.enum(['service', 'promotional']),
  dlt: z.string().trim().max(20).optional(),
});

export async function addNumber(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const parsed = Form.safeParse({ phone: fd.get('phone'), label: fd.get('label') ?? '', purpose: fd.get('purpose'), dlt: fd.get('dlt') || undefined });
  if (!parsed.success) return { ok: false, error: 'Fill in the number and choose what it is registered for.' };
  const { db, org } = await orgContext('admin');
  const p = parsePhoneNumberFromString(parsed.data.phone, org.country);
  if (!p?.isValid()) return { ok: false, error: 'That is not a valid phone number.' };
  const country = p.country;
  if (country !== 'IN' && country !== 'US' && country !== 'CA') return { ok: false, error: 'VaniDial connects Indian numbers through Plivo and US or Canadian numbers through Telnyx.' };
  if (country === 'IN' && !parsed.data.dlt) return { ok: false, error: 'Indian caller IDs need the DLT header (sender ID) they are registered under.' };
  if (parsed.data.dlt && !/^[A-Za-z0-9-]{3,20}$/.test(parsed.data.dlt)) return { ok: false, error: 'DLT headers are 3 to 20 letters or digits.' };
  const { error } = await db.from('phone_numbers').insert({
    org_id: org.id, e164: p.number, label: parsed.data.label, country, carrier: country === 'IN' ? 'plivo' : 'telnyx',
    purpose: parsed.data.purpose, dlt_header: country === 'IN' ? parsed.data.dlt : null,
  });
  if (error) return { ok: false, error: friendly(error) };
  revalidatePath('/console/numbers');
  return { ok: true, message: `${p.formatInternational()} added. It is verified when the voice gateway finds it in your ${country === 'IN' ? 'Plivo' : 'Telnyx'} account.` };
}

export async function removeNumber(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const id = z.string().uuid().safeParse(fd.get('id'));
  if (!id.success) return { ok: false, error: 'Unknown number.' };
  const { db } = await orgContext('admin');
  const { count } = await db.from('campaigns').select('id', { count: 'exact', head: true }).eq('phone_number_id', id.data).in('status', ['running', 'paused']);
  if (count) return { ok: false, error: 'A running or paused campaign uses this caller ID.' };
  const { error } = await db.from('phone_numbers').delete().eq('id', id.data);
  if (error) return { ok: false, error: friendly(error, 'Campaigns that already used this number keep a reference to it, so it cannot be removed.') };
  revalidatePath('/console/numbers');
  return { ok: true };
}
