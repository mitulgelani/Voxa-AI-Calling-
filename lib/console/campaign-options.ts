import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

export type CampaignOptions = Awaited<ReturnType<typeof campaignOptions>>;

/** Choices for the campaign form: approved agent versions, caller IDs, contact lists. */
export async function campaignOptions(db: SupabaseClient, orgId: string) {
  const [versions, numbers, lists] = await Promise.all([
    db.from('agent_versions').select('id, version, agents!agent_versions_agent_id_fkey(name, archived_at)').eq('org_id', orgId).not('approved_at', 'is', null).order('created_at', { ascending: false }),
    db.from('phone_numbers').select('id, e164, label, purpose, verified_at').eq('org_id', orgId),
    db.from('contact_lists').select('id, name').eq('org_id', orgId).order('created_at', { ascending: false }),
  ]);
  return {
    versions: (versions.data ?? [])
      .map((v) => ({ id: v.id as string, version: v.version as number, agent: (Array.isArray(v.agents) ? v.agents[0] : v.agents) as { name: string; archived_at: string | null } | null }))
      .filter((v) => v.agent && !v.agent.archived_at)
      .map((v) => ({ id: v.id, label: `${v.agent!.name}, v${v.version}` })),
    numbers: (numbers.data ?? []).map((n) => ({ id: n.id as string, label: `${n.e164}${n.label ? ` (${n.label})` : ''}`, purpose: n.purpose as string, verified: Boolean(n.verified_at) })),
    lists: (lists.data ?? []).map((l) => ({ id: l.id as string, label: l.name as string })),
  };
}
