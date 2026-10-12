'use client';

/**
 * CallStudio — the whole call UI and conversation engine.
 *
 * All turn-taking lives in this one component with one set of refs. Audio callbacks
 * (VAD ticks, recorder events, recogniser events, playback events) read refs, never
 * React state, because state captured in those closures goes stale.
 *
 * Phases:
 *   idle → connecting → speaking (greeting) → listening ⇄ thinking → speaking → listening …
 *
 * Human behaviours implemented here:
 *   - Endpointing on 650ms of silence, longer when the caller trails off mid-thought.
 *   - A short bridge ("Mm-hmm.") when the reply is slow, never on every turn.
 *   - Barge-in: the agent pauses the moment the caller talks over it, then decides from
 *     the words whether it was a real interruption (stop, answer) or a nod (resume).
 *   - The agent records only what it actually got to say, marked "(cut off)".
 *   - The caller can keep talking while the agent is thinking; the pending reply is
 *     thrown away and the two halves are merged into one turn.
 *   - Echo gates: louder-than-echo threshold, a cooldown after the agent stops, and a
 *     text comparison against the agent's recent lines.
 *   - Silence check-ins ("you still there?") and a graceful hang-up after a second one.
 *   - The agent ends the call itself when the conversation is over ([END]).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity, AudioLines, Mic, MicOff, Phone, PhoneOff, Radio, Sparkles, Volume2, Zap,
} from 'lucide-react';
import type { Agent, CallRecord, Contact, Turn } from '@/lib/types';
import { VOICES, contactVars, fillTemplate } from '@/lib/types';
import { LANGUAGES, getLanguage, guessCallerLanguage } from '@/lib/languages';
import {
  cleanSpeech, endsWithQuestion, hasEndToken, isBackchannel, isEcho, soundsUnfinished, splitSentences, stripEchoPrefix, words, STOP_WORDS,
} from '@/lib/speech';

// ---- Tuning constants (measured; do not change casually) -------------------------
const ENDPOINT_SILENCE_MS = 650; // silence that ends the caller's turn
const VAD_POLL_MS = 40; // how often the level is inspected
const RECYCLE_SILENCE_MS = 700; // discard recorder audio this stale, so clips stay short
const BRIDGE_LEAD_MS = 100; // when to make the small listening sound after a turn ends
const FILLER_DELAY_MS = 420; // fallback bridge delay once the model call has started
const RESTART_DELAY_MS = 400; // gap before restarting the browser recogniser
const WATCHDOG_MS = 7000; // how often to verify the mic is alive
const BACKCHANNEL_WINDOW_MS = 6000; // window in which "okay" is a nod, not a reply
const BARGE_IN_WORDS = 2; // words needed to interrupt (stop words like "wait"/"ruko" need just one)
const BARGE_SUSTAIN_MS = 320; // an interruption must last this long
const SPEAK_GRACE_MS = 450; // no interruption accepted at the very start of a reply
const ECHO_COOLDOWN_MS = 450; // ignore audio just after the agent stops
const ECHO_FLOOR_MULT = 1.7; // must be this much louder than the agent's own echo
const ECHO_FLOOR_ADD = 0.07; // plus a little, so quiet rooms behave
const AGENT_HISTORY = 3; // compare against this many recent agent lines
const BRIDGES = ['Mm-hmm.', 'Right.', 'Okay.', 'Sure.']; // English defaults; each language has its own

const SPEAKING_LEVEL = 0.08; // the caller is speaking (quiet-room value; adapts to room noise)
const MIN_SPEAKING_LEVEL = 0.05;
const MAX_SPEAKING_LEVEL = 0.18;
const COMMIT_INTERRUPT_MS = 900; // talking over the agent this long is a real interruption, not a nod
const QUIET_BEFORE_SPEAKING_MS = 300; // never start a reply while the caller is still making sound
const HEARING_LEVEL = 0.06; // meter shows "hearing you"
const SOUND_LEVEL = 0.05; // sound present, keep the recorder
const UNFINISHED_ENDPOINT_MS = 1300; // longer pause allowed when the caller trails off
const UNFINISHED_GRACE_MS = 900; // after a trailing-off transcript, wait this long for more
const MIN_UTTERANCE_MS = 140; // shorter than this is a click, not speech
const SILENCE_NUDGE_MS = 9000; // quiet this long → agent checks in
const MAX_NUDGES = 2;
const NO_WORDS_SWITCH_MS = 4500; // browser engine hears sound but no words → switch engine
const PLAYBACK_VOLUME = 0.9;

type Phase = 'idle' | 'connecting' | 'listening' | 'thinking' | 'speaking' | 'ended';
type Engine = 'whisper' | 'browser';
type PlayResult = 'done' | 'interrupted';

interface Props {
  agent: Agent;
  contact?: Contact | null;
  onCallEnd?: (record: CallRecord) => void;
}

interface Latency {
  stt?: number;
  llm?: number;
  tts?: number;
  model?: string;
}

// Minimal Web Speech typings (not in lib.dom for every TS version).
interface SRResult {
  isFinal: boolean;
  0: { transcript: string };
}
interface SREvent {
  results: { length: number; [i: number]: SRResult };
}
interface Recogniser {
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SREvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onstart: (() => void) | null;
}

function getRecogniserCtor(): (new () => Recogniser) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recogniser; webkitSpeechRecognition?: new () => Recogniser };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

function isMobileDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

function pickMime(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  const options = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/ogg'];
  for (const m of options) {
    try {
      if (MediaRecorder.isTypeSupported(m)) return m;
    } catch {
      /* ignore */
    }
  }
  return '';
}

