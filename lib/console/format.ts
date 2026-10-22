export function money(minor: number | null | undefined, currency = 'INR') {
  const v = (minor ?? 0) / 100;
  return new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', { style: 'currency', currency, maximumFractionDigits: v < 100 ? 2 : 0 }).format(v);
}
export function duration(ms: number | null | undefined) {
  if (!ms) return '0:00';
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
export function when(iso: string | null | undefined, tz = 'Asia/Kolkata') {
  if (!iso) return '—';
  const d = new Date(iso);
  const sameDay = new Date().toDateString() === d.toDateString();
  return new Intl.DateTimeFormat('en-IN', sameDay ? { hour: 'numeric', minute: '2-digit', timeZone: tz } : { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: tz }).format(d);
}
export function count(n: number | null | undefined) {
  return new Intl.NumberFormat('en-IN').format(n ?? 0);
}
export function pct(part: number, whole: number) {
  return whole ? `${Math.round((part / whole) * 100)}%` : '—';
}
/** Mask the middle of a phone number for screens that don't need the whole thing. */
export function maskPhone(e164: string) {
  return e164.length > 7 ? `${e164.slice(0, e164.length - 7)}•••${e164.slice(-4)}` : e164;
}
export const OUTCOME_LABEL: Record<string, string> = {
  completed: 'Completed', partial: 'Partial', no_answer: 'No answer', busy: 'Busy', voicemail: 'Voicemail', failed: 'Failed',
  opted_out: 'Opted out', callback: 'Callback asked', transferred: 'Transferred', hung_up_early: 'Hung up early',
};
