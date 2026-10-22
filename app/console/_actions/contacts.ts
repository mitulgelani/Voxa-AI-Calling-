'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { orgContext } from '@/lib/console/context';
import { friendly, type ActionResult } from '@/lib/console/result';

const E164 = z.string().regex(/^\+[1-9][0-9]{6,14}$/);
const Row = z.object({
  e164: E164,
  name: z.string().max(120).default(''),
  language: z.enum(['hinglish', 'hi-IN', 'gu-IN', 'en-IN', 'en-US']).nullable().default(null),
  consent_source: z.string().trim().max(200).nullable().default(null),
  consent_at: z.string().datetime({ offset: true }).nullable().default(null),
  attrs: z.record(z.string().max(40), z.string().max(200)).default({}),
});
export type ImportRow = z.infer<typeof Row>;

export async function createList(name: string): Promise<ActionResult> {
  const n = z.string().trim().min(1).max(80).safeParse(name);
  if (!n.success) return { ok: false, error: 'Give the list a name (up to 80 characters).' };
  const { db, org } = await orgContext('operator');
  const { data, error } = await db.from('contact_lists').insert({ org_id: org.id, name: n.data, source: 'csv' }).select('id').single();
  if (error) return { ok: false, error: friendly(error) };
  return { ok: true, id: data.id };
}

/** One chunk of an import. The client sends ≤1000 normalised rows per call. */
export async function importChunk(listId: string, rows: unknown, attestation: string): Promise<{ ok: true; inserted: number } | { ok: false; error: string }> {
  if (!z.string().uuid().safeParse(listId).success) return { ok: false, error: 'Unknown list.' };
  const parsed = z.array(Row).max(1000).safeParse(rows);
  if (!parsed.success) return { ok: false, error: 'Some rows were not in the expected shape. Re-check the column mapping.' };
  // Defence in depth: re-validate every number on the server.
  const clean = parsed.data.filter((r) => parsePhoneNumberFromString(r.e164)?.isValid());
  const { db } = await orgContext('operator');
  const { data, error } = await db.rpc('import_contacts', { p_list: listId, p_rows: clean, p_attestation: attestation.slice(0, 300) });
  if (error) return { ok: false, error: friendly(error) };
  return { ok: true, inserted: Number(data) };
}

export async function finishImport(listId: string) {
  revalidatePath('/console/contacts');
  redirect(`/console/contacts/${listId}?imported=1`);
}

export async function recordScrub(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const list = String(fd.get('list') ?? '');
  const provider = String(fd.get('provider') ?? '').trim();
  const raw = String(fd.get('flagged') ?? '');
  const file = fd.get('file');
  let text = raw;
  if (file instanceof File && file.size > 0) {
    if (file.size > 2_000_000) return { ok: false, error: 'The file is larger than 2 MB. Paste the flagged numbers instead.' };
    text += '\n' + (await file.text());
  }
  const flagged = new Set<string>();
  for (const tok of text.split(/[\s,;]+/)) {
    const p = parsePhoneNumberFromString(tok.replace(/[^\d+]/g, ''), 'IN');
    if (p?.isValid()) flagged.add(p.number);
  }
  if (provider.length < 2) return { ok: false, error: 'Name the provider or portal that ran the scrub.' };
  const { db } = await orgContext('operator');
  const { data, error } = await db.rpc('record_dnd_scrub', { p_list: list, p_provider: provider, p_flagged: [...flagged] });
  if (error) return { ok: false, error: friendly(error) };
  revalidatePath(`/console/contacts/${list}`);
  return { ok: true, message: `Scrub recorded. ${data} DND-registered contact${data === 1 ? '' : 's'} removed from the list.` };
}

export async function deleteList(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const id = z.string().uuid().safeParse(fd.get('list'));
  if (!id.success) return { ok: false, error: 'Unknown list.' };
  const { db } = await orgContext('admin');
  const { count } = await db.from('campaigns').select('id', { count: 'exact', head: true }).eq('list_id', id.data).in('status', ['running', 'paused']);
  if (count) return { ok: false, error: 'A running or paused campaign uses this list. Finish or cancel it first.' };
  const { error } = await db.from('contact_lists').delete().eq('id', id.data);
  if (error) return { ok: false, error: friendly(error) };
  redirect('/console/contacts');
}

export async function addDnc(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const { db, org } = await orgContext('reviewer');
  const p = parsePhoneNumberFromString(String(fd.get('phone') ?? ''), org.country);
  if (!p?.isValid()) return { ok: false, error: 'That is not a valid phone number.' };
  const reason = z.enum(['opt_out', 'complaint', 'manual', 'legal']).catch('manual').parse(fd.get('reason'));
  const { error } = await db.rpc('add_to_dnc', { p_org: org.id, p_e164: p.number, p_reason: reason });
  if (error) return { ok: false, error: friendly(error) };
  revalidatePath('/console/contacts/dnc');
  return { ok: true, message: `${p.formatInternational()} will never be called by this organisation.` };
}
