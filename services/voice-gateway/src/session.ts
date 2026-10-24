import type WebSocket from 'ws';
import { db } from './db.js';
import { log } from './log.js';
import { config } from './config.js';
import { carriers, type CarrierName, type MediaLink } from './carriers/index.js';
import { mulawToPcm, pcmToMulaw, Tape } from './audio.js';
import { TurnDetector } from './turns.js';
import { listen, speak, type Voice } from './speech.js';
import { OPT_OUT, reply, speechChunks, systemPrompt, type Line, type Script } from './brain.js';
import { finishCall, type CallUsage } from './post.js';

const NUDGE: Record<string, string> = {
  hinglish: 'Hello, kya aap mujhe sun pa rahe hain?', 'hi-IN': 'हेलो, क्या आप मुझे सुन पा रहे हैं?',
  'gu-IN': 'હેલો, તમે મને સાંભળી શકો છો?', 'en-IN': 'Hello, can you hear me?', 'en-US': 'Hello, can you hear me?',
};
const SORRY: Record<string, string> = {
  hinglish: 'Sorry, ek baar phir boliye?', 'hi-IN': 'माफ़ कीजिए, क्या आप फिर से बोल सकते हैं?',
  'gu-IN': 'માફ કરશો, ફરીથી કહેશો?', 'en-IN': 'Sorry, could you say that again?', 'en-US': 'Sorry, could you say that again?',
};
const EDGE_DEFAULT: Record<string, string> = { hinglish: 'hi-IN-SwaraNeural', 'hi-IN': 'hi-IN-SwaraNeural', 'gu-IN': 'gu-IN-DhwaniNeural', 'en-IN': 'en-IN-NeerjaNeural', 'en-US': 'en-US-JennyNeural' };
const MALE = /Madhur|Niranjan|Prabhat|Guy|Andrew|Brian|Christopher|Eric|Roger|Steffan/;

export const live = new Map<string, CallSession>();

/** Everything the agent needs for one call, loaded once from the database. */
async function loadCall(callId: string) {
  const { data: call } = await db.from('calls').select('id, org_id, campaign_id, contact_id, carrier, to_e164, status').eq('id', callId).maybeSingle();
  if (!call) throw new Error('call not found');
  const { data: camp } = await db.from('campaigns').select('agent_version_id, status').eq('id', call.campaign_id).maybeSingle();
  const { data: v } = await db.from('agent_versions').select('version, opening_line, disclosure_line, goal, persona, questions, languages, voice, approved_at, agents!agent_versions_agent_id_fkey(name)').eq('id', camp?.agent_version_id).maybeSingle();
  if (!v?.approved_at) throw new Error('agent version not approved');
  const { data: contact } = await db.from('contacts').select('name, language, attrs').eq('id', call.contact_id).maybeSingle();
  const agentName = ((Array.isArray(v.agents) ? v.agents[0] : v.agents) as { name: string } | null)?.name ?? 'Assistant';
  const script: Script = {
    agentName, goal: v.goal, persona: v.persona, opening: v.opening_line, disclosure: v.disclosure_line,
    questions: v.questions as Script['questions'], languages: v.languages as string[],
  };
  return { call, script, contact: { name: contact?.name ?? '', language: contact?.language as string | null, attrs: (contact?.attrs ?? {}) as Record<string, string> }, voice: (v.voice ?? {}) as { id?: string; rate?: string } };
}

export class CallSession {
  readonly lines: Line[] = [];
  readonly tape = new Tape();
  readonly usage: CallUsage = { sttSeconds: 0, ttsChars: 0, llmTokens: 0, turnLatencies: [], interruptions: 0, providers: new Set() };
  private t0 = Date.now();
  private seq = 0;
  /** Agent audio scheduled on the line and not yet written to the tape, in order. */
  private pending: { startMs: number; pcm: Int16Array; seq: number }[] = [];
  /** Bumped on every barge-in, so a reply still being synthesized stops queueing sentences. */
  private cuts = 0;
  private playEndMs = 0;
  private busy = false;
  private queued: { pcm: Int16Array; startMs: number; endMs: number } | null = null;
  private lastHeardMs = 0;
  private nudges = 0;
  private ending = false;
  private finished = false;
  private timers: NodeJS.Timeout[] = [];
  optOut = false;
  callback = false;
  carrierCallId: string | undefined;
  campaignId: string | null = null;
  lang = 'hinglish';
  private system = '';
  private voice!: Voice;
  private ctx!: Awaited<ReturnType<typeof loadCall>>;
  private turns = new TurnDetector(
    (at) => this.onSpeechStart(at),
    (pcm, s, e) => void this.onTurn(pcm, s, e),
  );

