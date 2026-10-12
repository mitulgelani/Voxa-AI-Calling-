/**
 * Warm Edge TTS client.
 *
 * A one-word phrase and a twenty-word sentence cost the same ~0.65s on a cold socket:
 * almost all of it is the TLS + WebSocket handshake. Keeping one socket open and
 * reusing it brings each request to ~0.3s. Every request is serialised on a single
 * promise chain, because audio frames on a shared socket cannot be attributed to
 * overlapping requests. Worst case falls back to node-edge-tts (the old timing),
 * never a silent call.
 */
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import WebSocket from 'ws';

export const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
export const CHROMIUM_FULL_VERSION = '143.0.3650.75';
const CHROMIUM_MAJOR = CHROMIUM_FULL_VERSION.split('.')[0];
const WSS_BASE = 'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1';
const ORIGIN = 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold';
const USER_AGENT =
  `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ` +
  `Chrome/${CHROMIUM_MAJOR}.0.0.0 Safari/537.36 Edg/${CHROMIUM_MAJOR}.0.0.0`;
const OUTPUT_FORMAT = 'audio-24khz-48kbitrate-mono-mp3';

const CONNECT_TIMEOUT_MS = 6000;
const REQUEST_TIMEOUT_MS = 8000;

export interface SynthOptions {
  voice: string;
  /** e.g. "+0%", "+8%", "-5%" */
  rate?: string;
  /** e.g. "+0Hz", "-2Hz" */
  pitch?: string;
}

/** Sec-MS-GEC token. BigInt(...) calls, not literals: the project targets below ES2020. */
export function secMsGec(): string {
  const unixSeconds = BigInt(Math.floor(Date.now() / 1000));
  let ticks = (unixSeconds + BigInt(11644473600)) * BigInt(10000000);
  const window = BigInt(3000000000);
  ticks = ticks - (ticks % window);
  return crypto
    .createHash('sha256')
    .update(ticks.toString() + TRUSTED_CLIENT_TOKEN, 'ascii')
    .digest('hex')
    .toUpperCase();
}

