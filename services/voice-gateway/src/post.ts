import { db } from './db.js';
import { log } from './log.js';
import { extract, type Line, type Script } from './brain.js';
import type { Tape } from './audio.js';
import type { CarrierName } from './carriers/index.js';

export interface CallUsage { sttSeconds: number; ttsChars: number; llmTokens: number; turnLatencies: number[]; interruptions: number; providers: Set<string> }

/**
 * Unit prices in minor units (paise or cents). Set them per deployment from your provider
 * contracts; the defaults are placeholders so cost tracking works end to end.
 */
const n = (k: string, d: number) => Number(process.env[k] ?? d);
const PRICE = {
  INR: { telephonyPerMin: n('PRICE_INR_TELEPHONY_PER_MIN', 60), sttPerMin: n('PRICE_INR_STT_PER_MIN', 50), ttsPer1k: n('PRICE_INR_TTS_PER_1K_CHARS', 150), llmPer1k: n('PRICE_INR_LLM_PER_1K_TOKENS', 3) },
  USD: { telephonyPerMin: n('PRICE_USD_TELEPHONY_PER_MIN', 1), sttPerMin: n('PRICE_USD_STT_PER_MIN', 1), ttsPer1k: n('PRICE_USD_TTS_PER_1K_CHARS', 2), llmPer1k: n('PRICE_USD_LLM_PER_1K_TOKENS', 0.05) },
};

