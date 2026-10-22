// Public env (safe in the browser). Server-only secrets live in lib/server-env.ts.
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
export const hasSupabase = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