function uuid(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

function timestamp(): string {
  return new Date().toString();
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function safeProsody(value: string | undefined, unit: '%' | 'Hz'): string {
  if (!value) return unit === '%' ? '+0%' : '+0Hz';
  const re = unit === '%' ? /^[+-]\d{1,2}%$/ : /^[+-]\d{1,2}Hz$/;
  return re.test(value) ? value : unit === '%' ? '+0%' : '+0Hz';
}

interface Pending {
  requestId: string;
  chunks: Buffer[];
  resolve: (audio: Buffer) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

class WarmEdgeTts {
  private socket: WebSocket | null = null;
  private connecting: Promise<WebSocket> | null = null;
  private pending: Pending | null = null;
  private chain: Promise<unknown> = Promise.resolve();

  /** Queue a synthesis. Requests never interleave on the socket. */
  synthesize(text: string, options: SynthOptions): Promise<Buffer> {
    const run = () => this.synthesizeWithFallback(text, options);
    const next = this.chain.then(run, run);
    this.chain = next.catch(() => undefined);
    return next;
  }

  private async synthesizeWithFallback(text: string, options: SynthOptions): Promise<Buffer> {
    try {
      return await this.synthesizeOnce(text, options);
    } catch (first) {
      this.drop();
      try {
        return await this.synthesizeOnce(text, options);
      } catch (second) {
        this.drop();
        console.warn('[tts] warm socket failed twice, using node-edge-tts:', (second as Error).message);
        return libraryFallback(text, options);
      }
    }
  }

  private drop() {
    const socket = this.socket;
    this.socket = null;
    this.connecting = null;
    if (socket) {
      try {
        socket.removeAllListeners();
        socket.on('error', () => undefined);
        socket.terminate();
      } catch {
        /* ignore */
      }
    }
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(new Error('socket dropped'));
      this.pending = null;
    }
  }

  private connect(): Promise<WebSocket> {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) return Promise.resolve(this.socket);
    if (this.connecting) return this.connecting;

    const url =
      `${WSS_BASE}?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}` +
      `&Sec-MS-GEC=${secMsGec()}` +
      `&Sec-MS-GEC-Version=1-${CHROMIUM_FULL_VERSION}` +
      `&ConnectionId=${uuid()}`;

    this.connecting = new Promise<WebSocket>((resolve, reject) => {
      const socket = new WebSocket(url, {
        headers: {
          Origin: ORIGIN,
          'User-Agent': USER_AGENT,
          Pragma: 'no-cache',
          'Cache-Control': 'no-cache',
          'Accept-Encoding': 'gzip, deflate, br, zstd',
          'Accept-Language': 'en-US,en;q=0.9',
          Cookie: `muid=${uuid().toUpperCase()};`,
        },
      });
      const timer = setTimeout(() => {
        socket.terminate();
        reject(new Error('connect timeout'));
      }, CONNECT_TIMEOUT_MS);

      socket.once('open', () => {
        clearTimeout(timer);
        socket.send(
          `X-Timestamp:${timestamp()}\r\n` +
            'Content-Type:application/json; charset=utf-8\r\n' +
            'Path:speech.config\r\n\r\n' +
            JSON.stringify({
              context: {
                synthesis: {
                  audio: {
                    metadataoptions: { sentenceBoundaryEnabled: 'false', wordBoundaryEnabled: 'false' },
                    outputFormat: OUTPUT_FORMAT,
                  },
                },
              },
            }),
        );
        this.socket = socket;
        this.connecting = null;
        resolve(socket);
      });
      socket.on('message', (data, isBinary) => this.onMessage(data as Buffer, isBinary));
      socket.on('close', () => {
        if (this.socket === socket) this.socket = null;
        if (this.pending) {
          clearTimeout(this.pending.timer);
          this.pending.reject(new Error('socket closed'));
          this.pending = null;
        }
      });
      socket.on('error', (error) => {
        clearTimeout(timer);
        if (this.connecting) {
          this.connecting = null;
          reject(error);
        }
      });
    });
    return this.connecting;
  }

  private onMessage(data: Buffer, isBinary: boolean) {
    const pending = this.pending;
    if (!pending) return;
    if (isBinary) {
      if (data.length < 2) return;
      const headerLength = data.readUInt16BE(0);
      const header = data.subarray(2, 2 + headerLength).toString('utf8');
      if (!header.includes('Path:audio')) return;
      const id = /X-RequestId:([a-f0-9]+)/i.exec(header);
      if (id && id[1].toLowerCase() !== pending.requestId) return;
      const audio = data.subarray(2 + headerLength);
      if (audio.length) pending.chunks.push(Buffer.from(audio));
      return;
    }
    const text = data.toString('utf8');
    if (text.includes('Path:turn.end')) {
      clearTimeout(pending.timer);
      this.pending = null;
      const audio = Buffer.concat(pending.chunks);
      if (audio.length === 0) pending.reject(new Error('empty audio'));
      else pending.resolve(audio);
    }
  }

  private async synthesizeOnce(text: string, options: SynthOptions): Promise<Buffer> {
    const socket = await this.connect();
    const requestId = uuid();
    const ssml =
      `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>` +
      `<voice name='${options.voice}'>` +
      `<prosody pitch='${safeProsody(options.pitch, 'Hz')}' rate='${safeProsody(options.rate, '%')}' volume='+0%'>` +
      `${escapeXml(text)}</prosody></voice></speak>`;

    return new Promise<Buffer>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending && this.pending.requestId === requestId) this.pending = null;
        reject(new Error('request timeout'));
      }, REQUEST_TIMEOUT_MS);
      this.pending = { requestId, chunks: [], resolve, reject, timer };
      socket.send(
        `X-RequestId:${requestId}\r\n` +
          'Content-Type:application/ssml+xml\r\n' +
          `X-Timestamp:${timestamp()}Z\r\n` +
          'Path:ssml\r\n\r\n' +
          ssml,
        (error) => {
          if (error) {
            clearTimeout(timer);
            if (this.pending && this.pending.requestId === requestId) this.pending = null;
            reject(error);
          }
        },
      );
    });
  }
}

async function libraryFallback(text: string, options: SynthOptions): Promise<Buffer> {
  // Dynamic import so the library is only loaded when the warm path fails.
  const { EdgeTTS } = (await import('node-edge-tts')) as unknown as {
    EdgeTTS: new (opts: Record<string, unknown>) => { ttsPromise: (t: string, f: string) => Promise<void> };
  };
  const file = path.join(os.tmpdir(), `voxa-tts-${uuid()}.mp3`);
  const tts = new EdgeTTS({
    voice: options.voice,
    lang: 'en-US',
    outputFormat: OUTPUT_FORMAT,
    rate: safeProsody(options.rate, '%'),
    pitch: safeProsody(options.pitch, 'Hz'),
    timeout: 15000,
  });
  try {
    await tts.ttsPromise(text, file);
    return await fs.promises.readFile(file);
  } finally {
    fs.promises.unlink(file).catch(() => undefined);
  }
}

// Module-level singleton, survives across requests in the same server process.
const globalKey = '__voxaWarmEdgeTts';
type GlobalWithTts = typeof globalThis & { [globalKey]?: WarmEdgeTts };
const g = globalThis as GlobalWithTts;
export const warmTts: WarmEdgeTts = g[globalKey] || (g[globalKey] = new WarmEdgeTts());