// 0.1s of silence, used to unlock audio playback on iOS inside the user gesture.
const SILENT_WAV =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=';

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function formatClock(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export default function CallStudio({ agent, contact, onCallEnd }: Props) {
  // ---- Render state (UI only) ----
  const [phase, setPhase] = useState<Phase>('idle');
  const [engine, setEngine] = useState<Engine>('whisper');
  const [whisperOk, setWhisperOk] = useState<boolean | null>(null);
  const [browserSupported, setBrowserSupported] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [live, setLive] = useState(''); // interim words while the caller speaks
  const [level, setLevel] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [latency, setLatency] = useState<Latency>({});
  const [elapsed, setElapsed] = useState(0);
  const [keys, setKeys] = useState<{ openrouter: boolean; kie: boolean } | null>(null);

  // ---- Engine refs (read by audio callbacks) ----
  const activeRef = useRef(false);
  const phaseRef = useRef<Phase>('idle');
  const engineRef = useRef<Engine>('whisper');
  const agentRef = useRef(agent);
  const langRef = useRef(getLanguage(agent.language));
  const voiceRef = useRef(agent.voice); // can change mid-call when the caller switches language
  const [liveLang, setLiveLang] = useState(getLanguage(agent.language));
  const callerLangRef = useRef(''); // hint for the model: the caller seems to be speaking this
  const noiseFloorRef = useRef(0.02); // room noise while nobody talks
  const lastHeardAtRef = useRef(0); // last time the caller made a speech-level sound
  const contactRef = useRef(contact);
  const mutedRef = useRef(false);
  const callIdRef = useRef('');
  const startedAtRef = useRef(0);
  const turnsRef = useRef<Turn[]>([]);
  const turnTokenRef = useRef(0);
  const chatAbortRef = useRef<AbortController | null>(null);

  // microphone + VAD
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const bufRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const levelRef = useRef(0);
  const pollRef = useRef<number | null>(null);
  const watchdogRef = useRef<number | null>(null);
  const clockRef = useRef<number | null>(null);
  const speechStartedRef = useRef(false);
  const voiceStartAtRef = useRef(0);
  const lastVoiceAtRef = useRef(0);
  const lastLoudAtRef = useRef(0);
  const silenceSinceRef = useRef(0);
  const nudgesRef = useRef(0);
  const aboveSinceRef = useRef(0); // sustain tracker for barge-in / resume-while-thinking

  // recorder (whisper engine)
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recChunksRef = useRef<Blob[]>([]);
  const recStartedAtRef = useRef(0);
  const mimeRef = useRef('');

  // recogniser (browser engine)
  const recogRef = useRef<Recogniser | null>(null);
  const recogRunningRef = useRef(false);
  const recogRestartRef = useRef<number | null>(null);
  const recogConsumedRef = useRef(0);
  const recogLenRef = useRef(0);
  const recogTextRef = useRef('');
  const recogCarryRef = useRef('');
  const recogLastWordsAtRef = useRef(0);

  // playback
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const bridgeAudioRef = useRef<HTMLAudioElement | null>(null);
  const playResolveRef = useRef<((r: PlayResult) => void) | null>(null);
  const playUrlRef = useRef<string | null>(null);
  const speakStartAtRef = useRef(0);
  const agentStoppedAtRef = useRef(0);
  const echoFloorRef = useRef(0);
  const heldRef = useRef(false); // agent paused because the caller started talking over it
  const bridgeUntilRef = useRef(0);
  const bridgePromiseRef = useRef<Promise<void>>(Promise.resolve());
  const bridgeCacheRef = useRef<Map<string, Blob>>(new Map());
  const lastBridgeTurnRef = useRef(-10);
  const lastBridgeTextRef = useRef('');
  const spokenRef = useRef<string[]>([]); // sentences of the current reply actually played
  const replyRef = useRef<string[] | null>(null); // the reply currently being spoken, if recorded as a turn
  const endAfterSpeakRef = useRef(false);

  // turn merging
  const pendingPrefixRef = useRef('');
  const pendingTimerRef = useRef<number | null>(null);

  useEffect(() => {
    agentRef.current = agent;
    langRef.current = getLanguage(agent.language);
    voiceRef.current = agent.voice;
    setLiveLang(langRef.current);
  }, [agent]);
  useEffect(() => {
    contactRef.current = contact;
  }, [contact]);

  const setPhaseBoth = useCallback((p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  }, []);

  const pushTurn = useCallback((turn: Turn) => {
    turnsRef.current = [...turnsRef.current, turn];
    setTurns(turnsRef.current);
  }, []);

  const patchLastAgentTurn = useCallback((patch: Partial<Turn>) => {
    const list = [...turnsRef.current];
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].role === 'agent') {
        list[i] = { ...list[i], ...patch };
        break;
      }
    }
    turnsRef.current = list;
    setTurns(list);
  }, []);

  const recentAgentLines = useCallback(
    () => turnsRef.current.filter((t) => t.role === 'agent').slice(-AGENT_HISTORY).map((t) => t.text),
    [],
  );

  // ---- Health checks on mount ----
  useEffect(() => {
    setBrowserSupported(Boolean(getRecogniserCtor()));
    setMobile(isMobileDevice());
    let cancelled = false;
    fetch('/api/transcribe', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        const ok = Boolean(d.ok);
        setWhisperOk(ok);
        // Auto pick. Phones: Whisper, because Android's browser recogniser beeps on every
        // start/stop and fights getUserMedia for the mic. Desktop Chrome/Edge/Safari: the
        // browser recogniser, which is silent there, streams words live and is the most accurate.
        const hasBrowser = Boolean(getRecogniserCtor());
        const pick: Engine = isMobileDevice() ? (ok ? 'whisper' : hasBrowser ? 'browser' : 'whisper') : hasBrowser ? 'browser' : 'whisper';
        engineRef.current = pick;
        setEngine(pick);
      })
      .catch(() => !cancelled && setWhisperOk(false));
    fetch('/api/chat', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => !cancelled && setKeys(d))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // ================================================================================
  // TTS + playback
  // ================================================================================
  const fetchTts = useCallback(async (text: string): Promise<Blob | null> => {
    const t0 = performance.now();
    try {
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice: voiceRef.current, rate: agentRef.current.rate }),
      });
      if (!res.ok) throw new Error(`tts ${res.status}`);
      const blob = await res.blob();
      setLatency((l) => ({ ...l, tts: Math.round(performance.now() - t0) }));
      return blob;
    } catch {
      setNotice('Voice service did not answer. Retrying on the next line.');
      return null;
    }
  }, []);

  /** Play through the single audio element. Resolves 'interrupted' if the caller cut in. */
  const playBlob = useCallback((blob: Blob): Promise<PlayResult> => {
    const el = audioRef.current;
    if (!el) return Promise.resolve('done');
    if (playUrlRef.current) URL.revokeObjectURL(playUrlRef.current);
    const url = URL.createObjectURL(blob);
    playUrlRef.current = url;
    return new Promise<PlayResult>((resolve) => {
      let settled = false;
      const finish = (r: PlayResult) => {
        if (settled) return;
        settled = true;
        playResolveRef.current = null;
        el.onended = null;
        el.onerror = null;
        resolve(r);
      };
      playResolveRef.current = finish;
      el.onended = () => finish('done');
      el.onerror = () => finish('done');
      el.src = url;
      el.volume = PLAYBACK_VOLUME;
      el.play().catch(() => {
        setNotice('Your browser blocked audio. Tap anywhere on the page, then speak again.');
        finish('done');
      });
    });
  }, []);

  /** Stop the agent mid-sentence for good. Releases the playback promise so the turn never hangs. */
  const stopPlayback = useCallback(() => {
    const el = audioRef.current;
    if (el) {
      try {
        el.pause();
      } catch {
        /* ignore */
      }
    }
    heldRef.current = false;
    const resolve = playResolveRef.current;
    // Record only what was actually said, synchronously, before any new turn is pushed.
    const reply = replyRef.current;
    if (resolve && reply) {
      const said = spokenRef.current.join(' ') || reply[0].split(/\s+/).slice(0, 4).join(' ');
      patchLastAgentTurn({ text: said, interrupted: true });
    }
    replyRef.current = null;
    if (resolve) resolve('interrupted');
  }, [patchLastAgentTurn]);

  const playBridge = useCallback(async () => {
    const pool = langRef.current.bridges.length ? langRef.current.bridges : BRIDGES;
    const choices = pool.filter((b) => b !== lastBridgeTextRef.current);
    const text = choices[Math.floor(Math.random() * choices.length)];
    const blob = bridgeCacheRef.current.get(text);
    const el = bridgeAudioRef.current;
    if (!blob || !el) return;
    lastBridgeTextRef.current = text;
    lastBridgeTurnRef.current = turnsRef.current.length;
    const url = URL.createObjectURL(blob);
    bridgeUntilRef.current = performance.now() + 900;
    bridgePromiseRef.current = new Promise<void>((resolve) => {
      const done = () => {
        URL.revokeObjectURL(url);
        bridgeUntilRef.current = performance.now() + ECHO_COOLDOWN_MS;
        resolve();
      };
      el.onended = done;
      el.onerror = done;
      el.src = url;
      el.volume = PLAYBACK_VOLUME;
      el.play().catch(done);
    });
    return bridgePromiseRef.current;
  }, []);

  // ================================================================================
  // Recorder (whisper engine)
  // ================================================================================
  const startRecorder = useCallback(() => {
    const stream = streamRef.current;
    if (!stream || engineRef.current !== 'whisper' || typeof MediaRecorder === 'undefined') return;
    try {
      const rec = mimeRef.current ? new MediaRecorder(stream, { mimeType: mimeRef.current }) : new MediaRecorder(stream);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size) chunks.push(e.data);
      };
      recChunksRef.current = chunks;
      rec.start();
      recorderRef.current = rec;
      recStartedAtRef.current = performance.now();
    } catch {
      recorderRef.current = null;
    }
  }, []);

  /** Stop the current recorder and start a fresh one immediately. Returns the old clip. */
  const cutRecorder = useCallback(
    (keep: boolean): Promise<Blob | null> => {
      const rec = recorderRef.current;
      const chunks = recChunksRef.current;
      recorderRef.current = null;
      if (activeRef.current) startRecorder();
      if (!rec || rec.state === 'inactive') return Promise.resolve(null);
      return new Promise<Blob | null>((resolve) => {
        rec.onstop = () => resolve(keep && chunks.length ? new Blob(chunks, { type: rec.mimeType || mimeRef.current }) : null);
        try {
          rec.stop();
        } catch {
          resolve(null);
        }
      });
    },
    [startRecorder],
  );

  const stopRecorderForGood = useCallback(() => {
    const rec = recorderRef.current;
    recorderRef.current = null;
    if (rec && rec.state !== 'inactive') {
      try {
        rec.stop();
      } catch {
        /* ignore */
      }
    }
  }, []);

  // ================================================================================
  // Browser recogniser
  // ================================================================================
  const takeRecogText = useCallback(() => {
    const text = `${recogCarryRef.current} ${recogTextRef.current}`.replace(/\s+/g, ' ').trim();
    recogCarryRef.current = '';
    recogTextRef.current = '';
    recogConsumedRef.current = recogLenRef.current;
    return text;
  }, []);

  const startRecogniser = useCallback(() => {
    if (!activeRef.current || engineRef.current !== 'browser' || recogRunningRef.current) return;
    const Ctor = getRecogniserCtor();
    if (!Ctor) return;
    let rec = recogRef.current;
    if (!rec) {
      rec = new Ctor();
      rec.continuous = true;
      rec.interimResults = true;
      rec.maxAlternatives = 1;
      rec.lang = langRef.current.speech;
      recogRef.current = rec;
    }
    rec.onstart = () => {
      recogRunningRef.current = true;
    };
    rec.onresult = (e: SREvent) => {
      let text = '';
      for (let i = recogConsumedRef.current; i < e.results.length; i++) {
        text += ` ${e.results[i][0].transcript}`;
      }
      recogLenRef.current = e.results.length;
      recogTextRef.current = text.replace(/\s+/g, ' ').trim();
      if (recogTextRef.current) {
        const now = performance.now();
        recogLastWordsAtRef.current = now;
        onBrowserWordsRef.current(recogTextRef.current, now);
      }
    };
    rec.onerror = (e: { error: string }) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed' || e.error === 'audio-capture') {
        setNotice('The browser speech engine is not allowed here. Ending the call.');
        hangUpRef.current('error');
        return;
      }
      if (e.error === 'network') setNotice('Browser speech needs internet. Trying again…');
    };
    rec.onend = () => {
      recogRunningRef.current = false;
      // A new session starts its results from index 0; keep any words we had.
      if (recogTextRef.current) recogCarryRef.current = `${recogCarryRef.current} ${recogTextRef.current}`.trim();
      recogTextRef.current = '';
      recogConsumedRef.current = 0;
      recogLenRef.current = 0;
      if (!activeRef.current || engineRef.current !== 'browser') return;
      // Never restart synchronously inside onend: Chrome throws InvalidStateError and the mic dies.
      if (recogRestartRef.current) window.clearTimeout(recogRestartRef.current);
      recogRestartRef.current = window.setTimeout(() => {
        recogRestartRef.current = null;
        try {
          rec!.start();
        } catch {
          /* watchdog will retry */
        }
      }, RESTART_DELAY_MS);
    };
    try {
      rec.start();
    } catch {
      /* already started */
    }
  }, []);

  const stopRecogniser = useCallback(() => {
    if (recogRestartRef.current) window.clearTimeout(recogRestartRef.current);
    recogRestartRef.current = null;
    const rec = recogRef.current;
    if (rec) {
      rec.onend = null;
      rec.onresult = null;
      rec.onerror = null;
      try {
        rec.abort();
      } catch {
        /* ignore */
      }
    }
    recogRef.current = null;
    recogRunningRef.current = false;
    recogCarryRef.current = '';
    recogTextRef.current = '';
    recogConsumedRef.current = 0;
    recogLenRef.current = 0;
  }, []);

  /**
   * The caller asked for (or simply started speaking) another language. Switch voice (same
   * gender), listening language and bridge sounds without dropping the call.
   */
  const switchLanguage = useCallback(
    (id: string) => {
      const next = getLanguage(id);
      if (next.id === langRef.current.id) return;
      const currentVoice = next.voices.find((v) => v.id === voiceRef.current);
      const gender = LANGUAGES.flatMap((l) => l.voices).find((v) => v.id === voiceRef.current)?.group || 'Female';
      const voice = currentVoice || next.voices.find((v) => v.group === gender) || next.voices[0];
      langRef.current = next;
      voiceRef.current = voice.id;
      setLiveLang(next);
      setNotice(`Switched to ${next.label}.`);
      bridgeCacheRef.current.clear();
      if (engineRef.current === 'browser' && activeRef.current) {
        stopRecogniser();
        startRecogniser();
      }
      void (async () => {
        for (const b of next.bridges) {
          const blob = await fetchTts(b);
          if (blob && langRef.current.id === next.id) bridgeCacheRef.current.set(b, blob);
        }
      })();
    },
    [fetchTts, startRecogniser, stopRecogniser],
  );

  /** Wait until the caller has been quiet briefly, so the agent never starts talking over them. */
  const waitForQuiet = useCallback(async (token: number) => {
    const until = performance.now() + 1500;
    while (performance.now() < until && token === turnTokenRef.current && activeRef.current) {
      if (performance.now() - lastHeardAtRef.current >= QUIET_BEFORE_SPEAKING_MS && !speechStartedRef.current) return;
      await new Promise((r) => window.setTimeout(r, 40));
    }
  }, []);

  // Refs to late-bound functions (avoid dependency cycles between callbacks).
  const onBrowserWordsRef = useRef<(text: string, now: number) => void>(() => undefined);
  const hangUpRef = useRef<(by: CallRecord['endedBy']) => void>(() => undefined);
  const endTurnRef = useRef<() => void>(() => undefined);
  const nudgeRef = useRef<() => void>(() => undefined);
  const resumeWhileThinkingRef = useRef<() => void>(() => undefined);

  // ================================================================================
  // Engine switching
  // ================================================================================
  const switchEngine = useCallback(
    (to: Engine, reason?: string) => {
      if (engineRef.current === to) return;
      engineRef.current = to;
      setEngine(to);
      if (!activeRef.current) return;
      if (to === 'browser') {
        stopRecorderForGood();
        startRecogniser();
      } else {
        stopRecogniser();
        startRecorder();
      }
      if (reason) setNotice(reason);
    },
    [startRecogniser, startRecorder, stopRecogniser, stopRecorderForGood],
  );

  // ================================================================================
  // Speaking a reply
  // ================================================================================
  const speakLines = useCallback(
    async (sentences: string[], token: number, opts: { recordTurn: boolean }) => {
      if (!sentences.length) return;
      const full = sentences.join(' ');
      spokenRef.current = [];
      replyRef.current = null;
      let recorded = false; // the line enters the transcript only once it actually starts playing
      // Discard whatever the recogniser heard before we start talking.
      if (engineRef.current === 'browser') takeRecogText();

      let nextBlob: Promise<Blob | null> = fetchTts(sentences[0]);
      let interrupted = false;
      for (let i = 0; i < sentences.length; i++) {
        const blob = await nextBlob;
        if (i + 1 < sentences.length) nextBlob = fetchTts(sentences[i + 1]);
        if (token !== turnTokenRef.current || !activeRef.current) return;
        if (!blob) continue;
        await bridgePromiseRef.current;
        if (i === 0 || phaseRef.current !== 'speaking') await waitForQuiet(token);
        if (token !== turnTokenRef.current || !activeRef.current) return;
        if (speechStartedRef.current) return; // the caller started talking first: they have the floor
        if (opts.recordTurn && !recorded) {
          pushTurn({ role: 'agent', text: full, at: Date.now() });
          replyRef.current = sentences;
          recorded = true;
        }

        setPhaseBoth('speaking');
        speakStartAtRef.current = performance.now();
        aboveSinceRef.current = 0;
        const result = await playBlob(blob);
        if (result === 'interrupted') {
          interrupted = true;
          break;
        }
        spokenRef.current.push(sentences[i]);
      }
      if (replyRef.current === sentences) replyRef.current = null;
      if (token !== turnTokenRef.current) return;
      agentStoppedAtRef.current = performance.now();
      silenceSinceRef.current = performance.now();
      if (engineRef.current === 'browser' && !interrupted) takeRecogText();
      if (!interrupted && endAfterSpeakRef.current) {
        window.setTimeout(() => hangUpRef.current('agent'), 600);
        return;
      }
      if (phaseRef.current === 'speaking' || phaseRef.current === 'thinking') setPhaseBoth('listening');
    },
    [fetchTts, playBlob, pushTurn, setPhaseBoth, takeRecogText, waitForQuiet],
  );

  // ================================================================================
  // Asking the brain
  // ================================================================================
  const askAgent = useCallback(
    async (callerText: string, event: 'reply' | 'silence' | 'start' = 'reply', utteranceMs = 0) => {
      const token = ++turnTokenRef.current;
      chatAbortRef.current?.abort();
      const controller = new AbortController();
      chatAbortRef.current = controller;

      if (event === 'reply') {
        pushTurn({ role: 'caller', text: callerText, at: Date.now() });
        nudgesRef.current = 0;
      }
      setLive('');
      setPhaseBoth('thinking');

      const a = agentRef.current;
      const history = turnsRef.current.slice(0, event === 'reply' ? -1 : undefined).slice(-8);
      let replied = false;

      // Bridge: only when the reply is slow and only on substantive turns, never twice in a row.
      const turnsSinceBridge = turnsRef.current.length - lastBridgeTurnRef.current;
      const wantsBridge =
        event === 'reply' && !isBackchannel(callerText) && words(callerText).length >= 4 && turnsSinceBridge > 3;
      const bridgeTimer = wantsBridge
        ? window.setTimeout(() => {
            if (!replied && token === turnTokenRef.current && phaseRef.current === 'thinking') void playBridge();
          }, utteranceMs > 1500 ? BRIDGE_LEAD_MS + FILLER_DELAY_MS : FILLER_DELAY_MS + 300)
        : null;

      const t0 = performance.now();
      let reply = '';
      let model = '';
      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: callerText,
            event,
            model: a.model,
            agent: { name: a.name, persona: a.persona, goal: a.goal, brevity: a.brevity, discloseAI: a.discloseAI, language: langRef.current.id },
            callerLanguage: callerLangRef.current || undefined,
            contact: contactVars(contactRef.current),
            history: history.map((t) => ({ role: t.role, text: t.text, interrupted: t.interrupted })),
          }),
        });
        const data = await res.json();
        reply = String(data.reply || '');
        model = String(data.model || '');
        callerLangRef.current = '';
        // The model switched language for the caller: change voice and ears before speaking.
        if (data.language && token === turnTokenRef.current) switchLanguage(String(data.language));
        if (!res.ok && !reply) setNotice(data.error || 'The model did not answer.');
      } catch (error) {
        if ((error as Error).name === 'AbortError') return;
        setNotice('Could not reach the model. Check your connection or API keys.');
      } finally {
        replied = true;
        if (bridgeTimer) window.clearTimeout(bridgeTimer);
      }
      if (token !== turnTokenRef.current || !activeRef.current) return;
      setLatency((l) => ({ ...l, llm: Math.round(performance.now() - t0), model }));

      const end = hasEndToken(reply);
      const spoken = cleanSpeech(reply);
      if (!spoken) {
        if (phaseRef.current === 'thinking') setPhaseBoth('listening');
        if (end) hangUpRef.current('agent');
        else if (event === 'reply') {
          // Never leave dead air: a short honest recovery line.
          await speakLines([langRef.current.sorry], token, { recordTurn: true });
        }
        return;
      }
      endAfterSpeakRef.current = end;
      await speakLines(splitSentences(spoken), token, { recordTurn: true });
    },
    [playBridge, pushTurn, setPhaseBoth, speakLines, switchLanguage],
  );

  // ================================================================================
  // End of the caller's turn
  // ================================================================================
  const finishCallerTurn = useCallback(
    async (rawText: string, utteranceMs: number) => {
      const lastAgent = recentAgentLines().slice(-1)[0] || '';
      const text = stripEchoPrefix(rawText.replace(/\s+/g, ' ').trim(), lastAgent);
      const wasHeld = heldRef.current;
      if (!callerLangRef.current) callerLangRef.current = guessCallerLanguage(text, langRef.current.id);

      // The agent's own voice coming back through the speaker.
      if (text && isEcho(text, recentAgentLines())) {
        if (wasHeld) resumeHeld();
        else if (phaseRef.current !== 'thinking') setPhaseBoth('listening');
        setLive('');
        return;
      }

      if (wasHeld) {
        const w = words(text);
        // "Wait", "stop", "sorry", "no" cut in even when short; a nod or cough does not.
        const urgent = w.some((x) => STOP_WORDS.has(x));
        const real = urgent || (w.length >= BARGE_IN_WORDS && !isBackchannel(text));
        if (!real) {
          // A nod or a cough while the agent talks: carry on speaking.
          resumeHeld();
          setLive('');
          return;
        }
        stopPlayback(); // real interruption: drop the rest of the reply
      }

      if (!text) {
        if (phaseRef.current !== 'thinking') setPhaseBoth('listening');
        setLive('');
        return;
      }

      const merged = `${pendingPrefixRef.current} ${text}`.replace(/\s+/g, ' ').trim();
      pendingPrefixRef.current = '';
      if (pendingTimerRef.current) window.clearTimeout(pendingTimerRef.current);
      pendingTimerRef.current = null;

      // Trailing off ("so I was wondering if..."): give them a moment before answering.
      if (soundsUnfinished(merged)) {
        pendingPrefixRef.current = merged;
        setLive(merged);
        setPhaseBoth('listening');
        pendingTimerRef.current = window.setTimeout(() => {
          pendingTimerRef.current = null;
          if (!activeRef.current || speechStartedRef.current) return;
          const held = pendingPrefixRef.current;
          pendingPrefixRef.current = '';
          if (held) void askAgent(held, 'reply', utteranceMs);
        }, UNFINISHED_GRACE_MS);
        return;
      }
      await askAgent(merged, 'reply', utteranceMs);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [askAgent, recentAgentLines, setPhaseBoth, stopPlayback],
  );

  /** Continue the agent's sentence after a false-alarm barge-in. */
  function resumeHeld() {
    heldRef.current = false;
    const el = audioRef.current;
    if (el && playResolveRef.current) {
      setPhaseBoth('speaking');
      speakStartAtRef.current = performance.now() - SPEAK_GRACE_MS; // no extra grace on resume
      el.play().catch(() => playResolveRef.current?.('done'));
    } else {
      setPhaseBoth('listening');
    }
  }

  const endTurn = useCallback(async () => {
    const utteranceMs = lastVoiceAtRef.current - voiceStartAtRef.current;
    speechStartedRef.current = false;
    aboveSinceRef.current = 0;

    if (utteranceMs < MIN_UTTERANCE_MS) {
      if (heldRef.current) {
        if (engineRef.current === 'whisper') void cutRecorder(false);
        resumeHeld();
      }
      return;
    }

    if (engineRef.current === 'browser') {
      const text = takeRecogText();
      await finishCallerTurn(text, utteranceMs);
      return;
    }

    // Whisper engine: cut the clip, start a fresh recorder at once, transcribe.
    const blob = await cutRecorder(true);
    if (!blob || blob.size < 1200) {
      await finishCallerTurn('', utteranceMs);
      return;
    }
    const token = turnTokenRef.current;
    if (!heldRef.current) setPhaseBoth('thinking');
    const t0 = performance.now();
    try {
      // Let Whisper notice a switch: English for every other language, Hindi for Indian English.
      const lang = langRef.current;
      const alt = lang.whisper !== 'en' ? 'en' : lang.id === 'en-IN' ? 'hi' : '';
      const res = await fetch(`/api/transcribe?lang=${lang.whisper}${alt ? `&alt=${alt}` : ''}`, {
        method: 'POST',
        headers: { 'Content-Type': blob.type || 'application/octet-stream' },
        body: blob,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `stt ${res.status}`);
      setLatency((l) => ({ ...l, stt: Math.round(performance.now() - t0) }));
      if (!activeRef.current) return;
      // Hinglish callers mix in English all the time; that is not a switch, so no hint there.
      if (data.language && data.language !== langRef.current.whisper && data.text && langRef.current.id !== 'hinglish') {
        const heard = data.language === 'en' && /-IN$|hinglish/.test(langRef.current.id) ? getLanguage('en-IN') : LANGUAGES.find((l) => l.whisper === data.language);
        if (heard) callerLangRef.current = heard.label;
      }
      // A newer turn already started (caller kept talking): fold this text into it.
      if (token !== turnTokenRef.current) {
        pendingPrefixRef.current = `${pendingPrefixRef.current} ${data.text || ''}`.trim();
        return;
      }
      if (speechStartedRef.current && !heldRef.current) {
        // Caller resumed talking while we transcribed: hold this text as the start of their turn.
        pendingPrefixRef.current = `${pendingPrefixRef.current} ${data.text || ''}`.trim();
        setLive(pendingPrefixRef.current);
        setPhaseBoth('listening');
        return;
      }
      await finishCallerTurn(String(data.text || ''), utteranceMs);
    } catch {
      if (getRecogniserCtor()) {
        switchEngine('browser', 'Local speech service is not responding, switched to browser speech.');
      } else {
        setNotice('Speech service is not responding. Check the Whisper service.');
      }
      if (heldRef.current) resumeHeld();
      else setPhaseBoth('listening');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cutRecorder, finishCallerTurn, setPhaseBoth, switchEngine, takeRecogText]);

  // Caller started talking again while the agent was still thinking: drop the pending reply.
  const resumeWhileThinking = useCallback(() => {
    turnTokenRef.current++;
    chatAbortRef.current?.abort();
    const list = turnsRef.current;
    const last = list[list.length - 1];
    if (last && last.role === 'caller') {
      pendingPrefixRef.current = `${last.text} ${pendingPrefixRef.current}`.trim();
      turnsRef.current = list.slice(0, -1);
      setTurns(turnsRef.current);
    }
    setLive(pendingPrefixRef.current);
    setPhaseBoth('listening');
  }, [setPhaseBoth]);

  const nudge = useCallback(() => {
    nudgesRef.current += 1;
    silenceSinceRef.current = performance.now();
    if (nudgesRef.current > MAX_NUDGES) {
      hangUpRef.current('agent');
      return;
    }
    void askAgent('', 'silence');
  }, [askAgent]);

  // Browser engine: words while the agent is talking decide barge-in.
  const onBrowserWords = useCallback((text: string, now: number) => {
    const p = phaseRef.current;
    const echo = isEcho(text, recentAgentLines());
    if (!echo) lastHeardAtRef.current = now;
    const w = words(text);
    const urgent = w.some((x) => STOP_WORDS.has(x));
    if (p === 'listening' && heldRef.current && !echo && (urgent || (w.length >= BARGE_IN_WORDS && !isBackchannel(text)))) {
      stopPlayback(); // paused for them and they are really talking: drop the rest of the sentence
    }
    if (p === 'listening' || p === 'thinking') {
      if (!speechStartedRef.current && !echo && now - agentStoppedAtRef.current > ECHO_COOLDOWN_MS) {
        speechStartedRef.current = true;
        voiceStartAtRef.current = now;
      }
      if (speechStartedRef.current) {
        lastVoiceAtRef.current = Math.max(lastVoiceAtRef.current, now);
        setLive(`${pendingPrefixRef.current} ${text}`.trim());
      }
      if (p === 'thinking' && speechStartedRef.current && words(text).length >= 2) resumeWhileThinkingRef.current();
      return;
    }
    if (p === 'speaking' && !heldRef.current) {
      if (now - speakStartAtRef.current < SPEAK_GRACE_MS) return;
      if (echo || (isBackchannel(text) && !urgent)) return;
      if (urgent || w.length >= BARGE_IN_WORDS) {
        // Clear interruption: stop now, the words are already here.
        stopPlayback();
        speechStartedRef.current = true;
        voiceStartAtRef.current = now;
        lastVoiceAtRef.current = now;
        setLive(text);
        setPhaseBoth('listening');
      }
    }
  }, [recentAgentLines, setPhaseBoth, stopPlayback]);

  // ================================================================================
  // VAD tick — the heart of turn-taking
  // ================================================================================
  const tick = useCallback(() => {
    const analyser = analyserRef.current;
    const buf = bufRef.current;
    if (!analyser || !buf || !activeRef.current) return;

    // Level from time-domain data (frequency data reads ~0 for speech).
    analyser.getByteTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = (buf[i] - 128) / 128;
      sum += v * v;
    }
    const raw = Math.min(1, Math.sqrt(sum / buf.length) * 5);
    const lvl = mutedRef.current ? 0 : levelRef.current * 0.5 + raw * 0.5;
    levelRef.current = lvl;
    setLevel(lvl);

    const now = performance.now();
    const p = phaseRef.current;
    // Speech threshold adapts to the room: a little above the background noise, within bounds.
    const speakLvl = Math.min(MAX_SPEAKING_LEVEL, Math.max(MIN_SPEAKING_LEVEL, noiseFloorRef.current * 2 + 0.035));
    const gate = Math.max(speakLvl, echoFloorRef.current * ECHO_FLOOR_MULT + ECHO_FLOOR_ADD);

    // ---- Agent is talking: track the echo floor and watch for barge-in ----
    if (p === 'speaking' && !heldRef.current) {
      if (lvl < gate) {
        // Below the gate while the agent talks = its own echo. Learn its loudness.
        echoFloorRef.current = echoFloorRef.current * 0.9 + lvl * 0.1;
        aboveSinceRef.current = 0;
      } else if (now - speakStartAtRef.current > SPEAK_GRACE_MS) {
        lastLoudAtRef.current = now;
        if (!aboveSinceRef.current) aboveSinceRef.current = now;
        else if (now - aboveSinceRef.current >= BARGE_SUSTAIN_MS) {
          // Pause like a person would, then decide from the words.
          heldRef.current = true;
          audioRef.current?.pause();
          speechStartedRef.current = true;
          voiceStartAtRef.current = aboveSinceRef.current;
          lastVoiceAtRef.current = now;
          aboveSinceRef.current = 0;
          setPhaseBoth('listening');
        }
      }
      // Keep recorder clips short while nobody is talking over the agent.
      if (engineRef.current === 'whisper' && now - lastLoudAtRef.current > RECYCLE_SILENCE_MS && now - recStartedAtRef.current > RECYCLE_SILENCE_MS) {
        void cutRecorder(false);
      }
      return;
    }

    // While the agent pauses for a barge-in, its echo is gone; use the plain threshold.
    const inCooldown = now - agentStoppedAtRef.current < ECHO_COOLDOWN_MS || now < bridgeUntilRef.current;
    const threshold = heldRef.current ? speakLvl : inCooldown ? Infinity : speakLvl;
    const voiced = lvl > threshold;
    if (voiced) lastHeardAtRef.current = now;
    // Learn the room's background noise while nobody is talking.
    if (p === 'listening' && !speechStartedRef.current && !inCooldown && lvl < speakLvl) {
      noiseFloorRef.current = noiseFloorRef.current * 0.98 + lvl * 0.02;
    }

    if (lvl > SOUND_LEVEL && !inCooldown) lastLoudAtRef.current = now;
    if (!speechStartedRef.current && !heldRef.current) echoFloorRef.current *= 0.97;

    if (p === 'thinking') {
      // Caller keeps talking (sustained) while we wait for the model: they were not done.
      if (voiced) {
        if (!aboveSinceRef.current) aboveSinceRef.current = now;
        else if (now - aboveSinceRef.current >= BARGE_SUSTAIN_MS && !heldRef.current) {
          speechStartedRef.current = true;
          voiceStartAtRef.current = aboveSinceRef.current;
          lastVoiceAtRef.current = now;
          aboveSinceRef.current = 0;
          resumeWhileThinkingRef.current();
        }
      } else aboveSinceRef.current = 0;
      return;
    }

    if (p !== 'listening') return;

    // Paused for the caller and they keep talking: it is a real interruption. Drop the rest of
    // the agent's sentence now; the caller has the floor.
    if (heldRef.current && speechStartedRef.current && now - voiceStartAtRef.current > COMMIT_INTERRUPT_MS) {
      stopPlayback();
    }

    if (voiced) {
      if (!speechStartedRef.current) {
        speechStartedRef.current = true;
        voiceStartAtRef.current = now;
        if (pendingTimerRef.current) {
          window.clearTimeout(pendingTimerRef.current);
          pendingTimerRef.current = null;
        }
      }
      lastVoiceAtRef.current = now;
      silenceSinceRef.current = now;
    }

    // Recycle the recorder while silent, so each clip holds just the utterance.
    if (
      engineRef.current === 'whisper' &&
      !speechStartedRef.current &&
      !pendingPrefixRef.current &&
      now - lastLoudAtRef.current > RECYCLE_SILENCE_MS &&
      now - recStartedAtRef.current > RECYCLE_SILENCE_MS
    ) {
      void cutRecorder(false);
    }

    // Browser engine: sound but no words for too long → the recogniser is deaf; switch.
    if (
      engineRef.current === 'browser' &&
      speechStartedRef.current &&
      now - voiceStartAtRef.current > NO_WORDS_SWITCH_MS &&
      now - recogLastWordsAtRef.current > NO_WORDS_SWITCH_MS &&
      whisperOkRef.current
    ) {
      speechStartedRef.current = false;
      switchEngine('whisper', 'Browser speech was not picking up words, switched to local Whisper. Please say that again.');
      return;
    }

    if (speechStartedRef.current) {
      const pending = engineRef.current === 'browser' ? `${recogCarryRef.current} ${recogTextRef.current}` : pendingPrefixRef.current;
      const endpoint = soundsUnfinished(pending) ? UNFINISHED_ENDPOINT_MS : ENDPOINT_SILENCE_MS;
      if (now - lastVoiceAtRef.current >= endpoint) {
        void endTurnRef.current();
      }
      return;
    }

    // Long silence: the agent checks in, like a person would.
    if (!mutedRef.current && !pendingPrefixRef.current && now - silenceSinceRef.current > SILENCE_NUDGE_MS) {
      nudgeRef.current();
    }
  }, [cutRecorder, setPhaseBoth, stopPlayback, switchEngine]);

  const whisperOkRef = useRef(false);
  useEffect(() => {
    whisperOkRef.current = Boolean(whisperOk);
  }, [whisperOk]);

  // Keep late-bound refs current.
  useEffect(() => {
    onBrowserWordsRef.current = onBrowserWords;
    endTurnRef.current = () => void endTurn();
    nudgeRef.current = nudge;
    resumeWhileThinkingRef.current = resumeWhileThinking;
  });

  // ================================================================================
  // Microphone
  // ================================================================================
  const openMic = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    streamRef.current = stream;
    let ctx = ctxRef.current;
    if (!ctx || ctx.state === 'closed') {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctx = new Ctx();
      ctxRef.current = ctx;
    }
    if (ctx.state === 'suspended') await ctx.resume().catch(() => undefined);
    sourceRef.current?.disconnect();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0;
    source.connect(analyser);
    sourceRef.current = source;
    analyserRef.current = analyser;
    bufRef.current = new Uint8Array(analyser.fftSize);
    stream.getAudioTracks().forEach((t) => (t.enabled = !mutedRef.current));
  }, []);

  const closeMic = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    try {
      sourceRef.current?.disconnect();
    } catch {
      /* ignore */
    }
    sourceRef.current = null;
    analyserRef.current = null;
  }, []);

  const watchdog = useCallback(async () => {
    if (!activeRef.current) return;
    const track = streamRef.current?.getAudioTracks()[0];
    if (!track || track.readyState === 'ended') {
      try {
        stopRecorderForGood();
        await openMic();
        if (engineRef.current === 'whisper') startRecorder();
        setNotice('Microphone reconnected.');
      } catch {
        setNotice('Lost the microphone. Check permissions and reconnect.');
      }
    }
    if (ctxRef.current?.state === 'suspended') ctxRef.current.resume().catch(() => undefined);
    if (engineRef.current === 'whisper' && (!recorderRef.current || recorderRef.current.state === 'inactive')) startRecorder();
    if (engineRef.current === 'browser' && !recogRunningRef.current && !recogRestartRef.current) startRecogniser();
  }, [openMic, startRecogniser, startRecorder, stopRecorderForGood]);

  // ================================================================================
  // Call lifecycle
  // ================================================================================
  const prefetchBridges = useCallback(async () => {
    for (const b of langRef.current.bridges.length ? langRef.current.bridges : BRIDGES) {
      if (bridgeCacheRef.current.has(b)) continue;
      const blob = await fetchTts(b);
      if (blob) bridgeCacheRef.current.set(b, blob);
    }
  }, [fetchTts]);

  const startCall = useCallback(async () => {
    if (activeRef.current) return;
    setNotice(null);
    setTurns([]);
    setLive('');
    setLatency({});
    turnsRef.current = [];
    pendingPrefixRef.current = '';
    nudgesRef.current = 0;
    endAfterSpeakRef.current = false;
    heldRef.current = false;
    echoFloorRef.current = 0;
    lastBridgeTurnRef.current = -10;
    callIdRef.current = uid();
    setPhaseBoth('connecting');

    // Unlock playback inside the user gesture (iOS / Safari).
    for (const el of [audioRef.current, bridgeAudioRef.current]) {
      if (!el) continue;
      el.src = SILENT_WAV;
      el.play().catch(() => undefined);
    }

    const a = agentRef.current;
    const greeting = cleanSpeech(fillTemplate(a.greeting || '', contactVars(contactRef.current)));
    const greetingSentences = greeting ? splitSentences(greeting) : [];
    // Start synthesising the greeting while the mic permission prompt is open.
    const greetingBlob = greetingSentences.length ? fetchTts(greetingSentences.join(' ')) : null;

    try {
      await openMic();
    } catch {
      setNotice('Microphone permission is needed for a call.');
      setPhaseBoth('idle');
      return;
    }
    mimeRef.current = pickMime();
    if (engineRef.current === 'whisper' && !mimeRef.current && typeof MediaRecorder === 'undefined') {
      if (getRecogniserCtor()) switchEngine('browser');
    }

    activeRef.current = true;
    startedAtRef.current = Date.now();
    setElapsed(0);
    if (engineRef.current === 'whisper') startRecorder();
    else startRecogniser();

    pollRef.current = window.setInterval(tick, VAD_POLL_MS);
    watchdogRef.current = window.setInterval(() => void watchdog(), WATCHDOG_MS);
    clockRef.current = window.setInterval(() => setElapsed(Date.now() - startedAtRef.current), 500);
    void prefetchBridges();

    const token = ++turnTokenRef.current;
    if (greetingBlob) {
      const blob = await greetingBlob;
      if (!activeRef.current || token !== turnTokenRef.current) return;
      pushTurn({ role: 'agent', text: greetingSentences.join(' '), at: Date.now() });
      if (blob) {
        setPhaseBoth('speaking');
        speakStartAtRef.current = performance.now();
        spokenRef.current = [];
        replyRef.current = greetingSentences;
        await playBlob(blob);
        replyRef.current = null;
      }
      if (token === turnTokenRef.current && phaseRef.current === 'speaking') setPhaseBoth('listening');
      agentStoppedAtRef.current = performance.now();
      silenceSinceRef.current = performance.now();
    } else {
      await askAgent('', 'start');
    }
  }, [askAgent, fetchTts, openMic, playBlob, prefetchBridges, pushTurn, setPhaseBoth, startRecogniser, startRecorder, switchEngine, tick, watchdog]);

  const hangUp = useCallback(
    (by: CallRecord['endedBy']) => {
      if (!activeRef.current) return;
      activeRef.current = false;
      turnTokenRef.current++;
      chatAbortRef.current?.abort();
      stopPlayback();
      bridgeAudioRef.current?.pause();
      for (const r of [pollRef, watchdogRef, clockRef]) {
        if (r.current) window.clearInterval(r.current);
        r.current = null;
      }
      if (pendingTimerRef.current) window.clearTimeout(pendingTimerRef.current);
      pendingTimerRef.current = null;
      stopRecorderForGood();
      stopRecogniser();
      closeMic();
      speechStartedRef.current = false;
      setLevel(0);
      setLive('');
      setPhaseBoth('ended');

      const record: CallRecord = {
        id: callIdRef.current,
        agentId: agentRef.current.id,
        agentName: agentRef.current.name,
        contactId: contactRef.current?.id,
        contactName: contactRef.current?.name,
        startedAt: startedAtRef.current,
        endedAt: Date.now(),
        turns: turnsRef.current,
        endedBy: by,
      };
      if (record.turns.length) onCallEnd?.(record);
    },
    [closeMic, onCallEnd, setPhaseBoth, stopPlayback, stopRecogniser, stopRecorderForGood],
  );

  useEffect(() => {
    hangUpRef.current = hangUp;
  }, [hangUp]);

  // Clean up if the component unmounts mid-call.
  useEffect(() => () => hangUpRef.current('caller'), []);

  const toggleMute = () => {
    const next = !mutedRef.current;
    mutedRef.current = next;
    setMuted(next);
    streamRef.current?.getAudioTracks().forEach((t) => (t.enabled = !next));
    silenceSinceRef.current = performance.now();
  };

  // ================================================================================
  // UI
  // ================================================================================
  const inCall = phase !== 'idle' && phase !== 'ended';
  const liveVoice = VOICES.find((v) => v.id === voiceRef.current) || VOICES.find((v) => v.id === agent.voice);
  const statusText: Record<Phase, string> = {
    idle: 'Ready when you are',
    connecting: 'Connecting…',
    listening: muted ? 'You are muted' : level > HEARING_LEVEL ? 'Hearing you…' : 'Listening',
    thinking: 'Thinking…',
    speaking: `${agent.name} is speaking`,
    ended: 'Call ended',
  };
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight, behavior: 'smooth' });
  }, [turns, live]);

  const noBrain = keys && !keys.openrouter && !keys.kie;

  return (
    <div className="studio">
      <audio ref={audioRef} preload="auto" playsInline />
      <audio ref={bridgeAudioRef} preload="auto" playsInline />

      <section className="stage card">
        <div className="stage-top">
          <div>
            <div className="eyebrow">{contact ? `Calling ${contact.name}` : 'Playground call'}</div>
            <h2 className="stage-title">{agent.name}</h2>
            <div className="muted small">
              {liveLang.label} · {liveVoice ? `${liveVoice.label}, ${liveVoice.tone}` : voiceRef.current}
            </div>
          </div>
          <div className="clock">{inCall ? formatClock(elapsed) : '00:00'}</div>
        </div>

        <div className={`orb-wrap phase-${phase}`}>
          <div className="orb" style={{ ['--lvl' as string]: String(phase === 'listening' ? level : 0) }}>
            <div className="orb-core">
              {phase === 'speaking' ? <AudioLines size={34} /> : phase === 'thinking' ? <Sparkles size={34} /> : <Mic size={34} />}
            </div>
          </div>
        </div>

        <div className="status-line" aria-live="polite">{statusText[phase]}</div>
        <div className="meter" aria-hidden>
          <div className="meter-fill" style={{ width: `${Math.round(Math.min(1, level * 2.2) * 100)}%` }} />
        </div>

        <div className="call-controls">
          {inCall ? (
            <>
              <button className={`round-btn ${muted ? 'on' : ''}`} onClick={toggleMute} aria-label={muted ? 'Unmute' : 'Mute'}>
                {muted ? <MicOff size={22} /> : <Mic size={22} />}
              </button>
              <button className="call-btn hang" onClick={() => hangUp('caller')}>
                <PhoneOff size={22} /> End call
              </button>
            </>
          ) : (
            <button className="call-btn" onClick={() => void startCall()} disabled={Boolean(noBrain)}>
              <Phone size={22} /> {phase === 'ended' ? 'Call again' : 'Start call'}
            </button>
          )}
        </div>

        {noBrain && <div className="notice warn">No model key found. Add OPENROUTER_API_KEY or KIE_API_KEY to .env and restart.</div>}
        {notice && (
          <div className="notice" onClick={() => setNotice(null)} role="status">
            {notice}
          </div>
        )}

        <div className="engine-row">
          <span className="muted small">Listening engine</span>
          <div className="seg">
            <button
              className={engine === 'whisper' ? 'active' : ''}
              onClick={() => switchEngine('whisper')}
              disabled={whisperOk === false}
              title={whisperOk === false ? 'Local Whisper service is offline' : 'Private, runs on your server'}
            >
              <Radio size={14} /> Whisper
            </button>
            <button
              className={engine === 'browser' ? 'active' : ''}
              onClick={() => switchEngine('browser')}
              disabled={!browserSupported}
              title={browserSupported ? 'Faster, Chrome/Edge/Safari' : 'Not supported in this browser'}
            >
              <Zap size={14} /> Browser
            </button>
          </div>
        </div>
        {engine === 'browser' && mobile && (
          <div className="muted tiny hint">Phones play a short beep whenever browser listening restarts. Whisper listens silently.</div>
        )}
        <div className="latency">
          <Activity size={13} />
          <span>STT {latency.stt != null ? `${latency.stt}ms` : engine === 'browser' ? 'live' : '—'}</span>
          <span>LLM {latency.llm != null ? `${latency.llm}ms` : '—'}</span>
          <span>TTS {latency.tts != null ? `${latency.tts}ms` : '—'}</span>
          {latency.model && <span className="muted">{latency.model.replace(/^(or|kie):/, '')}</span>}
        </div>
        <div className="muted tiny hint">
          <Volume2 size={12} /> Headphones give the cleanest calls. On speakerphone, the agent filters its own echo.
        </div>
      </section>

      <section className="transcript card">
        <div className="card-head">
          <h3>Live transcript</h3>
          <span className="muted small">{turns.length ? `${turns.length} lines` : ''}</span>
        </div>
        <div className="lines" ref={transcriptRef}>
          {!turns.length && !live && (
            <div className="empty">
              Press <b>Start call</b> and just talk. No buttons between turns: pause and {agent.name} answers, talk over
              {` ${agent.name}`} to interrupt.
            </div>
          )}
          {turns.map((t, i) => (
            <div key={i} className={`line ${t.role}`}>
              <div className="who">{t.role === 'agent' ? agent.name : contact?.name || 'You'}</div>
              <div className="bubble">
                {t.text}
                {t.interrupted && <span className="cut"> — cut off</span>}
              </div>
            </div>
          ))}
          {live && (
            <div className="line caller live">
              <div className="who">{contact?.name || 'You'}</div>
              <div className="bubble">{live}…</div>
            </div>
          )}
          {phase === 'thinking' && (
            <div className="line agent">
              <div className="who">{agent.name}</div>
              <div className="bubble typing"><i /><i /><i /></div>
            </div>
          )}
        </div>
        {endsWithQuestion(turns[turns.length - 1]?.text || '') && phase === 'listening' && (
          <div className="muted tiny pad">Waiting for your answer…</div>
        )}
      </section>
    </div>
  );
}
