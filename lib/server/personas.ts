import 'server-only';
import { supabaseServer } from '@/lib/supabase/server';
import { hasSupabase } from '@/lib/env';

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

export async function getPersona(slug: string): Promise<PublicPersona | null> {
  if (!hasSupabase || !/^[a-f0-9]{14}$/.test(slug)) return null;
  const db = await supabaseServer();
  const { data } = await db.rpc('persona_by_slug', { p_slug: slug });
  const row = Array.isArray(data) ? data[0] : data;
  return (row as PublicPersona) ?? null;
}

export interface ShowcasePersona {
  name: string;
  tagline: string;
  language: string;
  accent: string;
  share_slug: string;
  call_count: number;
}

export async function getShowcase(limit = 8): Promise<ShowcasePersona[]> {
  if (!hasSupabase) return [];
  const db = await supabaseServer();
  const { data } = await db.rpc('public_personas', { p_limit: limit });
  return (data as ShowcasePersona[]) ?? [];
}
