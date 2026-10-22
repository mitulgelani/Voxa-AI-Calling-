import 'server-only';
import { serverEnv } from '@/lib/server-env';

const GROQ_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const MODEL = 'whisper-large-v3-turbo';

// Whisper invents these on silence, breathing or line noise.
const HALLUCINATIONS = new Set([
  'thank you', 'thank you.', 'thanks for watching', 'thanks for watching!', 'thank you for watching', 'please subscribe',
  'you', 'bye', 'bye.', '.', '...', 'धन्यवाद', 'धन्यवाद।', 'शुक्रिया', 'सब्सक्राइब करें', 'subtitles by the amara.org community',
]);

const PROMPTS: Record<string, string> = {
  hi: 'जी हाँ, मेरा order कल आया था। Delivery थोड़ी late थी, लेकिन product अच्छा है।',
  gu: 'હા, મારો ઓર્ડર ગઈકાલે આવ્યો હતો. ડિલિવરી થોડી મોડી હતી.',
  en: 'Yes, the order came yesterday. Delivery was a little late, but the product is good.',
};

export interface SttResult {
  text: string;
  language: string;
  ms: number;
}

/**
 * Transcribe one caller turn. Auto-detects language so a switch to English is noticed;
 * if detection lands outside the expected set (e.g. Urdu for spoken Hindi), re-runs forced.
 */
export async function transcribe(audio: Blob, expected: string, allowed: string[]): Promise<SttResult> {
  if (!serverEnv.groqKey) throw new Error('GROQ_API_KEY not set');
  const started = Date.now();
  const run = async (language?: string) => {
    const form = new FormData();
    form.append('file', audio, 'turn.webm');
    form.append('model', MODEL);
    form.append('response_format', 'verbose_json');
    form.append('temperature', '0');
    if (language) form.append('language', language);
    const prompt = PROMPTS[language || expected];
    if (prompt) form.append('prompt', prompt);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetch(GROQ_URL, {
        method: 'POST', body: form, signal: controller.signal,
        headers: { Authorization: `Bearer ${serverEnv.groqKey}` },
      });
      if (!res.ok) throw new Error(`groq ${res.status}`);
      const data = (await res.json()) as {
        text?: string; language?: string;
        segments?: { text: string; no_speech_prob?: number; avg_logprob?: number }[];
      };
      const kept = (data.segments || [])
        .filter((s) => !((s.no_speech_prob ?? 0) > 0.6 && (s.avg_logprob ?? 0) < -0.9))
        .map((s) => s.text.trim());
      const text = (data.segments ? kept.join(' ') : data.text || '').trim();
      return { text, language: toCode(data.language) || language || expected };
    } finally {
      clearTimeout(timer);
    }
  };

  let out = await run(allowed.length > 1 ? undefined : expected);
  if (!allowed.includes(out.language)) out = await run(expected);
  if (HALLUCINATIONS.has(out.text.toLowerCase().trim())) out.text = '';
  return { ...out, ms: Date.now() - started };
}

// Groq returns language names ("hindi") in verbose_json; normalise to ISO codes.
const NAMES: Record<string, string> = {
  english: 'en', hindi: 'hi', gujarati: 'gu', urdu: 'ur', marathi: 'mr', tamil: 'ta', telugu: 'te', bengali: 'bn',
  kannada: 'kn', malayalam: 'ml', spanish: 'es', french: 'fr', german: 'de', portuguese: 'pt', italian: 'it',
  arabic: 'ar', russian: 'ru', turkish: 'tr', indonesian: 'id', japanese: 'ja', chinese: 'zh', korean: 'ko', dutch: 'nl',
};
function toCode(lang?: string): string {
  if (!lang) return '';
  const l = lang.toLowerCase();
  return NAMES[l] || (l.length <= 3 ? l : '');
}
