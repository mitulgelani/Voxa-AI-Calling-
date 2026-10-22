export type ActionResult = { ok: true; message?: string; id?: string } | { ok: false; error: string };

/** Turn Postgres / RLS errors into sentences a person can act on. Never leak internals. */
export function friendly(err: { message?: string; code?: string } | null | undefined, fallback = 'That did not save. Try again.'): string {
  const m = err?.message ?? '';
  if (err?.code === '42501' || /row-level security|permission denied|not allowed/i.test(m)) return 'Your role does not allow this. Ask an admin.';
  if (err?.code === '23505') return 'That already exists.';
  if (err?.code === '23514') return 'Some values are outside what is allowed. Check the highlighted fields.';
  // Messages raised by our own functions are written for people; pass them through.
  if (err?.code === 'P0001' && m && m.length < 300) return m.charAt(0).toUpperCase() + m.slice(1) + (m.endsWith('.') ? '' : '.');
  return fallback;
}
