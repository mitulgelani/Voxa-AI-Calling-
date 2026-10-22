export type CarrierName = 'plivo' | 'telnyx';

export interface DialRequest { callId: string; token: string; from: string; to: string }

/** What a carrier adapter must do. Media framing lives in MediaLink. */
export interface Carrier {
  name: CarrierName;
  configured(): boolean;
  dial(req: DialRequest): Promise<string>;
  hangup(carrierCallId: string): Promise<void>;
  /** Is this number in our account? Used to verify caller IDs. */
  owns(e164: string): Promise<boolean>;
}

/** One carrier media WebSocket, normalised. Audio is always 8 kHz µ-law. */
export interface MediaLink {
  /** Parse one inbound text frame. */
  parse(msg: string): { kind: 'start'; carrierCallId?: string } | { kind: 'media'; audio: Buffer } | { kind: 'stop' } | { kind: 'other' };
  play(mulaw: Buffer): string[];
  clear(): string;
}
