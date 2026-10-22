'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Mic, MicOff, Phone, PhoneOff, Share2, Check, Radio, Zap } from 'lucide-react';
import { useCallEngine, type CallPersona, type Phase } from '@/lib/voice/useCallEngine';
import { ALL_VOICES } from '@/lib/voice/languages';
import { LineMonitor } from './LineMonitor';

function clock(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const STATUS: Record<Phase, string> = {
  idle: 'Ready to call',
  connecting: 'Connecting',
  listening: 'Listening',
  thinking: 'Thinking',
  speaking: 'Speaking',
  ended: 'Call ended',
};

export function CallRoom({ persona, slug, shareUrl }: { persona: CallPersona & { tagline?: string }; slug: string; shareUrl?: string }) {
  const call = useCallEngine(persona, slug);
  const inCall = call.phase !== 'idle' && call.phase !== 'ended';
  const startedAt = useRef(0);
  const voice = ALL_VOICES.find((v) => v.id === call.liveVoiceId);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (call.phase === 'connecting') startedAt.current = Date.now();
  }, [call.phase]);

  const listRef = useRef<HTMLOListElement | null>(null);
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [call.turns, call.live]);

  const status = useMemo(() => {
    if (call.phase === 'listening' && call.muted) return 'You are muted';
    if (call.phase === 'listening' && call.hearing) return 'Hearing you';
    if (call.phase === 'speaking') return `${persona.name} is speaking`;
    return STATUS[call.phase];
  }, [call.phase, call.muted, call.hearing, persona.name]);

  const share = async () => {
    const url = shareUrl || (typeof window !== 'undefined' ? window.location.href : '');
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt('Copy this link', url);
    }
  };

  const lowTime = call.secondsLeft !== null && inCall && call.secondsLeft <= 30;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
      <audio ref={call.audioRef} preload="auto" playsInline />
      <audio ref={call.bridgeAudioRef} preload="auto" playsInline />

      {/* The line: identity, live monitor, controls */}
      <section className="surface relative overflow-hidden p-6 sm:p-8" aria-label="Call">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="font-display text-4xl leading-none sm:text-5xl">{persona.name}</h1>
            {persona.tagline ? <p className="mt-3 max-w-md text-ink-2">{persona.tagline}</p> : null}
            <p className="mt-3 text-sm text-ink-3">
              {call.liveLang.label}
              {call.liveLang.native !== call.liveLang.label && call.liveLang.native !== 'English' ? (
                <span className="indic"> ({call.liveLang.native})</span>
              ) : null}
              {voice ? `, voice ${voice.label}` : ''}
            </p>
          </div>
          <div className={`tnum shrink-0 rounded-full border px-3 py-1 text-sm ${lowTime ? 'border-warn/60 text-warn' : 'border-line-2 text-ink-2'}`} aria-live="polite">
            {inCall ? clock(call.elapsed) : '0:00'}
            {call.secondsLeft !== null && inCall ? <span className="text-ink-3"> / {clock(call.secondsLeft * 1000 + call.elapsed)}</span> : null}
          </div>
        </div>

        <div className="mt-8">
          <LineMonitor phase={call.phase} level={call.level} />
          <div className="mt-3 flex items-center gap-2 text-sm" aria-live="polite">
            {inCall ? <span className="lamp-dot" aria-hidden /> : <span className="h-2 w-2 rounded-full bg-ink-3/50" aria-hidden />}
            <span className={inCall ? 'text-ink' : 'text-ink-2'}>{status}</span>
          </div>
        </div>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          {inCall ? (
            <>
              <button type="button" className="btn bg-fail/90 text-white hover:bg-fail" onClick={call.hangUp}>
                <PhoneOff size={18} aria-hidden /> End call
              </button>
              <button type="button" className={`btn btn-quiet ${call.muted ? '!border-warn !text-warn' : ''}`} onClick={call.toggleMute} aria-pressed={call.muted}>
                {call.muted ? <MicOff size={18} aria-hidden /> : <Mic size={18} aria-hidden />} {call.muted ? 'Unmute' : 'Mute'}
              </button>
            </>
          ) : (
            <button type="button" className="btn btn-lamp min-h-[54px] px-7 text-base" onClick={() => void call.startCall()}>
              <Phone size={19} aria-hidden /> {call.phase === 'ended' ? 'Call again' : 'Start call'}
            </button>
          )}
          <button type="button" className="btn btn-quiet btn-sm ml-auto" onClick={share}>
            {copied ? <Check size={16} aria-hidden /> : <Share2 size={16} aria-hidden />} {copied ? 'Link copied' : 'Share link'}
          </button>
        </div>

        {call.notice ? (
          <p role="status" className="mt-5 rounded-xl border border-line-2 bg-panel-2 px-4 py-3 text-sm text-ink-2">
            {call.notice}
          </p>
        ) : null}

        <details className="mt-6 text-sm text-ink-3">
          <summary className="cursor-pointer select-none hover:text-ink-2">Call quality details</summary>
          <div className="mt-3 grid gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span>Listening with</span>
              <div className="inline-flex rounded-full border border-line p-0.5">
                <button type="button" onClick={() => call.switchEngine('whisper')} className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 ${call.engine === 'whisper' ? 'bg-panel-2 text-ink' : ''}`}>
                  <Radio size={13} aria-hidden /> Cloud Whisper
                </button>
                <button type="button" disabled={!call.browserSupported} onClick={() => call.switchEngine('browser')} className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 disabled:opacity-40 ${call.engine === 'browser' ? 'bg-panel-2 text-ink' : ''}`}>
                  <Zap size={13} aria-hidden /> Browser
                </button>
              </div>
            </div>
            <p className="tnum">
              Last turn: hearing {call.latency.stt != null ? `${call.latency.stt} ms` : '–'}, thinking {call.latency.llm != null ? `${call.latency.llm} ms` : '–'}, voice {call.latency.tts != null ? `${call.latency.tts} ms` : '–'}
            </p>
            <p>Headphones give the cleanest call. On speaker, the agent filters out its own voice.</p>
          </div>
        </details>
      </section>

      {/* Transcript with timecodes: the evidence motif */}
      <section className="surface flex min-h-[380px] flex-col p-5 sm:p-6 lg:max-h-[640px]" aria-label="Transcript">
        <div className="flex items-baseline justify-between">
          <h2 className="font-display text-xl">Transcript</h2>
          <span className="text-sm text-ink-3">{call.turns.length ? `${call.turns.length} lines` : ''}</span>
        </div>
        <ol ref={listRef} className="mt-4 flex flex-1 flex-col gap-4 overflow-y-auto pr-1">
          {!call.turns.length && !call.live ? (
            <li className="m-auto max-w-xs text-center text-ink-3">
              Press Start call and talk naturally. Pause and {persona.name} replies. Talk over {persona.name} to interrupt.
            </li>
          ) : null}
          {call.turns.map((t, i) => (
            <TranscriptLine key={i} who={t.role === 'agent' ? persona.name : 'You'} agent={t.role === 'agent'} at={t.at - startedAt.current} text={t.text} cut={t.interrupted} />
          ))}
          {call.live ? <TranscriptLine who="You" agent={false} at={Date.now() - startedAt.current} text={`${call.live}…`} pending /> : null}
          {call.phase === 'thinking' ? (
            <li className="flex items-center gap-1.5 pl-[3.6rem] text-ink-3" aria-label={`${persona.name} is thinking`}>
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ink-3" />
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ink-3 [animation-delay:150ms]" />
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ink-3 [animation-delay:300ms]" />
            </li>
          ) : null}
        </ol>
      </section>
    </div>
  );
}

function TranscriptLine({ who, agent, at, text, cut, pending }: { who: string; agent: boolean; at: number; text: string; cut?: boolean; pending?: boolean }) {
  return (
    <li className={`grid grid-cols-[3rem_minmax(0,1fr)] gap-3 ${pending ? 'opacity-70' : ''}`}>
      <span className="tnum pt-0.5 text-right text-xs text-ink-3">{clock(at)}</span>
      <div className="min-w-0">
        <div className={`text-xs font-medium ${agent ? 'text-lamp' : 'text-ink-2'}`}>{who}</div>
        <p className="indic mt-0.5 break-words text-[0.97rem] leading-relaxed text-ink">
          {text}
          {cut ? <span className="text-sm text-warn"> (interrupted)</span> : null}
        </p>
      </div>
    </li>
  );
}
