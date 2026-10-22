'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { orgContext } from '@/lib/console/context';
import { friendly, type ActionResult } from '@/lib/console/result';
import { randomToken, seal, sha256 } from '@/lib/server/seal';
import { serverEnv } from '@/lib/server-env';

export type SecretResult = ActionResult & { secret?: string };
const ROLES = ['viewer', 'reviewer', 'operator', 'admin'] as const;
const done = () => revalidatePath('/console/settings');

export async function invite(_: SecretResult | null, fd: FormData): Promise<SecretResult> {
  const parsed = z.object({ email: z.string().trim().toLowerCase().email('Enter a valid email address.'), role: z.enum(ROLES) }).safeParse({ email: fd.get('email'), role: fd.get('role') });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { db, org } = await orgContext('admin');
  const token = randomToken(24, 'hex');
  const { error } = await db.from('invites').insert({ org_id: org.id, email: parsed.data.email, role: parsed.data.role, token_hash: sha256(token) });
  if (error) return { ok: false, error: friendly(error) };
  done();
  return { ok: true, message: `Send this link to ${parsed.data.email}. It works once, for that address, for 7 days. We only show it now.`, secret: `${serverEnv.siteUrl}/console/invite/${token}` };
}

export async function withdrawInvite(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const id = z.string().uuid().safeParse(fd.get('id'));
  if (!id.success) return { ok: false, error: 'Unknown invite.' };
  const { db } = await orgContext('admin');
  const { error } = await db.from('invites').delete().eq('id', id.data);
  if (error) return { ok: false, error: friendly(error) };
  done();
  return { ok: true };
}

export async function changeRole(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const parsed = z.object({ user: z.string().uuid(), role: z.enum(ROLES) }).safeParse({ user: fd.get('user'), role: fd.get('role') });
  if (!parsed.success) return { ok: false, error: 'Unknown change.' };
  const { db, org, user } = await orgContext('admin');
  if (parsed.data.user === user.id) return { ok: false, error: 'Ask another admin to change your own role.' };
  const { data, error } = await db.from('memberships').update({ role: parsed.data.role }).eq('org_id', org.id).eq('user_id', parsed.data.user).select('user_id');
  if (error) return { ok: false, error: friendly(error) };
  if (!data?.length) return { ok: false, error: 'The owner’s role cannot be changed here.' };
  done();
  return { ok: true, message: 'Role updated.' };
}

export async function removeMember(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const id = z.string().uuid().safeParse(fd.get('user'));
  if (!id.success) return { ok: false, error: 'Unknown member.' };
  const { db, org, user } = await orgContext('admin');
  if (id.data === user.id) return { ok: false, error: 'You cannot remove yourself.' };
  const { data, error } = await db.from('memberships').delete().eq('org_id', org.id).eq('user_id', id.data).select('user_id');
  if (error) return { ok: false, error: friendly(error) };
  if (!data?.length) return { ok: false, error: 'The owner cannot be removed.' };
  done();
  return { ok: true };
}

export async function createKey(_: SecretResult | null, fd: FormData): Promise<SecretResult> {
  const parsed = z.object({ name: z.string().trim().min(1, 'Name the key after what uses it.').max(60), scopes: z.array(z.enum(['calls:read', 'contacts:write', 'campaigns:read'])).min(1, 'Pick at least one permission.') })
    .safeParse({ name: fd.get('name'), scopes: fd.getAll('scopes') });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { db, org } = await orgContext('admin');
  const key = `vd_live_${randomToken(32)}`;
  const { error } = await db.from('api_keys').insert({ org_id: org.id, name: parsed.data.name, prefix: key.slice(0, 14), key_hash: sha256(key), scopes: parsed.data.scopes });
  if (error) return { ok: false, error: friendly(error) };
  done();
  return { ok: true, message: 'Copy the key now. We store only a hash, so it cannot be shown again.', secret: key };
}

export async function revokeKey(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const id = z.string().uuid().safeParse(fd.get('id'));
  if (!id.success) return { ok: false, error: 'Unknown key.' };
  const { db } = await orgContext('admin');
  const { error } = await db.from('api_keys').update({ revoked_at: new Date().toISOString() }).eq('id', id.data).is('revoked_at', null);
  if (error) return { ok: false, error: friendly(error) };
  done();
  return { ok: true };
}

export async function addWebhook(_: SecretResult | null, fd: FormData): Promise<SecretResult> {
  const parsed = z.object({
    url: z.string().trim().url('Enter a full https:// address.').max(500).refine((u) => {
      try {
        const h = new URL(u);
        return h.protocol === 'https:' && !/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|\[?::1|172\.(1[6-9]|2\d|3[01])\.)/.test(h.hostname) && !h.hostname.endsWith('.internal');
      } catch { return false; }
    }, 'Webhooks must be public https:// addresses.'),
    events: z.array(z.enum(['call.completed', 'answer.reviewed', 'contact.opted_out', 'campaign.finished'])).min(1, 'Pick at least one event.'),
  }).safeParse({ url: fd.get('url'), events: fd.getAll('events') });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  if (!serverEnv.webhookKey) return { ok: false, error: 'Webhooks are not configured on this server yet.' };
  const { db, org } = await orgContext('admin');
  const secret = `whsec_${randomToken(32)}`;
  const { error } = await db.from('webhook_endpoints').insert({ org_id: org.id, url: parsed.data.url, events: parsed.data.events, secret_enc: seal(secret) });
  if (error) return { ok: false, error: friendly(error) };
  done();
  return { ok: true, message: 'Use this secret to verify the VaniDial-Signature header. It is shown once.', secret };
}

export async function toggleWebhook(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const id = z.string().uuid().safeParse(fd.get('id'));
  if (!id.success) return { ok: false, error: 'Unknown webhook.' };
  const { db } = await orgContext('admin');
  const { error } = await db.from('webhook_endpoints').update({ active: fd.get('active') === '1' }).eq('id', id.data);
  if (error) return { ok: false, error: friendly(error) };
  done();
  return { ok: true };
}

export async function removeWebhook(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const id = z.string().uuid().safeParse(fd.get('id'));
  if (!id.success) return { ok: false, error: 'Unknown webhook.' };
  const { db } = await orgContext('admin');
  const { error } = await db.from('webhook_endpoints').delete().eq('id', id.data);
  if (error) return { ok: false, error: friendly(error) };
  done();
  return { ok: true };
}
