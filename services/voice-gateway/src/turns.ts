import { rms } from './audio.js';

/**
 * Turn detection on 8 kHz caller audio, ported from the browser engine:
 * an adaptive noise floor, speech when energy clears it, and a turn ends after 650 ms of quiet.
 */
export class TurnDetector {
  private floor = 0.004;
  private speaking = false;
  private speechMs = 0;
  private quietMs = 0;
  private buf: Int16Array[] = [];
  private startedAt = 0;
  constructor(
    private onStart: (atMs: number) => void,
    private onEnd: (pcm: Int16Array, startMs: number, endMs: number) => void,
    private endpointMs = 650,
  ) {}

  private lead: Int16Array[] = [];

  /** Feed one frame (usually 20 ms). `atMs` is the frame's position on the call timeline. */
  push(frame: Int16Array, atMs: number, agentTalking: boolean) {
    const ms = (frame.length / 8000) * 1000;
    const level = rms(frame);
    // While the agent talks, require more energy: carriers leak some echo back.
    const threshold = Math.max(0.012, this.floor * (agentTalking ? 4.5 : 3));
    const loud = level > threshold;
    if (!this.speaking) {
      this.lead.push(frame);
      if (this.lead.length > 25) this.lead.shift(); // 500 ms of lead-in
      if (loud) {
        this.speechMs += ms;
        if (this.speechMs >= (agentTalking ? 180 : 100)) {
          this.speaking = true;
          this.quietMs = 0;
          this.buf = this.lead.slice(-Math.min(this.lead.length, Math.round(this.speechMs / ms) + 10));
          this.lead = [];
          this.startedAt = Math.max(0, atMs + ms - this.speechMs);
          this.onStart(this.startedAt);
        }
      } else {
        this.speechMs = Math.max(0, this.speechMs - ms);
        this.floor = this.floor * 0.98 + Math.min(level, 0.05) * 0.02;
      }
      return;
    }
    this.buf.push(frame);
    this.quietMs = loud ? 0 : this.quietMs + ms;
    const total = this.buf.reduce((s, b) => s + b.length, 0);
    if (this.quietMs >= this.endpointMs || total > 8000 * 25) {
      const pcm = new Int16Array(total);
      let o = 0;
      for (const b of this.buf) { pcm.set(b, o); o += b.length; }
      const endMs = atMs + ms - this.quietMs;
      this.speaking = false; this.speechMs = 0; this.quietMs = 0; this.buf = [];
      this.onEnd(pcm, this.startedAt, endMs);
    }
  }
  get active() { return this.speaking; }
}
