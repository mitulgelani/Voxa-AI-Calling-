import { supabaseServer } from '@/lib/supabase/server';
import { maskPhone } from '@/lib/console/format';

export const dynamic = 'force-dynamic';

/** Neutralise spreadsheet formulas (CSV injection) and quote every cell. */
function cell(v: unknown): string {
  let s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}
const ts = (ms: number | null) => (ms === null || ms === undefined ? '' : `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`);

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response('Not found', { status: 404 });
  const db = await supabaseServer();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) return new Response('Sign in first', { status: 401 });

  // RLS limits every read below to organisations this user belongs to.
  const { data: c } = await db.from('campaigns').select('id, org_id, name, agent_version_id').eq('id', id).maybeSingle();
  if (!c) return new Response('Not found', { status: 404 });
  const { data: me } = await db.from('memberships').select('role').eq('org_id', c.org_id).eq('user_id', auth.user.id).maybeSingle();
  const full = me && ['operator', 'admin', 'owner'].includes(me.role);
  const { data: v } = await db.from('agent_versions').select('questions').eq('id', c.agent_version_id).maybeSingle();
  const keys = ((v?.questions ?? []) as { key: string }[]).map((q) => q.key);

  const { data: calls } = await db.from('calls')
    .select('id, to_e164, outcome, duration_ms, started_at, language_detected, answers(question_key, value, confidence, evidence_start_ms, review_state)')
    .eq('campaign_id', id).order('created_at').limit(100000);

  const header = ['call_id', 'phone', 'outcome', 'duration_s', 'started_at', 'language', ...keys.flatMap((k) => [k, `${k}_at`, `${k}_confidence`, `${k}_review`])];
  const lines = [header.map(cell).join(',')];
  for (const call of calls ?? []) {
    const byKey = new Map(((call.answers ?? []) as { question_key: string; value: unknown; confidence: number; evidence_start_ms: number | null; review_state: string }[]).map((a) => [a.question_key, a]));
    lines.push([
      call.id, full ? call.to_e164 : maskPhone(call.to_e164), call.outcome ?? '', call.duration_ms ? Math.round(call.duration_ms / 1000) : '', call.started_at ?? '', call.language_detected ?? '',
      ...keys.flatMap((k) => { const a = byKey.get(k); return a ? [a.value, ts(a.evidence_start_ms), a.confidence, a.review_state] : ['', '', '', '']; }),
    ].map(cell).join(','));
  }
  const name = c.name.replace(/[^A-Za-z0-9 _-]/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'campaign';
  return new Response('﻿' + lines.join('\r\n'), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${name}-answers.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
