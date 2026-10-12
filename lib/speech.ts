// Text helpers for the conversation engine. Pure functions, no browser APIs.

const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu;

/** Strip anything that should never be spoken: markdown, bullets, emoji, stage directions, control tokens. */
export function cleanSpeech(text: string): string {
  return String(text || '')
    .replace(/\[END\]/gi, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\*[^*\n]{1,40}\*(?=\s|$)/g, (m) => (/^\*(laughs?|sighs?|pauses?|smiles?|chuckles?)[^*]*\*$/i.test(m) ? ' ' : m))
    .replace(/\((laughs?|sighs?|pauses?|smiles?|chuckles?)[^)]*\)/gi, ' ')
    .replace(/^\s*(?:[-*•]|\d+[.)])\s+/gm, '')
    .replace(/[*_#>~|]/g, '')
    .replace(EMOJI, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.!?])/g, '$1')
    .replace(/^[,\s]+/, '')
    .trim();
}

export function hasEndToken(text: string): boolean {
  return /\[END\]/i.test(text || '');
}

/** Split into sentences so the first one can start playing while the next synthesises. */
export function splitSentences(text: string): string[] {
  const parts = text.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) || [];
  const out: string[] = [];
  for (const raw of parts) {
    const s = raw.trim();
    if (!s) continue;
    // Glue tiny fragments ("Oh." "Okay!") onto the next sentence so speech flows.
    if (out.length && out[out.length - 1].split(/\s+/).length <= 2) out[out.length - 1] += ` ${s}`;
    else out.push(s);
  }
  return out;
}

export function words(text: string): string[] {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9'\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

const BACKCHANNEL = new Set([
  'ok', 'okay', 'k', 'mm', 'mhm', 'mmhmm', 'mm-hmm', 'mm-hm', 'uh-huh', 'uhhuh', 'uh', 'huh', 'um', 'hmm', 'hm',
  'yeah', 'yep', 'yup', 'yes', 'ya', 'right', 'sure', 'alright', 'all', 'got', 'it', 'i', 'see', 'cool', 'nice',
  'great', 'oh', 'ah', 'aha', 'true', 'exactly', 'fine', 'good',
]);

/** "okay", "mm-hmm", "yeah right", "got it" — a nod, not a turn. */
export function isBackchannel(text: string): boolean {
  const w = words(text);
  if (!w.length || w.length > 3) return false;
  return w.every((x) => BACKCHANNEL.has(x));
}

const CONTINUATIONS = new Set([
  'and', 'but', 'so', 'or', 'because', 'cause', 'um', 'uh', 'like', 'the', 'a', 'an', 'to', 'if', 'then', 'with',
  'my', 'i', "i'm", 'is', 'was', 'that', 'which', 'when', 'for', 'of', 'about', 'actually', 'basically',
]);

/** The caller trailed off mid-thought ("I wanted to ask about the..."). Give them a moment. */
export function soundsUnfinished(text: string): boolean {
  const t = String(text || '').trim();
  if (!t) return false;
  if (/[.!?]$/.test(t) && !/\.\.\.$/.test(t)) return false;
  if (/(\.\.\.|…|,|-)$/.test(t)) return true;
  const w = words(t);
  return CONTINUATIONS.has(w[w.length - 1]);
}

/** True when the caller's "words" are just the agent's own voice leaking back through the mic. */
export function isEcho(callerText: string, agentLines: string[]): boolean {
  const c = words(callerText);
  if (c.length < 2) return false;
  for (const line of agentLines) {
    const a = new Set(words(line));
    if (!a.size) continue;
    const hits = c.filter((x) => a.has(x)).length;
    if (hits / c.length >= 0.7) return true;
  }
  return false;
}

export function endsWithQuestion(text: string): boolean {
  return /\?\s*$/.test(String(text || '').trim());
}

/**
 * A clip that starts right after the agent stops can begin with the tail of its own
 * sentence ("...for a quick minute. Yes, now is fine"). Drop that leading echo.
 */
export function stripEchoPrefix(callerText: string, agentLine: string): string {
  const raw = String(callerText || '').trim().split(/\s+/).filter(Boolean);
  const c = words(callerText);
  const a = words(agentLine);
  if (c.length < 3 || a.length < 2 || raw.length !== c.length) return callerText;
  for (let n = Math.min(c.length - 1, a.length); n >= 2; n--) {
    const tail = a.slice(a.length - n).join(' ');
    if (c.slice(0, n).join(' ') === tail) return raw.slice(n).join(' ');
  }
  return callerText;
}
