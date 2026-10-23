import 'server-only';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_ANON_KEY, SUPABASE_URL, hasSupabase } from '@/lib/env';
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

/** Where playground state lives: Supabase when connected, otherwise a private Vercel Blob store. */
export type Backend = 'db' | 'blob' | 'none';
export function backend(): Backend {
  if (!serverEnv.playToken) return 'none';
  if (hasSupabase) return 'db';
  if (process.env.BLOB_READ_WRITE_TOKEN) return 'blob';
  return 'none';
}

export function requirePlayConfig(): Exclude<Backend, 'none'> {
  const b = backend();
  if (b === 'none') throw new PlayError('The playground is not configured on this server yet.', 503);
  return b;
}

/** A call session: a database UUID, or (blob mode) a signed, self-expiring token. */
export const SESSION_RE = /^(?:[0-9a-f-]{36}|[A-Za-z0-9_-]{20,400}\.[A-Za-z0-9_-]{43})$/;

/* ---------- blob mode: stateless signed sessions with best-effort in-memory limits ---------- */

export const FREE_CALL_SECONDS = 300;
const GRACE_SECONDS = 20;

interface SessionClaims { v: 1; s: string; n: string; t: number; x: number }

const sign = (body: string) => crypto.createHmac('sha256', `session:${serverEnv.playToken}`).update(body).digest('base64url');

function issueSession(slug: string): { token: string; claims: SessionClaims } {
  const now = Math.floor(Date.now() / 1000);
  const claims: SessionClaims = { v: 1, s: slug, n: crypto.randomBytes(9).toString('base64url'), t: now, x: now + FREE_CALL_SECONDS };
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return { token: `${body}.${sign(body)}`, claims };
}

function readSession(token: string): SessionClaims {
  const [body, sig] = token.split('.');
  if (!body || !sig) throw new PlayError('Missing call session.', 400);
  const want = Buffer.from(sign(body));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) throw new PlayError('This call has ended.', 410);
  let claims: SessionClaims;
  try {
    claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    throw new PlayError('This call has ended.', 410);
  }
  if (claims.v !== 1 || Date.now() / 1000 > claims.x + GRACE_SECONDS || ended.has(claims.n)) throw new PlayError('This call has ended.', 410);
  return claims;
}

// Per-instance memory. Serverless instances are short-lived, so these are speed bumps, not walls.
const buckets = new Map<string, { start: number; hits: number }>();
const ended = new Map<string, number>();
const liveByIp = new Map<string, { n: string; x: number }>();

function memoryHit(key: string, limit: number, windowSeconds: number): boolean {
  const now = Date.now();
  if (buckets.size > 5000) for (const [k, v] of buckets) if (now - v.start > 86_400_000) buckets.delete(k);
  const b = buckets.get(key);
  if (!b || now - b.start > windowSeconds * 1000) {
    buckets.set(key, { start: now, hits: 1 });
    return true;
  }
  b.hits += 1;
  return b.hits <= limit;
}

/** Start a call. Returns the session id and how many seconds it may last. */
export async function startSession(slug: string, ip: string, ownerKey: string | null): Promise<{ sessionId: string; allowedSeconds: number }> {
  const b = requirePlayConfig();
  if (b === 'db') {
    const { data, error } = await anonDb().rpc('play_session_start', {
      p_token: serverEnv.playToken, p_slug: slug, p_ip_hash: ip, p_owner_key: ownerKey,
    });
    if (error) throw playError(error.message);
    const row = Array.isArray(data) ? data[0] : data;
    return { sessionId: row.session_id, allowedSeconds: row.allowed_seconds };
  }
  const now = Math.floor(Date.now() / 1000);
  const live = liveByIp.get(ip);
  if (live && live.x > now && !ended.has(live.n)) throw new PlayError('A call is already running from your network. End it first.', 429);
  if (!memoryHit(`day:${ip}`, 12, 86_400)) throw new PlayError('You have used today’s free call minutes.', 429);
  const { token, claims } = issueSession(slug);
  liveByIp.set(ip, { n: claims.n, x: claims.x });
  return { sessionId: token, allowedSeconds: FREE_CALL_SECONDS };
}

export async function endSession(session: string) {
  if (!SESSION_RE.test(session)) return;
  const b = backend();
  if (b === 'db') {
    await anonDb().rpc('play_session_end', { p_token: serverEnv.playToken, p_session: session });
    return;
  }
  if (b === 'blob') {
    try {
      const c = readSession(session);
      ended.set(c.n, c.x);
      const now = Date.now() / 1000;
      if (ended.size > 2000) for (const [n, x] of ended) if (x + GRACE_SECONDS < now) ended.delete(n);
    } catch {
      /* already over */
    }
  }
}

/** Validates the session for one request and returns the persona id and seconds left. */
export async function tick(session: string, kind: 'stt' | 'chat' | 'tts') {
  const b = requirePlayConfig();
  if (!SESSION_RE.test(session)) throw new PlayError('Missing call session.', 400);
  if (b === 'blob') {
    const c = readSession(session);
    if (!memoryHit(`turn:${kind}:${c.n}`, 40, 60)) throw new PlayError('Slow down a little, too many turns in a minute.', 429);
    return { persona_id: c.s, seconds_left: Math.max(0, c.x - Math.floor(Date.now() / 1000)) };
  }
  const { data, error } = await anonDb().rpc('play_session_tick', { p_token: serverEnv.playToken, p_session: session, p_kind: kind });
  if (error) throw playError(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new PlayError('This call has ended.', 410);
  return row as { persona_id: string; seconds_left: number };
}

export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const b = backend();
  if (b === 'blob') return memoryHit(`rl:${key}`, limit, windowSeconds);
  if (b !== 'db') return true;
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
