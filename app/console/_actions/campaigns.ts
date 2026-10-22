'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { orgContext } from '@/lib/console/context';
import { friendly, type ActionResult } from '@/lib/console/result';

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const Draft = z.object({
  name: z.string().trim().min(1, 'Name the campaign.').max(80),
  purpose: z.enum(['service', 'promotional']),
  agent_version_id: z.string().uuid('Pick an approved agent.'),
  phone_number_id: z.string().uuid('Pick a caller ID.'),
  list_id: z.string().uuid('Pick a contact list.'),
  window_start: time, window_end: time,
  days: z.array(z.coerce.number().int().min(0).max(6)).min(1, 'Pick at least one calling day.'),
  max_concurrent: z.coerce.number().int().min(1).max(200),
  dials_per_minute: z.coerce.number().int().min(1).max(600),
  max_attempts: z.coerce.number().int().min(1).max(6),
  retry_after_minutes: z.coerce.number().int().min(15).max(4320),
  budget: z.coerce.number().positive('Set a budget cap.').max(10_000_000),
}).refine((d) => d.window_start < d.window_end, { message: 'The calling window must end after it starts.' });

function read(fd: FormData) {
  return Draft.safeParse({
    name: fd.get('name'), purpose: fd.get('purpose'), agent_version_id: fd.get('agent_version_id'),
    phone_number_id: fd.get('phone_number_id'), list_id: fd.get('list_id'),
    window_start: fd.get('window_start'), window_end: fd.get('window_end'), days: fd.getAll('days'),
    max_concurrent: fd.get('max_concurrent'), dials_per_minute: fd.get('dials_per_minute'),
    max_attempts: fd.get('max_attempts'), retry_after_minutes: fd.get('retry_after_minutes'), budget: fd.get('budget'),
  });
}

export async function saveDraft(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const parsed = read(fd);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { budget, ...rest } = parsed.data;
  const { db, org } = await orgContext('operator');
  const row = { ...rest, budget_cap_minor: Math.round(budget * 100), currency: org.country === 'IN' ? 'INR' : 'USD' };
  const id = String(fd.get('id') ?? '');
  if (id) {
    const { error } = await db.from('campaigns').update(row).eq('id', id).eq('status', 'draft');
    if (error) return { ok: false, error: friendly(error) };
    revalidatePath(`/console/campaigns/${id}`);
    redirect(`/console/campaigns/${id}`);
  }
  const { data, error } = await db.from('campaigns').insert({ org_id: org.id, ...row }).select('id').single();
  if (error) return { ok: false, error: friendly(error) };
  redirect(`/console/campaigns/${data.id}`);
}

export async function launch(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const id = z.string().uuid().safeParse(fd.get('id'));
  if (!id.success) return { ok: false, error: 'Unknown campaign.' };
  const { db } = await orgContext('admin');
  const { error } = await db.rpc('launch_campaign', { p_campaign: id.data });
  if (error) return { ok: false, error: friendly(error) };
  revalidatePath(`/console/campaigns/${id.data}`);
  return { ok: true, message: 'Launched. The dialler picks up calls inside the calling window.' };
}

export async function setStatus(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const id = z.string().uuid().safeParse(fd.get('id'));
  const status = z.enum(['running', 'paused', 'completed', 'cancelled']).safeParse(fd.get('status'));
  if (!id.success || !status.success) return { ok: false, error: 'Unknown change.' };
  const { db } = await orgContext('operator');
  const { error } = await db.rpc('set_campaign_status', { p_campaign: id.data, p_status: status.data });
  if (error) return { ok: false, error: friendly(error) };
  revalidatePath(`/console/campaigns/${id.data}`);
  return { ok: true };
}
