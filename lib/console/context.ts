import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';

export type Role = 'viewer' | 'reviewer' | 'operator' | 'admin' | 'owner';
const RANK: Record<Role, number> = { viewer: 0, reviewer: 1, operator: 2, admin: 3, owner: 4 };
export const atLeast = (role: Role, min: Role) => RANK[role] >= RANK[min];

export type Org = { id: string; name: string; country: 'IN' | 'US' | 'CA'; timezone: string; recording_retention_days: number };
export const ORG_COOKIE = 'vd_org';

/**
 * Everything a console page needs, resolved once per request. RLS is the real boundary;
 * the role here only decides what the UI offers.
 */
export const consoleContext = cache(async () => {
  const db = await supabaseServer();
  const { data: auth } = await db.auth.getUser();
  const user = auth.user;
  if (!user || user.is_anonymous) redirect('/login?next=/console');

  const { data: rows } = await db
    .from('memberships')
    .select('role, organizations(id, name, country, timezone, recording_retention_days)')
    .eq('user_id', user.id)
    .order('created_at');
  const memberships = (rows ?? [])
    .map((r) => ({ role: r.role as Role, org: (Array.isArray(r.organizations) ? r.organizations[0] : r.organizations) as Org | null }))
    .filter((m): m is { role: Role; org: Org } => Boolean(m.org));

  const chosen = (await cookies()).get(ORG_COOKIE)?.value;
  const current = memberships.find((m) => m.org.id === chosen) ?? memberships[0] ?? null;
  return { db, user, memberships, org: current?.org ?? null, role: (current?.role ?? 'viewer') as Role };
});

/** For pages inside an organisation: sends people without one to onboarding. */
export async function orgContext(min: Role = 'viewer') {
  const ctx = await consoleContext();
  if (!ctx.org) redirect('/console/welcome');
  if (!atLeast(ctx.role, min)) redirect('/console?denied=1');
  return { ...ctx, org: ctx.org };
}
