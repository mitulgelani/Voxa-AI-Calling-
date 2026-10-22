'use client';

import { useEffect, useRef, useState } from 'react';
import { Play } from 'lucide-react';

/**
 * The hero's signature: one finished call as VaniDial returns it. Every answer is pinned to
 * the second of audio it came from; choosing an answer moves the playhead to that second.
 * The waveform is a fixed, deterministic shape (no random), so server and client match.
 */

const DURATION = 161; // 2:41, the average call in the product brief
const ANSWERS = [
  { key: 'Delivery on time', value: 'Yes', at: 24, end: 29, conf: 0.97, quote: 'हाँ, time पे आ गया था।' },
  { key: 'Product rating', value: '4 of 5', at: 62, end: 66, conf: 0.94, quote: 'Four दूँगी, packaging थोड़ी weak थी।' },
  { key: 'What to improve', value: 'Stronger packaging', at: 108, end: 117, conf: 0.71, quote: 'Box पिचक गया था, बस वो देख लो।' },
] as const;

function wave(i: number) {
  // Speech-like envelope from a few fixed sines: loud in turns, quiet between them.
  const t = i / 120;
  const turn = 0.5 + 0.5 * Math.sin(t * 9.1 + 0.6);
  const syl = Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.53));
  return 0.12 + 0.88 * turn * (0.35 + 0.65 * syl);
}
const BARS = 120;
const HEIGHTS = Array.from({ length: BARS }, (_, i) => wave(i));

function tc(s: number) {
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

export function EvidenceCard() {
  const [active, setActive] = useState(1);
  const [head, setHead] = useState<number>(ANSWERS[1].at);
  const target = useRef<number>(ANSWERS[1].at);
  const raf = useRef(0);

  // One orchestrated moment: on first view the playhead sweeps from 0 to the selected answer.
  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return;
    setHead(0);
    let cur = 0;
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      cur += (target.current - cur) * Math.min(1, dt * 3.2);
      setHead(cur);
      if (Math.abs(target.current - cur) > 0.05) raf.current = requestAnimationFrame(step);
      else setHead(target.current);
    };
    const start = window.setTimeout(() => (raf.current = requestAnimationFrame(step)), 450);
    return () => {
      window.clearTimeout(start);
      cancelAnimationFrame(raf.current);
    };
  }, []);

  const select = (i: number) => {
    setActive(i);
    target.current = ANSWERS[i].at;
    cancelAnimationFrame(raf.current);
    let cur = head;
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      cur += (target.current - cur) * Math.min(1, dt * 6);
      setHead(cur);
      if (Math.abs(target.current - cur) > 0.05) raf.current = requestAnimationFrame(step);
      else setHead(target.current);
    };
    raf.current = requestAnimationFrame(step);
  };

  const a = ANSWERS[active];
  const headPct = (head / DURATION) * 100;

  return (
    <figure className="surface relative overflow-hidden p-5 sm:p-6" aria-label="Example call record with evidence">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-medium">Call with Ritika S.</p>
          <p className="text-sm text-ink-3">Glowleaf order feedback, Hinglish, completed</p>
        </div>
        <span className="tnum rounded-full border border-line-2 px-2.5 py-0.5 text-sm text-ink-2">{tc(DURATION)}</span>
      </div>

      {/* waveform with evidence spans and playhead */}
      <div className="relative mt-5 h-20 select-none" aria-hidden>
        <svg viewBox={`0 0 ${BARS * 4} 80`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
          {ANSWERS.map((x, i) => (
            <rect key={x.key} x={(x.at / DURATION) * BARS * 4} y={0} width={((x.end - x.at) / DURATION) * BARS * 4} height={80} rx={3}
              fill={i === active ? 'rgb(244 165 60 / 0.16)' : 'rgb(255 255 255 / 0.035)'} />
          ))}
          {HEIGHTS.map((h, i) => {
            const t = (i / BARS) * DURATION;
            const inSpan = t >= a.at && t <= a.end;
            return <rect key={i} x={i * 4 + 0.8} y={40 - h * 34} width={2.4} height={h * 68} rx={1.2} fill={inSpan ? 'var(--color-lamp)' : t <= head ? 'var(--color-ink-2)' : 'var(--color-line-2)'} />;
          })}
        </svg>
        <div className="absolute inset-y-[-6px] w-px bg-lamp" style={{ left: `${headPct}%` }}>
          <span className="tnum absolute -top-5 left-1/2 -translate-x-1/2 rounded bg-lamp px-1.5 text-[11px] font-semibold text-lamp-ink">{tc(head)}</span>
        </div>
      </div>

      <ul className="mt-6 divide-y divide-line border-y border-line">
        {ANSWERS.map((x, i) => (
          <li key={x.key}>
            <button type="button" onClick={() => select(i)} aria-pressed={i === active}
              className={`grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-3 text-left transition-colors ${i === active ? '' : 'opacity-75 hover:opacity-100'}`}>
              <span className="min-w-0">
                <span className="block text-sm text-ink-3">{x.key}</span>
                <span className="block font-medium">{x.value}</span>
              </span>
              <span className="flex items-center gap-3">
                <Confidence value={x.conf} />
                <span className={`tnum inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm ${i === active ? 'bg-lamp text-lamp-ink' : 'border border-line-2 text-ink-2'}`}>
                  <Play size={12} aria-hidden fill="currentColor" /> {tc(x.at)}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>

      <blockquote className="indic mt-4 text-[1.02rem] text-ink" aria-live="polite">
        “{a.quote}”
        <footer className="mt-1 text-sm text-ink-3">
          Customer at <span className="tnum">{tc(a.at)}</span>
          {a.conf < 0.8 ? <>, sent to a reviewer because confidence is {Math.round(a.conf * 100)}%</> : null}
        </footer>
      </blockquote>
    </figure>
  );
}

function Confidence({ value }: { value: number }) {
  const low = value < 0.8;
  return (
    <span className={`tnum text-sm ${low ? 'text-warn' : 'text-pass'}`} title={`Confidence ${Math.round(value * 100)}%`}>
      {Math.round(value * 100)}%
    </span>
  );
}