  constructor(readonly callId: string, private ws: WebSocket, private link: MediaLink, readonly carrier: CarrierName) {}

  private now() { return Date.now() - this.t0; }

  async start(carrierCallId?: string) {
    this.carrierCallId = carrierCallId;
    this.ctx = await loadCall(this.callId);
    this.campaignId = this.ctx.call.campaign_id;
    const { script, contact, voice } = this.ctx;
    this.lang = contact.language && script.languages.includes(contact.language) ? contact.language : script.languages[0] ?? 'hinglish';
    const edge = voice.id ?? EDGE_DEFAULT[this.lang];
    this.voice = { edge, gender: MALE.test(edge) ? 'male' : 'female', rate: voice.rate ?? '+0%', language: this.lang };
    this.system = systemPrompt(script, this.lang, contact);
    this.t0 = Date.now();
    await db.from('calls').update({ status: 'in_progress', answered_at: new Date().toISOString(), carrier_call_id: carrierCallId ?? undefined }).eq('id', this.callId);
    const opening = script.opening.replace(/\{name\}/g, contact.name.split(' ')[0] || '').replace(/\s+/g, ' ').trim();
    await this.say(opening, true);
    await this.say(script.disclosure, true);
    this.timers.push(setInterval(() => this.tick(), 1000));
    this.timers.push(setTimeout(() => void this.end('time'), config.maxCallSeconds * 1000));
  }

  /** Inbound µ-law from the carrier: record it on the timeline and run turn detection. */
  onAudio(mulaw: Buffer) {
    if (this.finished) return;
    const at = this.now();
    const pcm = mulawToPcm(mulaw);
    this.tape.mix(at, pcm);
    this.turns.push(pcm, at, at < this.playEndMs);
  }

  private onSpeechStart(atMs: number) {
    this.lastHeardMs = atMs;
    // Barge-in: the caller has priority. Stop the agent and keep only what was actually played.
    if (this.pending.length && atMs < this.playEndMs) {
      this.send([this.link.clear()]);
      this.cuts++;
      for (const seg of this.pending) {
        const durMs = (seg.pcm.length / 8000) * 1000;
        const line = this.lines.find((l) => l.seq === seg.seq);
        if (seg.startMs + durMs <= atMs) {
          this.tape.mix(seg.startMs, seg.pcm);
        } else if (seg.startMs < atMs) {
          this.tape.mix(seg.startMs, seg.pcm.subarray(0, Math.round(((atMs - seg.startMs) * 8000) / 1000)));
          if (line) { line.interrupted = true; line.end_ms = atMs; }
        } else if (line) {
          // queued but never heard: it was not said
          this.lines.splice(this.lines.indexOf(line), 1);
        }
      }
      this.usage.interruptions++;
      this.pending = [];
      this.playEndMs = atMs;
    }
  }

  private async onTurn(pcm: Int16Array, startMs: number, endMs: number) {
    if (this.ending) return;
    if (this.busy) { this.queued = { pcm, startMs, endMs }; return; }
    this.busy = true;
    try {
      const multilingual = this.ctx.script.languages.length > 1;
      const heard = await listen(pcm, this.lang, multilingual);
      this.usage.sttSeconds += pcm.length / 8000;
      this.usage.providers.add(`stt:${heard.provider}`);
      if (!heard.text) return;
      this.lastHeardMs = endMs;
      this.nudges = 0;
      this.lines.push({ speaker: 'customer', text: heard.text, seq: ++this.seq, start_ms: startMs, end_ms: endMs });
      if (OPT_OUT.test(heard.text)) this.optOut = true;
      const started = Date.now();
      let r;
      try {
        r = await reply(this.system, this.lines, this.ctx.script.languages);
      } catch (e) {
        log('warn', 'brain failed', { call: this.callId, err: String(e) });
        await this.say(SORRY[this.lang] ?? SORRY['en-IN'], true);
        return;
      }
      this.usage.llmTokens += r.tokens;
      if (r.lang && r.lang !== this.lang) {
        this.lang = r.lang;
        this.voice = { ...this.voice, language: r.lang, edge: EDGE_DEFAULT[r.lang] ?? this.voice.edge };
        this.system = systemPrompt(this.ctx.script, this.lang, this.ctx.contact);
      }
      if (r.optOut) this.optOut = true;
      if (r.callback) this.callback = true;
      if (this.optOut) await db.rpc('gateway_opt_out', { p_call: this.callId });
      if (r.text) {
        // Speak sentence by sentence: the first one plays while the rest are synthesized, so a long
        // answer starts as fast as a short one. Stop queueing if the customer cuts in.
        const cutsAtStart = this.cuts;
        const parts = speechChunks(r.text);
        for (let i = 0; i < parts.length && this.cuts === cutsAtStart && !this.finished; i++) {
          await this.say(parts[i], false, i === 0 ? started : undefined);
        }
      }
      if (r.end || this.optOut) void this.end('agent');
    } catch (e) {
      log('warn', 'turn failed', { call: this.callId, err: String(e) });
    } finally {
      this.busy = false;
      const next = this.queued;
      this.queued = null;
      if (next && !this.ending) void this.onTurn(next.pcm, next.startMs, next.endMs);
    }
  }

