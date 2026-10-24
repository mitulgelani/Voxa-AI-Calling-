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
  // End punctuation only ends a sentence when a space or the end follows, so "1.8 lakh" and "₹4,999.50" stay
  // whole. CJK full stops need no space.
  const parts = text.split(/(?<=[.!?।]["')\]]*)\s+|(?<=[。！？])/);
  const out: string[] = [];
  for (const raw of parts) {
    const s = raw.trim();
    if (!s) continue;
    // Glue tiny fragments ("Oh." "Okay!") onto the next sentence so speech flows.
    if (out.length && out[out.length - 1].split(/\s+/).length <= 2) out[out.length - 1] += ` ${s}`;
    else out.push(s);
  }
  // One synthesis request takes at most 600 characters: break any run-on sentence at a comma or a space.
  return out.flatMap((s) => {
    const pieces: string[] = [];
    let rest = s;
    while (rest.length > 280) {
      const window = rest.slice(0, 280);
      const cut = Math.max(window.lastIndexOf(', '), window.lastIndexOf('; '), window.lastIndexOf(' — '));
      const at = cut > 80 ? cut + 1 : window.lastIndexOf(' ') > 80 ? window.lastIndexOf(' ') : 280;
      pieces.push(rest.slice(0, at).trim());
      rest = rest.slice(at).trim();
    }
    if (rest) pieces.push(rest);
    return pieces;
  });
}

const CJK = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/;

/** Words in any script. Chinese/Japanese have no spaces, so each pair of characters counts as a word. */
export function words(text: string): string[] {
  const t = String(text || '').toLowerCase();
  const out: string[] = [];
  for (const token of t.replace(/[^\p{L}\p{M}\p{N}'\s-]/gu, ' ').split(/\s+/)) {
    if (!token) continue;
    if (CJK.test(token) && !/[\uac00-\ud7af]/.test(token)) {
      for (let i = 0; i < token.length; i += 2) out.push(token.slice(i, i + 2));
    } else out.push(token);
  }
  return out;
}

const BACKCHANNEL = new Set([
  'ok', 'okay', 'k', 'mm', 'mhm', 'mmhmm', 'mm-hmm', 'mm-hm', 'uh-huh', 'uhhuh', 'uh', 'huh', 'um', 'hmm', 'hm',
  'yeah', 'yep', 'yup', 'yes', 'ya', 'right', 'sure', 'alright', 'all', 'got', 'it', 'i', 'see', 'cool', 'nice',
  'great', 'oh', 'ah', 'aha', 'true', 'exactly', 'fine', 'good',
  // Hindi / Hinglish / Urdu
  'haan', 'han', 'haa', 'ha', 'haanji', 'ji', 'accha', 'achha', 'acha', 'theek', 'thik', 'hai', 'sahi',
  'हाँ', 'हां', 'हा', 'जी', 'हाँजी', 'अच्छा', 'ठीक', 'है', 'हम्म', 'हम', 'ओके', 'सही', 'जी हाँ',
  'ہاں', 'جی', 'اچھا', 'ٹھیک',
  // Indian languages
  'હા', 'સારું', 'બરાબર', 'हो', 'बरं', 'சரி', 'ஆமா', 'సరే', 'అవును', 'আচ্ছা', 'হ্যাঁ', 'ಸರಿ', 'ಹೌದು', 'ശരി', 'അതെ',
  // European and others
  'sí', 'si', 'vale', 'claro', 'ajá', 'oui', "d'accord", 'ja', 'genau', 'sim', 'certo', 'tá', 'uhum', 'evet', 'tamam',
  'iya', 'oke', 'да', 'угу', 'так', 'نعم', 'تمام', 'طيب', 'はい', 'ええ', 'うん', '嗯', '好的', '네', '음',
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
  'aur', 'lekin', 'toh', 'to', 'ki', 'kyunki', 'matlab', 'jaise', 'agar', 'mera', 'meri',
  'और', 'लेकिन', 'तो', 'कि', 'क्योंकि', 'मतलब', 'जैसे', 'अगर', 'मेरा', 'मेरी', 'या', 'पर',
  'y', 'pero', 'porque', 'et', 'mais', 'parce', 'und', 'aber', 'weil', 'e', 'mas', 'porque',
]);

/** Words that stop the agent even when the interruption is short ("wait", "ruko"). */
export const STOP_WORDS = new Set([
  'wait', 'stop', 'hold', 'sorry', 'excuse', 'no', 'nope', 'hang', 'pardon', 'what',
  'ruko', 'ruk', 'suno', 'nahi', 'nahin', 'arre', 'रुको', 'रुकिए', 'सुनो', 'सुनिए', 'नहीं', 'अरे', 'एक',
  'espera', 'para', 'attendez', 'non', 'warte', 'nein', 'espere', 'não', 'momento',
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
