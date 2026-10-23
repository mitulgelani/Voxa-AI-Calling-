/**
 * Sec-MS-GEC v2 token for Microsoft Edge's read-aloud speech service.
 *
 * In October 2026 the service stopped accepting the v1 token (a plain SHA-256 of the time window
 * and the public client token) and now requires "v2": "<16 hex CS64>-<64 hex SHA-256>", where the
 * SHA-256 runs over a fixed hidden prefix plus the same time string, and CS64 is a keyed checksum.
 * Ported line for line from rany2/edge-tts 7.3.1 (edge_tts/drm.py), and checked against it
 * for many timestamps.
 *
 * All arithmetic is unsigned 32-bit: Math.imul for products, >>> 0 to wrap.
 */

export const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
export const SEC_MS_GEC_VERSION_PREFIX = '2-';
const WIN_EPOCH = 11644473600;

const SHA256_INITIAL = [1779033703, 3144134277, 1013904242, 2773480762, 1359893119, 2600822924, 528734635, 1541459225];
const SHA256_STATE = [4255104674, 2435071207, 3192492180, 3442351626, 1811967817, 79508907, 4272990180, 66059218];
const SHA256_SCHEDULE = [
  3945054110, 358115615, 2696978146, 217723578, 2787307148, 3520959633, 3235718560, 4192668342, 4039316851, 1884868174,
  1904797190, 15051571, 3529027680, 1920361828,
];
const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
  0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08,
  0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];
/** The first (hidden-prefix) block uses the standard constants except round 14. */
const K_BLOCK = K.map((k, i) => (i === 14 ? 0xc9dc06a7 : k));
const SHA256_ADJUSTMENT = 3386640039;
const SIGMA0_ADJUSTMENT = 94112640;
const SIGMA1_ADJUSTMENT = 758464;
const CS64_COEFFICIENTS: [number, number][] = [
  [3895366065, 3005677776], [1155409094, 2296378653], [1005282748, 693190712], [3365689651, 3005795295],
  [2367603217, 3557143765], [827258325, 652566332], [3911487921, 1618477510], [4037392853, 2192753147],
  [101076211, 4199654362], [3665427040, 545047652], [3201434976, 1010595059], [2314848760, 3536931681],
  [905590982, 3137643201], [3410617286, 3311559015],
];
const CS64_FACTOR = 2190031155;
const CS64_ADJUSTMENT0 = 4076407578;
const CS64_ADJUSTMENT1 = 186253312;

const u32 = (x: number) => x >>> 0;
const mul = (a: number, b: number) => Math.imul(a, b) >>> 0;
const rotr = (x: number, n: number) => ((x >>> n) | (x << (32 - n))) >>> 0;
const rol16 = (x: number) => ((x << 16) | (x >>> 16)) >>> 0;
const sigma0 = (v: number) => (rotr(v, 7) ^ rotr(v, 18) ^ (v >>> 3)) >>> 0;
const sigma1 = (v: number) => (rotr(v, 17) ^ rotr(v, 19) ^ (v >>> 10)) >>> 0;

function expand(words: number[], first = 16) {
  for (let i = first; i < 64; i++) {
    words.push(u32(sigma1(words[i - 2]) + words[i - 7] + sigma0(words[i - 15]) + words[i - 16]));
  }
}

function rounds(state: number[], words: number[], firstRound = 0): number[] {
  let [a, b, c, d, e, f, g, h] = state;
  const k = firstRound === 14 ? K_BLOCK : K;
  for (let i = firstRound; i < 64; i++) {
    const S1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
    const ch = (g ^ (e & (f ^ g))) >>> 0;
    const t1 = u32(h + S1 + ch + k[i] + words[i]);
    const S0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
    const maj = ((a & b) | (c & (a | b))) >>> 0;
    const t2 = u32(S0 + maj);
    h = g; g = f; f = e; e = u32(d + t1); d = c; c = b; b = a; a = u32(t1 + t2);
  }
  return [a, b, c, d, e, f, g, h];
}

/** State after the first block, which is a fixed hidden 57-byte prefix plus the first 7 data bytes. */
function initState(data: Uint8Array): number[] {
  const words: number[] = new Array(14).fill(0);
  words.push(((data[0] << 16) | (data[1] << 8) | data[2]) >>> 0);
  words.push(((data[3] << 24) | (data[4] << 16) | (data[5] << 8) | data[6]) >>> 0);
  for (let i = 16; i < 30; i++) {
    let v = SHA256_SCHEDULE[i - 16];
    if (i - 2 >= 14) v += i === 16 ? (sigma1(words[i - 2]) ^ SIGMA1_ADJUSTMENT) >>> 0 : sigma1(words[i - 2]);
    if (i - 7 >= 14) v += words[i - 7];
    if (i - 15 >= 14) v += i === 29 ? (sigma0(words[i - 15]) ^ SIGMA0_ADJUSTMENT) >>> 0 : sigma0(words[i - 15]);
    words.push(u32(v));
  }
  words.push(u32(sigma1(words[28]) + words[23] + sigma0(words[15]) + words[14] + SHA256_ADJUSTMENT - K[14]));
  expand(words, 31);
  const working = rounds(SHA256_STATE, words, 14);
  return SHA256_INITIAL.map((x, i) => u32(x + working[i]));
}

