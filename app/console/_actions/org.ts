'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { consoleContext, orgContext, ORG_COOKIE } from '@/lib/console/context';
import { friendly, type ActionResult } from '@/lib/console/result';

const COOKIE = { httpOnly: true, sameSite: 'lax' as const, secure: true, path: '/', maxAge: 60 * 60 * 24 * 365 };

export async function switchOrg(fd: FormData) {
  const id = String(fd.get('org') ?? '');
  const { memberships } = await consoleContext();
  if (memberships.some((m) => m.org.id === id)) (await cookies()).set(ORG_COOKIE, id, COOKIE);
  redirect('/console');
}

const CreateOrg = z.object({ name: z.string().trim().min(2, 'Use at least 2 characters.').max(80), country: z.enum(['IN', 'US', 'CA']) });

export async function createOrg(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const parsed = CreateOrg.safeParse({ name: fd.get('name'), country: fd.get('country') });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { db } = await consoleContext();
  const { data, error } = await db.rpc('create_organization', { p_name: parsed.data.name, p_country: parsed.data.country });
  if (error) return { ok: false, error: friendly(error) };
  (await cookies()).set(ORG_COOKIE, String(data), COOKIE);
  redirect('/console?welcome=1');
}

const OrgSettings = z.object({ name: z.string().trim().min(2).max(80), retention: z.coerce.number().int().min(7).max(3650), timezone: z.string().min(3).max(60) });

export async function updateOrg(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const parsed = OrgSettings.safeParse({ name: fd.get('name'), retention: fd.get('retention'), timezone: fd.get('timezone') });
  if (!parsed.success) return { ok: false, error: 'Check the name, timezone and retention period (7 to 3650 days).' };
  try { new Intl.DateTimeFormat('en', { timeZone: parsed.data.timezone }); } catch { return { ok: false, error: 'That timezone is not recognised.' }; }
  const { db, org } = await orgContext('admin');
  const { error } = await db.from('organizations').update({ name: parsed.data.name, recording_retention_days: parsed.data.retention, timezone: parsed.data.timezone }).eq('id', org.id);
  if (error) return { ok: false, error: friendly(error) };
  revalidatePath('/console', 'layout');
  return { ok: true, message: 'Saved.' };
}

export async function acceptInvite(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const token = String(fd.get('token') ?? '');
  if (!/^[a-f0-9]{48}$/.test(token)) return { ok: false, error: 'This invite link is not valid.' };
  const { db } = await consoleContext();
  const { data, error } = await db.rpc('accept_invite', { p_token: token });
  if (error) return { ok: false, error: friendly(error) };
  (await cookies()).set(ORG_COOKIE, String(data), COOKIE);
  redirect('/console');
}
