import 'server-only';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '@/lib/env';
import { serverEnv } from '@/lib/server-env';

/** Anonymous database client for token-gated playground functions. No user session. */
export function anonDb() {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Caller IP, hashed with a server secret so raw IPs never reach the database. */
export function ipHash(req: Request): string {
  const fwd = req.headers.get('x-vercel-forwarded-for') || req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || '0.0.0.0';
  const ip = fwd.split(',')[0].trim();
  // Group IPv6 by /64 so one device cannot rotate addresses to dodge limits.
  const key = ip.includes(':') ? ip.split(':').slice(0, 4).join(':') : ip;
  return crypto.createHmac('sha256', serverEnv.ipHashSecret || 'dev').update(key).digest('hex').slice(0, 40);
}

export class PlayError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

const FRIENDLY: [RegExp, string, number][] = [
  [/forbidden/, 'The playground is not configured on this server.', 503],
  [/persona not found/, 'This persona does not exist or is private.', 404],
  [/already running/, 'A call is already running from your network. End it first.', 429],
  [/today's limit|today''s limit/, 'The playground has reached today’s limit. Try again tomorrow.', 429],
  [/persona has used/, 'This persona has used all of today’s call minutes.', 429],
  [/free call minutes/, 'You have used today’s free call minutes.', 429],
  [/call has ended|time is up/, 'This call has ended.', 410],
  [/too many turns/, 'Slow down a little, too many turns in a minute.', 429],
];

export function playError(message: string): PlayError {
  for (const [re, text, status] of FRIENDLY) if (re.test(message)) return new PlayError(text, status);
  return new PlayError('Something went wrong starting the call.', 500);
}

export function requirePlayConfig() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !serverEnv.playToken) {
    throw new PlayError('The playground is not configured on this server yet.', 503);
  }
}

/** Validates the session for one request and returns the persona id and seconds left. */
export async function tick(session: string, kind: 'stt' | 'chat' | 'tts') {
  requirePlayConfig();
  if (!/^[0-9a-f-]{36}$/.test(session)) throw new PlayError('Missing call session.', 400);
  const { data, error } = await anonDb().rpc('play_session_tick', { p_token: serverEnv.playToken, p_session: session, p_kind: kind });
  if (error) throw playError(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new PlayError('This call has ended.', 410);
  return row as { persona_id: string; seconds_left: number };
}

export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  if (!serverEnv.playToken || !SUPABASE_URL) return true;
  const { data, error } = await anonDb().rpc('rate_limit_hit', {
    p_token: serverEnv.playToken, p_key: key, p_limit: limit, p_window_seconds: windowSeconds,
  });
  if (error) return true; // fail open on limiter outages; quotas still apply
  return Boolean(data);
}

export function jsonError(e: unknown) {
  const err = e instanceof PlayError ? e : new PlayError('Something went wrong.', 500);
  if (!(e instanceof PlayError)) console.error('[play]', e);
  return Response.json({ error: err.message }, { status: err.status });
}