function sha256Digest(data: Uint8Array): Uint8Array {
  const length = 57 + data.length;
  const zeros = (((55 - length) % 64) + 64) % 64;
  const tail = data.subarray(7);
  const padded = new Uint8Array(tail.length + 1 + zeros + 8);
  padded.set(tail, 0);
  padded[tail.length] = 0x80;
  const view = new DataView(padded.buffer);
  const bits = length * 8;
  view.setUint32(padded.length - 8, Math.floor(bits / 0x100000000), false);
  view.setUint32(padded.length - 4, bits >>> 0, false);
  let state = initState(data);
  for (let off = 0; off < padded.length; off += 64) {
    const words: number[] = [];
    for (let i = 0; i < 16; i++) words.push(view.getUint32(off + i * 4, false));
    expand(words);
    const working = rounds(state, words);
    state = state.map((x, i) => u32(x + working[i]));
  }
  const out = new Uint8Array(32);
  const ov = new DataView(out.buffer);
  state.forEach((x, i) => ov.setUint32(i * 4, x, false));
  return out;
}

function wordsLe4Even(bytes: Uint8Array): number[] {
  const len = Math.ceil(bytes.length / 4) * 4;
  if (!len) return [];
  const padded = new Uint8Array(len);
  padded.set(bytes);
  const view = new DataView(padded.buffer);
  const words: number[] = [];
  for (let i = 0; i < len; i += 4) words.push(view.getUint32(i, true));
  if (words.length % 2) words.push(0);
  return words;
}

function cs64Digest(data: Uint8Array, digest: Uint8Array): [number, number] {
  const dv = new DataView(digest.buffer, digest.byteOffset, digest.byteLength);
  const keyA = (dv.getUint32(0, true) | 1) >>> 0;
  const keyB = (dv.getUint32(4, true) | 1) >>> 0;
  const factors = [mul(keyA, CS64_FACTOR), mul(keyB, CS64_FACTOR)];
  const terms = CS64_COEFFICIENTS.map(([coef], i) => mul(coef, factors[i % 2]));
  const offsets = CS64_COEFFICIENTS.map(([, off]) => off);
  const prefixed = new Uint8Array(data.length + 1);
  prefixed.set(data, 1);
  wordsLe4Even(prefixed).forEach((word, i) => {
    let term = mul(word, i % 2 === 0 ? keyA : keyB);
    let offset = mul(rol16(word), i % 2 === 0 ? 0xef0569fb : 0xc31713db);
    if (i === 0) {
      term = u32(term + mul(CS64_ADJUSTMENT0, factors[0]));
      offset = u32(offset + CS64_ADJUSTMENT1);
    }
    terms.push(term);
    offsets.push(offset);
  });
  let swapAcc = 0, swapLast = 0, state = 0, acc = 0;
  for (let i = 0; i < terms.length; i += 2) {
    const x = terms[i], y = terms[i + 1];
    let t = rol16(u32(offsets[i] + x));
    let q = mul(t, 0x76f50f34);
    swapAcc = u32(swapAcc + u32(mul(rol16(q), 0xc3efea97) + q));
    t = rol16(u32(offsets[i + 1] + y));
    q = mul(t, 0x1881ce3c);
    swapLast = u32(mul(rol16(q), 0x35bd1ec9) + q);
    swapAcc = u32(swapAcc + swapLast);

    state = u32(mul(state, keyA) + x);
    state = mul(rol16(state), 0xcf98b111);
    state = mul(rol16(state), 0x87085b9f);
    state = mul(rol16(state), 0x12ceb96d);
    state = mul(rol16(state), 0x257e1d83);
    acc = u32(acc + state);
    let t2 = u32(mul(state, keyB) + y);
    t2 = mul(rol16(t2), 0xa27416f5);
    t2 = mul(rol16(t2), 0xd38396ff);
    state = mul(rol16(mul(rol16(t2), 0x7c932b89)), 0xbfa49f69);
    acc = u32(acc + state);
  }
  return [(swapLast ^ state) >>> 0, (swapAcc ^ acc) >>> 0];
}

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();

/** The v2 token for a Unix time in seconds (defaults to now). Valid for the current 5-minute window. */
export function secMsGecV2(unixSeconds = Date.now() / 1000): string {
  let ticks = Math.floor(unixSeconds) + WIN_EPOCH;
  ticks -= ticks % 300;
  const text = `${BigInt(ticks) * BigInt(10000000)}${TRUSTED_CLIENT_TOKEN}`;
  const data = new TextEncoder().encode(text);
  const digest = sha256Digest(data);
  const [lo, hi] = cs64Digest(data, digest);
  const cs = new Uint8Array(8);
  const cv = new DataView(cs.buffer);
  cv.setUint32(0, lo, true);
  cv.setUint32(4, hi, true);
  return `${hex(cs)}-${hex(digest)}`;
}
