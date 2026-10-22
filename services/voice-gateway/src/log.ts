/** One JSON line per event. Phone numbers are never logged in full. */
export function log(level: 'info' | 'warn' | 'error', msg: string, extra: Record<string, unknown> = {}) {
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...extra });
  if (level === 'error') console.error(line);
  else console.log(line);
}
export const mask = (e164: string) => (e164.length > 6 ? `${e164.slice(0, 4)}…${e164.slice(-2)}` : '…');