export async function finishCall(p: {
  callId: string; orgId: string; campaignId: string | null; script: Script; lines: Line[]; durationMs: number;
  tape: Tape; usage: CallUsage; optOut: boolean; callback: boolean; language: string; carrier: CarrierName;
}) {
  const { data: camp } = p.campaignId ? await db.from('campaigns').select('currency').eq('id', p.campaignId).maybeSingle() : { data: null };
  const currency = (camp?.currency ?? 'INR') as 'INR' | 'USD';
  const price = PRICE[currency];

  // 1. Recording on the call timeline, private bucket, org-scoped path.
  let recordingPath: string | null = null;
  try {
    const path = `${p.orgId}/${p.callId}.wav`;
    const { error } = await db.storage.from('recordings').upload(path, p.tape.toWav(p.durationMs), { contentType: 'audio/wav', upsert: true });
    if (!error) recordingPath = path;
  } catch (e) { log('warn', 'recording upload failed', { call: p.callId, err: String(e) }); }

  // 2. Transcript.
  if (p.lines.length) {
    await db.from('call_turns').insert(p.lines.map((l) => ({
      call_id: p.callId, org_id: p.orgId, seq: l.seq, speaker: l.speaker, text: l.text.slice(0, 4000),
      lang: l.speaker === 'customer' ? p.language : null, start_ms: Math.max(0, Math.round(l.start_ms)), end_ms: Math.max(0, Math.round(l.end_ms)), interrupted: Boolean(l.interrupted),
    })));
  }

  // 3. Answers with evidence spans, taken from the customer turn each one came from.
  const customerSaid = p.lines.filter((l) => l.speaker === 'customer');
  let answers: { key: string; value: unknown; confidence: number; turn: number | null }[] = [];
  if (customerSaid.length && !p.optOut) {
    try {
      const out = await extract(p.script, p.lines);
      answers = out.answers;
      p.usage.llmTokens += out.tokens;
    } catch (e) { log('warn', 'extraction failed', { call: p.callId, err: String(e) }); }
  }
  const byTurn = new Map(p.lines.map((l) => [l.seq, l]));
  if (answers.length) {
    await db.from('answers').insert(answers.map((a) => {
      const q = p.script.questions.find((x) => x.key === a.key)!;
      const t = a.turn !== null ? byTurn.get(a.turn) : undefined;
      const low = a.confidence < 0.8 || (a.value !== null && !t);
      return {
        call_id: p.callId, org_id: p.orgId, question_key: a.key, type: q.type, value: a.value, confidence: a.confidence,
        evidence_start_ms: t?.start_ms ?? null, evidence_end_ms: t?.end_ms ?? null, review_state: low ? 'needs_review' : 'auto',
      };
    }));
  }

  // 4. Outcome, and whether a person should look at it.
  const required = p.script.questions.filter((q) => q.required).map((q) => q.key);
  const got = new Set(answers.filter((a) => a.value !== null).map((a) => a.key));
  const allRequired = required.every((k) => got.has(k));
  const outcome = p.optOut ? 'opted_out' : p.callback ? 'callback' : allRequired && got.size ? 'completed' : got.size ? 'partial' : customerSaid.length <= 1 ? 'hung_up_early' : 'partial';
  const unsure = answers.filter((a) => a.confidence < 0.8);
  const reasons = [
    ...unsure.map((a) => `low confidence on “${a.key}” (${Math.round(a.confidence * 100)}%)`),
    ...(outcome === 'completed' ? [] : outcome === 'partial' ? ['some required questions were not answered'] : []),
  ];
  const needsReview = reasons.length > 0 && outcome !== 'opted_out' && outcome !== 'hung_up_early';

  // 5. Cost.
  const minutes = Math.ceil(p.durationMs / 60000);
  const lines = [
    { kind: 'telephony', quantity: minutes, unit: 'minutes', cost: minutes * price.telephonyPerMin, provider: p.carrier },
    { kind: 'stt', quantity: Math.round(p.usage.sttSeconds), unit: 'seconds', cost: Math.round((p.usage.sttSeconds / 60) * price.sttPerMin), provider: [...p.usage.providers].filter((x) => x.startsWith('stt:')).map((x) => x.slice(4)).join('+') || 'sarvam' },
    { kind: 'tts', quantity: p.usage.ttsChars, unit: 'characters', cost: Math.round((p.usage.ttsChars / 1000) * price.ttsPer1k), provider: [...p.usage.providers].filter((x) => x.startsWith('tts:')).map((x) => x.slice(4)).join('+') || 'sarvam' },
    { kind: 'llm', quantity: p.usage.llmTokens, unit: 'tokens', cost: Math.round((p.usage.llmTokens / 1000) * price.llmPer1k), provider: 'openrouter' },
  ].filter((l) => l.quantity > 0);
  const cost = lines.reduce((s, l) => s + l.cost, 0);
  if (lines.length) await db.from('usage_events').insert(lines.map((l) => ({ org_id: p.orgId, call_id: p.callId, kind: l.kind, quantity: l.quantity, unit: l.unit, cost_minor: l.cost, provider: l.provider })));
  if (p.campaignId) await db.rpc('add_campaign_spend', { p_campaign: p.campaignId, p_minor: cost });

  const lat = [...p.usage.turnLatencies].sort((a, b) => a - b);
  await db.from('calls').update({
    status: 'completed', outcome, ended_at: new Date().toISOString(), duration_ms: Math.round(p.durationMs), recording_path: recordingPath,
    language_detected: p.language, cost_minor: cost, needs_review: needsReview,
    metrics: { p50_turn_ms: lat.length ? lat[Math.floor(lat.length / 2)] : null, p90_turn_ms: lat.length ? lat[Math.floor(lat.length * 0.9)] : null, interruptions: p.usage.interruptions, turns: p.lines.length },
  }).eq('id', p.callId);
  if (needsReview) await db.from('review_tasks').insert({ org_id: p.orgId, call_id: p.callId, reason: reasons.slice(0, 3).join('; ') });

  // 6. Tell the customer's systems.
  const payload = { call_id: p.callId, campaign_id: p.campaignId, outcome, duration_ms: Math.round(p.durationMs), language: p.language, needs_review: needsReview,
    answers: Object.fromEntries(answers.map((a) => [a.key, { value: a.value, confidence: a.confidence, evidence_ms: a.turn !== null ? byTurn.get(a.turn)?.start_ms ?? null : null }])) };
  await db.rpc('enqueue_webhook', { p_org: p.orgId, p_event: 'call.completed', p_payload: payload });
  if (p.optOut) await db.rpc('enqueue_webhook', { p_org: p.orgId, p_event: 'contact.opted_out', p_payload: { call_id: p.callId, campaign_id: p.campaignId } });
  log('info', 'call finished', { call: p.callId, outcome, ms: Math.round(p.durationMs), review: needsReview, cost });
}

/** A call that never connected (busy, no answer, voicemail): record it and maybe schedule a retry. */
export async function finishUnanswered(callId: string, outcome: 'no_answer' | 'busy' | 'failed' | 'voicemail') {
  const { data: call } = await db.from('calls').select('id, org_id, campaign_id, contact_id, job_id, status').eq('id', callId).maybeSingle();
  if (!call || call.status === 'completed' || call.status === 'failed') return;
  await db.from('calls').update({ status: outcome === 'failed' ? 'failed' : 'completed', outcome, ended_at: new Date().toISOString(), duration_ms: 0 }).eq('id', callId);
  if (outcome === 'failed' || !call.campaign_id || !call.job_id) return;
  const [{ data: job }, { data: camp }] = await Promise.all([
    db.from('call_jobs').select('attempt').eq('id', call.job_id).maybeSingle(),
    db.from('campaigns').select('max_attempts, retry_after_minutes, status').eq('id', call.campaign_id).maybeSingle(),
  ]);
  if (job && camp && camp.status === 'running' && job.attempt < camp.max_attempts) {
    await db.from('call_jobs').insert({
      org_id: call.org_id, campaign_id: call.campaign_id, contact_id: call.contact_id, attempt: job.attempt + 1,
      due_at: new Date(Date.now() + camp.retry_after_minutes * 60000).toISOString(),
    });
  }
}