  /** Synthesize and play one agent line, placing it on the timeline after anything still playing. */
  private async say(text: string, cacheable: boolean, turnStarted?: number) {
    const spoken = await speak(text, this.voice, cacheable);
    this.usage.ttsChars += spoken.chars;
    this.usage.providers.add(`tts:${spoken.provider}`);
    if (turnStarted) this.usage.turnLatencies.push(Date.now() - turnStarted);
    if (this.finished) return;
    const now = this.now();
    // anything that has finished playing goes onto the tape in full
    this.pending = this.pending.filter((seg) => {
      const done = seg.startMs + (seg.pcm.length / 8000) * 1000 <= now;
      if (done) this.tape.mix(seg.startMs, seg.pcm);
      return !done;
    });
    const startMs = Math.max(now, this.playEndMs);
    const durMs = (spoken.pcm.length / 8000) * 1000;
    const seq = ++this.seq;
    this.lines.push({ speaker: 'agent', text, seq, start_ms: Math.round(startMs), end_ms: Math.round(startMs + durMs) });
    this.pending.push({ startMs, pcm: spoken.pcm, seq });
    this.playEndMs = startMs + durMs;
    this.send(this.link.play(pcmToMulaw(spoken.pcm)));
  }

  private tick() {
    if (this.ending || this.busy || this.turns.active) return;
    const now = this.now();
    if (now < this.playEndMs + 7000 || now < this.lastHeardMs + 7000) return;
    if (this.nudges >= 2) { void this.end('silence'); return; }
    this.nudges++;
    this.lastHeardMs = now;
    void this.say(NUDGE[this.lang] ?? NUDGE['en-IN'], true);
  }

  private send(frames: string[]) {
    for (const f of frames) if (this.ws.readyState === 1) this.ws.send(f);
  }

  /** Let the last line finish, then hang up through the carrier. */
  async end(reason: 'agent' | 'time' | 'silence') {
    if (this.ending) return;
    this.ending = true;
    const wait = Math.max(0, this.playEndMs - this.now()) + 600;
    setTimeout(() => {
      if (this.carrierCallId) void carriers[this.carrier].hangup(this.carrierCallId);
      else this.ws.close();
    }, reason === 'time' ? 0 : wait);
  }

  /** Socket closed or the carrier said stop: write everything down exactly once. */
  async finish() {
    if (this.finished) return;
    this.finished = true;
    this.timers.forEach((t) => clearTimeout(t));
    live.delete(this.callId);
    const stopAt = Math.min(this.now(), this.playEndMs);
    for (const seg of this.pending) {
      if (seg.startMs >= stopAt) continue;
      this.tape.mix(seg.startMs, seg.pcm.subarray(0, Math.round(((stopAt - seg.startMs) * 8000) / 1000)));
    }
    this.pending = [];
    if (!this.ctx) return;
    try {
      await finishCall({
        callId: this.callId, orgId: this.ctx.call.org_id, campaignId: this.ctx.call.campaign_id, script: this.ctx.script,
        lines: this.lines, durationMs: this.now(), tape: this.tape, usage: this.usage,
        optOut: this.optOut, callback: this.callback, language: this.lang, carrier: this.carrier,
      });
    } catch (e) {
      log('error', 'finish failed', { call: this.callId, err: String(e) });
    }
  }
}
