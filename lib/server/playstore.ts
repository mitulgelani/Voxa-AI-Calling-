import 'server-only';
import crypto from 'crypto';
import { del, get, put } from '@vercel/blob';
import { serverEnv } from '@/lib/server-env';
import { anonDb, backend, PlayError, playError, requirePlayConfig as requireBackend } from './play';

/**
 * Playground persona storage.
 *
 * Two backends:
 *  - "db":   Supabase, through the token-gated playground RPCs (the long-term home).
 *  - "blob": a private Vercel Blob store. Temporary, used while no database is connected.
 *
 * The blob store is private: nothing in it has a public URL, and only this server (which holds
 * BLOB_READ_WRITE_TOKEN) can read or write it. Owner keys are never stored, only their HMAC.
 */

export interface PersonaInput {
  slug?: string;
  name: string;
  tagline: string;
  description: string;
  greeting: string;
  language: string;
  voice: string;
  rate: string;
  visibility: 'unlisted' | 'private';
  accent: string;
}

export interface StoredPersona extends Omit<PersonaInput, 'slug' | 'visibility'> {
  share_slug: string;
  visibility: 'public' | 'unlisted' | 'private';
  call_count: number;
  updated_at: string;
  owner?: string; // HMAC of the owner key; never sent to the browser
}

export interface PublicPersona {
  id: string;
  name: string;
  tagline: string;
  description: string;
  greeting: string;
  language: string;
  voice: string;
  rate: string;
  accent: string;
  call_count: number;
  is_owner: boolean;
}

export interface ShowcasePersona {
  name: string;
  tagline: string;
  language: string;
  accent: string;
  share_slug: string;
  call_count: number;
}

const SLUG_RE = /^[a-f0-9]{14}$/;
const MAX_PER_OWNER = 25;

/* ------------------------------------------------------------------ built-in callers */

const BUILT_IN: StoredPersona[] = [
  {
    share_slug: 'a0000000000001', name: 'Aria', tagline: 'English check-in after a product trial', language: 'en-US', voice: 'en-US-AriaNeural',
    description:
      'You are Aria, calling from Brightdesk, a fictional project-management app, to check in with someone a week into their free trial. You are warm, upbeat and genuinely curious, and you sound like a real person, not a script. Ask what they use it for, what was confusing at first, which feature they would miss most, and how likely they are to recommend it from 0 to 10. Keep it relaxed, thank them, and wrap up within three minutes.',
    greeting: '', rate: '+0%', visibility: 'public', accent: 'rose', call_count: 0, updated_at: '2026-10-23T00:00:00Z',
  },
  {
    share_slug: 'a0000000000002', name: 'Asha', tagline: 'Hinglish feedback call for a skincare brand', language: 'hinglish', voice: 'hi-IN-SwaraNeural',
    description:
      'You are Asha, calling on behalf of Glowleaf, a fictional skincare brand, to ask a recent customer how their order went. You are warm, quick and a little playful, like a friendly young professional from Mumbai. Ask about: delivery experience, how the product feels after a week, a rating from 1 to 5, and one thing they would change. Keep it light, thank them, and wrap up within three minutes.',
    greeting: '', rate: '+0%', visibility: 'public', accent: 'saffron', call_count: 0, updated_at: '2026-10-23T00:00:00Z',
  },
  {
    share_slug: 'a0000000000003', name: 'Kiran', tagline: 'Gujarati follow-up after a clinic visit', language: 'gu-IN', voice: 'gu-IN-DhwaniNeural',
    description:
      "You are Kiran, calling from Shanti Clinic, a fictional clinic in Ahmedabad, to follow up on a patient's visit last week. You are calm, respectful and patient with older callers. Ask how they are feeling, whether the doctor explained things clearly, whether waiting time was okay, and a rating from 1 to 5. Never give medical advice; if they have a health concern, suggest they call the clinic.",
    greeting: '', rate: '+0%', visibility: 'public', accent: 'teal', call_count: 0, updated_at: '2026-10-23T00:00:00Z',
  },
  {
    share_slug: 'a0000000000004', name: 'Rohan', tagline: 'Hindi delivery feedback for a grocery app', language: 'hi-IN', voice: 'hi-IN-MadhurNeural',
    description:
      "You are Rohan, calling from TazaKart, a fictional grocery delivery app, to ask about yesterday's delivery. You speak simple, polite Hindi and keep things brisk. Ask whether everything arrived, whether anything was damaged or missing, how the delivery partner behaved, and a rating from 1 to 5.",
    greeting: '', rate: '+0%', visibility: 'public', accent: 'sky', call_count: 0, updated_at: '2026-10-23T00:00:00Z',
  },
];

/* ------------------------------------------------------------------ blob helpers */

const mac = (s: string) => crypto.createHmac('sha256', serverEnv.playToken || 'dev').update(s).digest('hex');
const ownerId = (key: string) => mac(`owner:${key}`).slice(0, 40);
const personaPath = (slug: string) => `play/personas/${slug}.json`;
const ownerPath = (owner: string) => `play/owners/${owner}.json`;

// Per-instance read cache: keeps Blob operations (and latency) down during a call.
const cache = new Map<string, { at: number; value: unknown }>();
const CACHE_MS = 60_000;

async function readJson<T>(path: string, fresh = false): Promise<T | null> {
  const hit = cache.get(path);
  if (!fresh && hit && Date.now() - hit.at < CACHE_MS) return hit.value as T | null;
  const res = await get(path, { access: 'private', useCache: false }).catch((e: unknown) => {
    if (e instanceof Error && /not.?found/i.test(e.name + e.message)) return null;
    throw e;
  });
  const value = res && res.statusCode === 200 ? ((await new Response(res.stream).json()) as T) : null;
  cache.set(path, { at: Date.now(), value });
  return value;
}

