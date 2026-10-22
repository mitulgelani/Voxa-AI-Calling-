/** G.711 µ-law <-> 16-bit PCM, resampling, and WAV helpers. Telephony audio is 8 kHz mono. */

const BIAS = 0x84;
const CLIP = 32635;

export function linearToMulaw(sample: number): number {
  let s = Math.max(-CLIP, Math.min(CLIP, sample));
  const sign = s < 0 ? 0x80 : 0;
  if (sign) s = -s;
  s += BIAS;
  let exponent = 7;
  for (let mask = 0x4000; (s & mask) === 0 && exponent > 0; exponent--, mask >>= 1);
  const mantissa = (s >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

const MU_TABLE = new Int16Array(256);
for (let i = 0; i < 256; i++) {
  const u = ~i & 0xff;
  const sign = u & 0x80;
  const exponent = (u >> 4) & 0x07;
  const mantissa = u & 0x0f;
  let s = ((mantissa << 3) + BIAS) << exponent;
  s -= BIAS;
  MU_TABLE[i] = sign ? -s : s;
}

export function mulawToPcm(buf: Buffer): Int16Array {
  const out = new Int16Array(buf.length);
  for (let i = 0; i < buf.length; i++) out[i] = MU_TABLE[buf[i]];
  return out;
}

export function pcmToMulaw(pcm: Int16Array): Buffer {
  const out = Buffer.alloc(pcm.length);
  for (let i = 0; i < pcm.length; i++) out[i] = linearToMulaw(pcm[i]);
  return out;
}

/** Linear-interpolation resampler; fine for speech between 8, 16 and 24 kHz. */
export function resample(pcm: Int16Array, from: number, to: number): Int16Array {
  if (from === to) return pcm;
  const ratio = from / to;
  const out = new Int16Array(Math.floor(pcm.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const x = i * ratio;
    const i0 = Math.floor(x);
    const i1 = Math.min(pcm.length - 1, i0 + 1);
    const f = x - i0;
    out[i] = Math.round(pcm[i0] * (1 - f) + pcm[i1] * f);
  }
  return out;
}

export function rms(pcm: Int16Array): number {
  if (!pcm.length) return 0;
  let s = 0;
  for (let i = 0; i < pcm.length; i++) s += pcm[i] * pcm[i];
  return Math.sqrt(s / pcm.length) / 32768;
}

export function wav(pcm: Int16Array, rate: number): Buffer {
  const data = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

/** Parse a PCM16 WAV (as returned by TTS providers); returns samples and rate. */
export function parseWav(buf: Buffer): { pcm: Int16Array; rate: number } {
  if (buf.toString('ascii', 0, 4) !== 'RIFF') throw new Error('not a wav');
  let off = 12;
  let rate = 0;
  let bits = 16;
  let channels = 1;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === 'fmt ') { channels = buf.readUInt16LE(off + 10); rate = buf.readUInt32LE(off + 12); bits = buf.readUInt16LE(off + 22); }
    if (id === 'data') {
      if (bits !== 16) throw new Error('only 16-bit wav');
      const end = Math.min(buf.length, off + 8 + size);
      const raw = buf.subarray(off + 8, end);
      const copy = Buffer.from(raw); // align
      let pcm = new Int16Array(copy.buffer, copy.byteOffset, Math.floor(copy.length / 2));
      if (channels === 2) { const m = new Int16Array(pcm.length / 2); for (let i = 0; i < m.length; i++) m[i] = (pcm[2 * i] + pcm[2 * i + 1]) >> 1; pcm = m; }
      return { pcm, rate };
    }
    off += 8 + size + (size % 2);
  }
  throw new Error('wav has no data chunk');
}

/**
 * The call's recording: one mono 8 kHz track on the call timeline. Both parties are mixed in at
 * the millisecond they happened, so evidence offsets in the database line up with the audio.
 */
export class Tape {
  private chunks: Int16Array[] = [];
  private length = 0;
  ensure(samples: number) {
    while (this.length < samples) { const c = new Int16Array(8000 * 10); this.chunks.push(c); this.length += c.length; }
  }
  mix(atMs: number, pcm: Int16Array) {
    const start = Math.max(0, Math.round((atMs * 8000) / 1000));
    this.ensure(start + pcm.length);
    for (let i = 0; i < pcm.length; i++) {
      const p = start + i;
      const c = this.chunks[Math.floor(p / 80000)];
      const j = p % 80000;
      c[j] = Math.max(-32768, Math.min(32767, c[j] + pcm[i]));
    }
  }
  toWav(durationMs: number): Buffer {
    const n = Math.round((durationMs * 8000) / 1000);
    this.ensure(n);
    const out = new Int16Array(n);
    for (let i = 0; i < n; i++) out[i] = this.chunks[Math.floor(i / 80000)][i % 80000];
    return wav(out, 8000);
  }
}
