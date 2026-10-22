'use client';

import { useActionState, useCallback, useEffect, useRef, useState } from 'react';
import { correctAnswer, finishAndNext } from '@/app/console/_actions/review';
import { Submit } from '../forms';

export type EvTurn = { seq: number; speaker: 'agent' | 'customer'; text: string; lang: string | null; start_ms: number; end_ms: number; interrupted: boolean };
export type EvAnswer = {
  id: string; question_key: string; type: string; value: unknown; confidence: number;
  evidence_start_ms: number | null; evidence_end_ms: number | null; review_state: string; original_value: unknown;
};

const tc = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;
const show = (v: unknown) => (v === null || v === undefined ? 'No answer' : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v));
const STATE: Record<string, string> = { auto: 'Taken by the agent', needs_review: 'Needs a person', corrected: 'Corrected', confirmed: 'Confirmed' };

export function EvidencePlayer({ callId, src, durationMs, turns, answers, prompts, canReview, reviewing }: {
  callId: string; src: string | null; durationMs: number; turns: EvTurn[]; answers: EvAnswer[];
  prompts: Record<string, string>; canReview: boolean; reviewing: boolean;
}) {
  const audio = useRef<HTMLAudioElement>(null);
  const [now, setNow] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [sel, setSel] = useState(Math.max(0, answers.findIndex((a) => a.review_state === 'needs_review' || a.confidence < 0.8)));
  const [editing, setEditing] = useState<string | null>(null);
  const stopAt = useRef<number | null>(null);
  const finishForm = useRef<HTMLFormElement>(null);
  const [, finishRun] = useActionState(finishAndNext, null);
  const [, skipRun] = useActionState(finishAndNext, null);
  const skipForm = useRef<HTMLFormElement>(null);
  const total = Math.max(durationMs, ...turns.map((t) => t.end_ms), 1);

  useEffect(() => {
    const a = audio.current;
    if (!a) return;
    let raf = 0;
    const loop = () => {
      const ms = a.currentTime * 1000;
      setNow(ms);
      if (stopAt.current !== null && ms >= stopAt.current) { a.pause(); stopAt.current = null; }
      raf = requestAnimationFrame(loop);
    };
    const on = () => { setPlaying(true); raf = requestAnimationFrame(loop); };
    const off = () => { setPlaying(false); cancelAnimationFrame(raf); setNow(a.currentTime * 1000); };
    a.addEventListener('play', on);
    a.addEventListener('pause', off);
    a.addEventListener('ended', off);
    return () => { a.removeEventListener('play', on); a.removeEventListener('pause', off); a.removeEventListener('ended', off); cancelAnimationFrame(raf); };
  }, []);

  const seek = useCallback((ms: number, until?: number | null) => {
    const a = audio.current;
    setNow(ms);
    if (!a || !src) return;
    a.currentTime = ms / 1000;
    stopAt.current = until ?? null;
    void a.play().catch(() => undefined);
  }, [src]);

  const playEvidence = useCallback((a: EvAnswer) => {
    if (a.evidence_start_ms === null) return;
    // a little lead-in so the reviewer hears the question being answered
    seek(Math.max(0, a.evidence_start_ms - 1500), (a.evidence_end_ms ?? a.evidence_start_ms + 4000) + 600);
  }, [seek]);

  useEffect(() => {
    if (!reviewing) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable]') || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'j' || e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(answers.length - 1, s + 1)); }
      else if (e.key === 'k' || e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
      else if (e.key === ' ') { e.preventDefault(); if (answers[sel]) playEvidence(answers[sel]); }
      else if (e.key === 'e' && answers[sel]) { e.preventDefault(); setEditing(answers[sel].id); }
      else if (e.key === 'Enter') { e.preventDefault(); finishForm.current?.requestSubmit(); }
      else if (e.key === 's') { e.preventDefault(); skipForm.current?.requestSubmit(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [reviewing, answers, sel, playEvidence]);

  const activeTurn = turns.findIndex((t) => now >= t.start_ms && now < t.end_ms);
  const pct = (ms: number) => `${(ms / total) * 100}%`;

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
      <section aria-label="Recording and transcript" className="min-w-0">
        <div className="surface p-5">
          <div className="flex items-center gap-4">
            <button type="button" className="btn btn-lamp h-11 w-11 shrink-0 px-0" disabled={!src} aria-label={playing ? 'Pause' : 'Play'}
              onClick={() => { const a = audio.current; if (!a) return; stopAt.current = null; if (a.paused) void a.play(); else a.pause(); }}>
              {playing ? '❚❚' : '▶'}
            </button>
            <span className="tnum text-sm text-ink-2">{tc(now)} <span className="text-ink-3">/ {tc(total)}</span></span>
            {!src ? <span className="ml-auto text-sm text-ink-3">Recording not available</span> : null}
          </div>
          {/* timeline: who spoke when, where each answer came from, and the playhead */}
          <div className="relative mt-5 h-16 cursor-pointer select-none rounded-lg bg-ground/60" role="slider" tabIndex={0}
            aria-label="Position in call" aria-valuemin={0} aria-valuemax={Math.round(total / 1000)} aria-valuenow={Math.round(now / 1000)} aria-valuetext={tc(now)}
            onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); seek(((e.clientX - r.left) / r.width) * total); }}
            onKeyDown={(e) => { if (e.key === 'ArrowRight') seek(Math.min(total, now + 5000)); if (e.key === 'ArrowLeft') seek(Math.max(0, now - 5000)); }}>
            {answers.map((a, i) => a.evidence_start_ms !== null ? (
              <span key={a.id} className={`absolute inset-y-0 rounded ${i === sel ? 'bg-lamp/25' : 'bg-white/[0.04]'}`}
                style={{ left: pct(a.evidence_start_ms), width: pct(Math.max(600, (a.evidence_end_ms ?? a.evidence_start_ms) - a.evidence_start_ms)) }} />
            ) : null)}
            {turns.map((t) => (
              <span key={t.seq} className={`absolute rounded-sm ${t.speaker === 'customer' ? 'top-[34px] h-4 bg-ink-2/70' : 'top-[14px] h-4 bg-line-2'}`}
                style={{ left: pct(t.start_ms), width: pct(Math.max(250, t.end_ms - t.start_ms)) }} />
            ))}
            <span className="absolute inset-y-[-4px] w-px bg-lamp" style={{ left: pct(now) }} aria-hidden />
          </div>
          <div className="mt-2 flex gap-4 text-xs text-ink-3"><span><span className="mr-1.5 inline-block h-2 w-3 rounded-sm bg-line-2 align-middle" />Agent</span><span><span className="mr-1.5 inline-block h-2 w-3 rounded-sm bg-ink-2/70 align-middle" />Customer</span><span><span className="mr-1.5 inline-block h-2 w-3 rounded-sm bg-lamp/40 align-middle" />Answer evidence</span></div>
          {src ? <audio ref={audio} src={src} preload="metadata" className="hidden" /> : <audio ref={audio} className="hidden" />}
        </div>

        <ol className="mt-6 space-y-1" aria-label="Transcript">
          {turns.length ? turns.map((t, i) => (
            <li key={t.seq}>
              <button type="button" onClick={() => seek(t.start_ms)}
                className={`grid w-full grid-cols-[3.2rem_minmax(0,1fr)] gap-3 rounded-lg px-3 py-2 text-left transition-colors ${i === activeTurn ? 'bg-panel-2' : 'hover:bg-panel'}`}>
                <span className="tnum pt-0.5 text-sm text-ink-3">{tc(t.start_ms)}</span>
                <span className="min-w-0">
                  <span className="text-xs text-ink-3">{t.speaker === 'agent' ? 'Agent' : 'Customer'}{t.interrupted ? ', interrupted' : ''}</span>
                  <span className={`indic block ${t.speaker === 'customer' ? 'text-ink' : 'text-ink-2'}`}>{t.text}</span>
                </span>
              </button>
            </li>
          )) : <li className="text-sm text-ink-3">No transcript for this call.</li>}
        </ol>
      </section>

      <section aria-label="Answers" className="min-w-0 max-lg:order-first lg:sticky lg:top-8 lg:self-start">
        <h2 className="mb-3 font-display text-xl">Answers</h2>
        {answers.length ? (
          <ul className="space-y-2">
            {answers.map((a, i) => (
              <li key={a.id}>
                <div onClick={() => setSel(i)}
                  className={`rounded-xl border p-4 transition-colors ${i === sel ? 'border-lamp/60 bg-panel' : 'border-line hover:border-line-2'}`}>
                  <p className="indic text-sm text-ink-3">{prompts[a.question_key] ?? a.question_key}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-2">
                    <span className="indic text-lg font-medium">{show(a.value)}</span>
                    <span className={`tnum text-sm ${a.confidence < 0.8 ? 'text-warn' : 'text-pass'}`} title="How sure the agent was">{Math.round(a.confidence * 100)}%</span>
                    {a.evidence_start_ms !== null ? (
                      <button type="button" disabled={!src} onClick={(e) => { e.stopPropagation(); setSel(i); playEvidence(a); }}
                        className="tnum ml-auto inline-flex items-center gap-1.5 rounded-full bg-lamp px-2.5 py-1 text-sm font-semibold text-lamp-ink disabled:opacity-50">
                        ▶ {tc(a.evidence_start_ms)}
                      </button>
                    ) : <span className="ml-auto text-xs text-ink-3">No evidence span</span>}
                  </div>
                  <p className="mt-2 text-xs text-ink-3">
                    {STATE[a.review_state] ?? a.review_state}
                    {a.review_state === 'corrected' && a.original_value !== null ? <>, the agent heard “{show(a.original_value)}”</> : null}
                  </p>
                  {canReview && editing === a.id ? <FixForm a={a} callId={callId} onDone={() => setEditing(null)} />
                    : canReview ? <button type="button" className="mt-2 text-sm text-ink-3 hover:text-ink" onClick={(e) => { e.stopPropagation(); setEditing(a.id); }}>Correct this answer</button> : null}
                </div>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-ink-3">No answers were taken on this call.</p>}

        {reviewing ? (
          <div className="mt-6 rounded-xl border border-line-2 bg-panel p-4">
            <div className="flex flex-wrap gap-2">
              <form ref={finishForm} action={finishRun}><input type="hidden" name="call" value={callId} /><Submit pending="Saving">Confirm and next</Submit></form>
              <form ref={skipForm} action={skipRun}><input type="hidden" name="call" value={callId} /><input type="hidden" name="skip" value="1" /><Submit className="btn btn-quiet" pending="Skipping">Skip</Submit></form>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-ink-3 max-sm:hidden">
              <Kbd>J</Kbd> <Kbd>K</Kbd> move between answers, <Kbd>Space</Kbd> plays its evidence, <Kbd>E</Kbd> corrects it, <Kbd>Enter</Kbd> confirms and opens the next call, <Kbd>S</Kbd> skips.
            </p>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded border border-line-2 bg-ground px-1.5 py-px font-sans text-[0.7rem] text-ink-2">{children}</kbd>;
}

function FixForm({ a, callId, onDone }: { a: EvAnswer; callId: string; onDone: () => void }) {
  const [state, run] = useActionState(correctAnswer, null);
  useEffect(() => { if (state?.ok) onDone(); }, [state, onDone]);
  return (
    <form action={run} className="mt-3 flex flex-wrap items-start gap-2" onClick={(e) => e.stopPropagation()}>
      <input type="hidden" name="answer" value={a.id} />
      <input type="hidden" name="call" value={callId} />
      <input type="hidden" name="type" value={a.type} />
      <label className="sr-only" htmlFor={`fix-${a.id}`}>Correct value</label>
      {a.type === 'yes_no' ? (
        <select id={`fix-${a.id}`} name="value" className="field w-32 py-2" defaultValue={a.value === true ? 'yes' : a.value === false ? 'no' : ''} autoFocus>
          <option value="yes">Yes</option><option value="no">No</option><option value="">No answer</option>
        </select>
      ) : (
        <input id={`fix-${a.id}`} name="value" className="field indic min-w-0 flex-1 py-2" defaultValue={a.value === null ? '' : String(a.value)} autoFocus
          inputMode={a.type === 'rating' || a.type === 'number' ? 'numeric' : undefined} />
      )}
      <Submit className="btn btn-lamp btn-sm" pending="Saving">Save</Submit>
      <button type="button" className="btn btn-sm text-ink-3" onClick={onDone}>Cancel</button>
      {state && !state.ok ? <p role="alert" className="w-full text-sm text-fail">{state.error}</p> : null}
    </form>
  );
}