async function writeJson(path: string, value: unknown) {
  await put(path, JSON.stringify(value), {
    access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json', cacheControlMaxAge: 60,
  });
  cache.set(path, { at: Date.now(), value });
}

async function removeBlob(path: string) {
  await del(path).catch(() => undefined);
  cache.delete(path);
}

const toPublic = (p: StoredPersona, isOwner: boolean): PublicPersona => ({
  id: p.share_slug, name: p.name, tagline: p.tagline, description: p.description, greeting: p.greeting,
  language: p.language, voice: p.voice, rate: p.rate, accent: p.accent, call_count: p.call_count, is_owner: isOwner,
});

const strip = ({ owner: _o, ...rest }: StoredPersona) => rest;

/* ------------------------------------------------------------------ public API */

/** A persona for its share page or a call. Private personas are visible only to their owner. */
export async function personaBySlug(slug: string, ownerKey: string | null): Promise<PublicPersona | null> {
  if (!SLUG_RE.test(slug)) return null;
  const b = backend();
  if (b === 'db') {
    const { data } = await anonDb().rpc('persona_by_slug', { p_slug: slug, p_owner_key: ownerKey });
    const row = Array.isArray(data) ? data[0] : data;
    return (row as PublicPersona) ?? null;
  }
  const builtIn = BUILT_IN.find((p) => p.share_slug === slug);
  if (builtIn) return toPublic(builtIn, false);
  if (b !== 'blob') return null;
  const p = await readJson<StoredPersona>(personaPath(slug));
  if (!p) return null;
  const isOwner = Boolean(ownerKey && p.owner === ownerId(ownerKey));
  if (p.visibility === 'private' && !isOwner) return null;
  return toPublic(p, isOwner);
}

/** The persona behind a running call (privacy was checked when the call started). */
export async function personaForCall(slug: string): Promise<{ name: string; description: string; language: string } | null> {
  const builtIn = BUILT_IN.find((p) => p.share_slug === slug);
  if (builtIn) return builtIn;
  if (backend() !== 'blob' || !SLUG_RE.test(slug)) return null;
  return readJson<StoredPersona>(personaPath(slug));
}

export async function showcase(limit = 8): Promise<ShowcasePersona[]> {
  const b = backend();
  if (b === 'db') {
    const { data } = await anonDb().rpc('public_personas', { p_limit: limit });
    return (data as ShowcasePersona[]) ?? [];
  }
  return BUILT_IN.slice(0, limit).map(({ name, tagline, language, accent, share_slug, call_count }) => ({ name, tagline, language, accent, share_slug, call_count }));
}

export async function myPersonas(ownerKey: string) {
  const b = requireBackend();
  if (b === 'db') {
    const { data, error } = await anonDb().rpc('play_my_personas', { p_token: serverEnv.playToken, p_owner_key: ownerKey });
    if (error) throw playError(error.message);
    return data ?? [];
  }
  const list = (await readJson<StoredPersona[]>(ownerPath(ownerId(ownerKey)), true)) ?? [];
  return list.map(strip);
}

export async function savePersona(ownerKey: string, p: PersonaInput): Promise<string> {
  const b = requireBackend();
  if (b === 'db') {
    const { data, error } = await anonDb().rpc('play_save_persona', {
      p_token: serverEnv.playToken, p_owner_key: ownerKey, p_slug: p.slug ?? null,
      p_name: p.name, p_tagline: p.tagline, p_description: p.description, p_greeting: p.greeting,
      p_language: p.language, p_voice: p.voice, p_rate: p.rate, p_visibility: p.visibility, p_accent: p.accent,
    });
    if (error) {
      if (/25 personas/.test(error.message)) throw new PlayError('You can keep up to 25 personas. Delete one first.', 400);
      throw playError(error.message);
    }
    return String(data);
  }

  const owner = ownerId(ownerKey);
  const list = (await readJson<StoredPersona[]>(ownerPath(owner), true)) ?? [];
  let slug = p.slug;
  let existing: StoredPersona | undefined;
  if (slug) {
    existing = list.find((x) => x.share_slug === slug);
    // Editing someone else's persona (or a stale slug) creates a new one instead.
    if (!existing) slug = undefined;
  }
  if (!slug) {
    if (list.length >= MAX_PER_OWNER) throw new PlayError('You can keep up to 25 personas. Delete one first.', 400);
    slug = crypto.randomBytes(7).toString('hex');
  }
  const record: StoredPersona = {
    share_slug: slug, name: p.name, tagline: p.tagline, description: p.description, greeting: p.greeting,
    language: p.language, voice: p.voice, rate: p.rate, visibility: p.visibility, accent: p.accent,
    call_count: existing?.call_count ?? 0, updated_at: new Date().toISOString(), owner,
  };
  await writeJson(personaPath(slug), record);
  await writeJson(ownerPath(owner), [record, ...list.filter((x) => x.share_slug !== slug)]);
  return slug;
}

export async function deletePersona(ownerKey: string, slug: string) {
  const b = requireBackend();
  if (b === 'db') {
    const { error } = await anonDb().rpc('play_delete_persona', { p_token: serverEnv.playToken, p_owner_key: ownerKey, p_slug: slug });
    if (error) throw playError(error.message);
    return;
  }
  const owner = ownerId(ownerKey);
  const list = (await readJson<StoredPersona[]>(ownerPath(owner), true)) ?? [];
  if (!list.some((x) => x.share_slug === slug)) return;
  await removeBlob(personaPath(slug));
  await writeJson(ownerPath(owner), list.filter((x) => x.share_slug !== slug));
}
