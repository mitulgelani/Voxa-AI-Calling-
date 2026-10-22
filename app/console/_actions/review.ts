'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { orgContext } from '@/lib/console/context';
import { friendly, type ActionResult } from '@/lib/console/result';

const Fix = z.object({ answer: z.string().uuid(), call: z.string().uuid(), type: z.enum(['rating', 'yes_no', 'choice', 'text', 'number', 'date']), value: z.string().max(1000) });

function coerce(type: string, raw: string): { ok: true; value: unknown } | { ok: false; error: string } {
  const s = raw.trim();
  if (!s) return { ok: true, value: null };
  switch (type) {
    case 'rating': { const n = Number(s); return n >= 1 && n <= 5 && Number.isInteger(n) ? { ok: true, value: n } : { ok: false, error: 'A rating is a whole number from 1 to 5.' }; }
    case 'number': { const n = Number(s); return Number.isFinite(n) ? { ok: true, value: n } : { ok: false, error: 'Enter a number.' }; }
    case 'yes_no': return /^(y|yes|true|haan|ha|हाँ)$/i.test(s) ? { ok: true, value: true } : /^(n|no|false|nahi|ना|नहीं)$/i.test(s) ? { ok: true, value: false } : { ok: false, error: 'Answer yes or no.' };
    case 'date': return /^\d{4}-\d{2}-\d{2}$/.test(s) ? { ok: true, value: s } : { ok: false, error: 'Use a date like 2026-10-23.' };
    default: return { ok: true, value: s };
  }
}

export async function correctAnswer(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const parsed = Fix.safeParse({ answer: fd.get('answer'), call: fd.get('call'), type: fd.get('type'), value: fd.get('value') ?? '' });
  if (!parsed.success) return { ok: false, error: 'Unknown answer.' };
  const v = coerce(parsed.data.type, parsed.data.value);
  if (!v.ok) return { ok: false, error: v.error };
  const { db } = await orgContext('reviewer');
  const { error } = await db.from('answers').update({ value: v.value, review_state: 'corrected' }).eq('id', parsed.data.answer);
  if (error) return { ok: false, error: friendly(error) };
  revalidatePath(`/console/calls/${parsed.data.call}`);
  return { ok: true, message: 'Corrected. The original is kept in the record.' };
}

/** Finish this call's review and open the next one in the queue. */
export async function finishAndNext(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const call = z.string().uuid().safeParse(fd.get('call'));
  if (!call.success) return { ok: false, error: 'Unknown call.' };
  const skip = fd.get('skip') === '1';
  const { db, org } = await orgContext('reviewer');
  const { error } = await db.rpc('finish_review', { p_call: call.data, p_skip: skip });
  if (error) return { ok: false, error: friendly(error) };
  const { data: next } = await db.from('review_tasks').select('call_id').eq('org_id', org.id).eq('state', 'open').neq('call_id', call.data).order('created_at').limit(1).maybeSingle();
  revalidatePath('/console', 'layout');
  redirect(next ? `/console/calls/${next.call_id}?review=1` : '/console/review?done=1');
}
