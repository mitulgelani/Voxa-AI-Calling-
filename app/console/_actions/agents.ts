'use server';

import crypto from 'crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { orgContext } from '@/lib/console/context';
import { friendly, type ActionResult } from '@/lib/console/result';
import { AgentVersion } from '@/lib/console/agent-schema';
import { VOICE_IDS } from '@/lib/voice/voices';
import { anonDb } from '@/lib/server/play';
import { serverEnv } from '@/lib/server-env';
import { getLanguage } from '@/lib/voice/languages';

const NewAgent = z.object({ name: z.string().trim().min(1, 'Give the agent a name.').max(60), description: z.string().trim().max(500).default('') });

export async function createAgent(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const parsed = NewAgent.safeParse({ name: fd.get('name'), description: fd.get('description') ?? '' });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { db, org } = await orgContext('operator');
  const { data, error } = await db.from('agents').insert({ org_id: org.id, ...parsed.data }).select('id').single();
  if (error) return { ok: false, error: friendly(error) };
  redirect(`/console/agents/${data.id}?new=1`);
}

/** Saves the editor as a new immutable version. Approval is a separate step. */
export async function saveVersion(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  let raw: unknown;
  try { raw = JSON.parse(String(fd.get('payload') ?? '')); } catch { return { ok: false, error: 'The form could not be read. Reload and try again.' }; }
  const parsed = AgentVersion.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const v = parsed.data;
  if (!VOICE_IDS.has(v.voice)) return { ok: false, error: 'Pick a voice from the list.' };
  const { db } = await orgContext('operator');
  const { data, error } = await db.rpc('create_agent_version', {
    p_agent: v.agent, p_opening: v.opening, p_disclosure: v.disclosure, p_goal: v.goal, p_persona: v.persona,
    p_questions: v.questions, p_languages: v.languages, p_voice: { id: v.voice, rate: v.rate },
  });
  if (error) return { ok: false, error: friendly(error) };
  revalidatePath(`/console/agents/${v.agent}`);
  return { ok: true, id: String(data), message: 'Saved as a new version. An admin can approve it below.' };
}

export async function approveVersion(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const id = z.string().uuid().safeParse(fd.get('version'));
  if (!id.success) return { ok: false, error: 'Unknown version.' };
  const { db } = await orgContext('admin');
  const { error } = await db.rpc('approve_agent_version', { p_version: id.data });
  if (error) return { ok: false, error: friendly(error) };
  revalidatePath('/console/agents', 'layout');
  return { ok: true, message: 'Approved.' };
}

export async function archiveAgent(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const id = z.string().uuid().safeParse(fd.get('agent'));
  if (!id.success) return { ok: false, error: 'Unknown agent.' };
  const { db } = await orgContext('operator');
  const { error } = await db.from('agents').update({ archived_at: new Date().toISOString() }).eq('id', id.data);
  if (error) return { ok: false, error: friendly(error) };
  redirect('/console/agents');
}

/**
 * Hear a version before approving it: publishes it as a private playground persona owned by
 * a key derived from the agent id, so repeated tests update the same link instead of piling up.
 */
export async function testInBrowser(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const id = z.string().uuid().safeParse(fd.get('version'));
  if (!id.success) return { ok: false, error: 'Unknown version.' };
  if (!serverEnv.playToken) return { ok: false, error: 'Browser test calls are not configured on this server.' };
  const { db } = await orgContext('operator');
  const { data: v, error } = await db.from('agent_versions')
    .select('agent_id, version, opening_line, disclosure_line, goal, persona, questions, languages, voice, agents(name)')
    .eq('id', id.data).single();
  if (error || !v) return { ok: false, error: 'Version not found.' };

  const agentName = ((Array.isArray(v.agents) ? v.agents[0] : v.agents) as { name: string } | null)?.name ?? 'Agent';
  const qs = (v.questions as { prompt: string; type: string; options?: string[] }[])
    .map((q, i) => `${i + 1}. ${q.prompt}${q.type === 'rating' ? ' (1 to 5)' : q.type === 'choice' && q.options ? ` (${q.options.join(' / ')})` : ''}`).join('\n');
  const description = [
    v.persona || `You are ${agentName}, a polite caller.`,
    `Purpose of the call: ${v.goal}`,
    `Ask these questions in order, one at a time, and confirm unclear answers:\n${qs}`,
    'If the person asks not to be called again, apologise, confirm they will not be called, and end the call.',
  ].join('\n\n').slice(0, 2000);
  const lang = (v.languages as string[])[0] ?? 'hinglish';
  const voice = (v.voice as { id?: string; rate?: string })?.id ?? getLanguage(lang).voices[0].id;
  const rate = (v.voice as { rate?: string })?.rate ?? '+0%';
  const greeting = `${v.opening_line} ${v.disclosure_line}`.slice(0, 300);

  const ownerKey = crypto.createHmac('sha256', serverEnv.ipHashSecret || serverEnv.playToken).update(`agent-test:${v.agent_id}`).digest('base64url');
  const anon = anonDb();
  const { data: mine } = await anon.rpc('play_my_personas', { p_token: serverEnv.playToken, p_owner_key: ownerKey });
  const existing = (mine as { share_slug: string }[] | null)?.[0]?.share_slug ?? null;
  const { data: slug, error: saveErr } = await anon.rpc('play_save_persona', {
    p_token: serverEnv.playToken, p_owner_key: ownerKey, p_slug: existing,
    p_name: agentName.slice(0, 40), p_tagline: `Test of v${v.version}`, p_description: description, p_greeting: greeting,
    p_language: lang, p_voice: voice, p_rate: rate, p_visibility: 'unlisted', p_accent: 'saffron',
  });
  if (saveErr || !slug) return { ok: false, error: 'Could not prepare the test call. Try again.' };
  redirect(`/p/${slug}`);
}
