import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { EdgeTTS } from 'node-edge-tts';
import { config } from './config.js';
import { parseWav, resample, wav } from './audio.js';

/* ---------------------------------------------------------------- listening */

const SARVAM_LANG: Record<string, string> = { hinglish: 'hi-IN', 'hi-IN': 'hi-IN', 'gu-IN': 'gu-IN', 'en-IN': 'en-IN', 'en-US': 'en-IN' };
const HALLUCINATIONS = new Set(['thank you', 'thank you.', 'thanks for watching', 'you', 'bye', '.', '...', 'धन्यवाद', 'धन्यवाद।', 'शुक्रिया']);

export interface Heard { text: string; language: string | null; ms: number; provider: string }

/**
 * One caller turn → text. Sarvam (saaras:v4, auto language among Indian languages) first;
 * Groq Whisper as the fallback. Phone audio is upsampled to 16 kHz, which both prefer.
 */
export async function listen(pcm8k: Int16Array, expected: string, multilingual: boolean): Promise<Heard> {
  const started = Date.now();
  const audio = wav(resample(pcm8k, 8000, 16000), 16000);
  if (config.sarvam.key) {
    try {
      const form = new FormData();
      form.append('file', new Blob([new Uint8Array(audio)], { type: 'audio/wav' }), 'turn.wav');
      form.append('model', 'saaras:v4');
      form.append('language_code', multilingual ? 'unknown' : SARVAM_LANG[expected] ?? 'unknown');
      const res = await fetch('https://api.sarvam.ai/speech-to-text', {
        method: 'POST', body: form, headers: { 'api-subscription-key': config.sarvam.key }, signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`sarvam stt ${res.status}`);
      const d = (await res.json()) as { transcript?: string; language_code?: string | null };
      const text = (d.transcript ?? '').trim();
      return { text: HALLUCINATIONS.has(text.toLowerCase()) ? '' : text, language: d.language_code ?? null, ms: Date.now() - started, provider: 'sarvam' };
    } catch (e) {
      if (!config.groqKey) throw e;
    }
  }
  if (!config.groqKey) throw new Error('no speech-to-text provider configured');
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(audio)], { type: 'audio/wav' }), 'turn.wav');
  form.append('model', 'whisper-large-v3-turbo');
  form.append('response_format', 'json');
  form.append('temperature', '0');
  if (!multilingual) form.append('language', (SARVAM_LANG[expected] ?? 'hi-IN').slice(0, 2));
  const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST', body: form, headers: { Authorization: `Bearer ${config.groqKey}` }, signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`groq stt ${res.status}`);
  const d = (await res.json()) as { text?: string };
  const text = (d.text ?? '').trim();
  return { text: HALLUCINATIONS.has(text.toLowerCase()) ? '' : text, language: null, ms: Date.now() - started, provider: 'groq' };
}

/* ---------------------------------------------------------------- speaking */

export interface Voice { edge: string; gender: 'female' | 'male'; rate: string; language: string }
export interface Spoken { pcm: Int16Array; ms: number; provider: string; chars: number }

const cache = new Map<string, Int16Array>();

/** Text → 8 kHz PCM. Short fixed phrases (greeting, bridges) are cached per voice. */
export async function speak(text: string, v: Voice, cacheable = false): Promise<Spoken> {
  const started = Date.now();
  const key = `${v.edge}|${v.rate}|${v.language}|${text}`;
  const hit = cacheable ? cache.get(key) : undefined;
  if (hit) return { pcm: hit, ms: 0, provider: 'cache', chars: 0 };
  let pcm: Int16Array;
  let provider = config.ttsProvider;
  try {
    pcm = provider === 'sarvam' ? await sarvamTts(text, v) : await edgeTts(text, v);
  } catch (e) {
    provider = provider === 'sarvam' ? 'edge' : 'sarvam';
    if (provider === 'sarvam' && !config.sarvam.key) throw e;
    pcm = provider === 'sarvam' ? await sarvamTts(text, v) : await edgeTts(text, v);
  }
  if (cacheable && cache.size < 500) cache.set(key, pcm);
  return { pcm, ms: Date.now() - started, provider, chars: text.length };
}

async function sarvamTts(text: string, v: Voice): Promise<Int16Array> {
  const speaker = v.gender === 'female' ? config.sarvam.female : config.sarvam.male;
  const pace = v.rate.startsWith('-') ? 0.92 : v.rate.startsWith('+8') ? 1.08 : 1;
  const res = await fetch('https://api.sarvam.ai/text-to-speech', {
    method: 'POST',
    headers: { 'api-subscription-key': config.sarvam.key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text, language_code: SARVAM_LANG[v.language] ?? 'hi-IN', model: config.sarvam.ttsModel,
      ...(speaker ? { speaker } : {}), pace, speech_sample_rate: 8000, output_audio_codec: 'wav',
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`sarvam tts ${res.status}`);
  const d = (await res.json()) as { audios?: string[] };
  if (!d.audios?.length) throw new Error('sarvam tts returned no audio');
  const { pcm, rate } = parseWav(Buffer.from(d.audios.join(''), 'base64'));
  return resample(pcm, rate, 8000);
}

async function edgeTts(text: string, v: Voice): Promise<Int16Array> {
  const file = path.join(os.tmpdir(), `vd-${crypto.randomUUID()}.pcm`);
  const tts = new EdgeTTS({ voice: v.edge, lang: v.edge.slice(0, 5), outputFormat: 'raw-8khz-16bit-mono-pcm', rate: v.rate, timeout: 8000 });
  try {
    await tts.ttsPromise(text, file);
    const raw = await fs.readFile(file);
    const copy = Buffer.from(raw);
    return new Int16Array(copy.buffer, copy.byteOffset, Math.floor(copy.length / 2));
  } finally {
    fs.unlink(file).catch(() => undefined);
  }
}
