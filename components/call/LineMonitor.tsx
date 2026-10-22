'use client';

import { useEffect, useRef } from 'react';
import type { Phase } from '@/lib/voice/useCallEngine';

const BARS = 56;

/**
 * A line monitor: the call drawn as signal. Caller voice rises from the centre in ink,
 * the agent's voice in lamp saffron, thinking travels as a slow pulse, idle is a quiet line.
 * Writes attributes on refs each frame; never re-renders React.
 */
export function LineMonitor({ phase, level }: { phase: Phase; level: number }) {
  const bars = useRef<(SVGRectElement | null)[]>([]);
  const state = useRef({ phase, level });
  state.current = { phase, level };

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const heights = new Float32Array(BARS);
    const history = new Float32Array(BARS);
    let raf = 0;
    let t = 0;
    let last = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      t += dt;
      const { phase: p, level: lv } = state.current;
      // shift history left, push the newest sample at the right edge
      history.copyWithin(0, 1);
      let sample = 0.02;
      if (p === 'listening') sample = Math.min(1, lv * 1.9);
      else if (p === 'speaking') sample = 0.25 + 0.5 * Math.abs(Math.sin(t * 7.3) * Math.sin(t * 2.1 + 1)) + 0.15 * Math.random();
      else if (p === 'thinking') sample = 0.08;
      else if (p === 'connecting') sample = 0.05;
      history[BARS - 1] = sample;
      for (let i = 0; i < BARS; i++) {
        let target = history[i];
        if (p === 'thinking') {
          const d = Math.abs(i - ((t * 22) % (BARS + 12)) + 6);
          target = 0.06 + 0.32 * Math.exp(-(d * d) / 18);
        }
        if (p === 'idle' || p === 'ended') target = 0.03;
        heights[i] += (target - heights[i]) * (reduce ? 1 : Math.min(1, dt * 14));
        const el = bars.current[i];
        if (el) {
          const h = Math.max(1.5, heights[i] * 46);
          el.setAttribute('y', String(25 - h / 2));
          el.setAttribute('height', String(h));
        }
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    const onVis = () => {
      cancelAnimationFrame(raf);
      if (!document.hidden) {
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  const tone = phase === 'speaking' ? 'var(--color-lamp)' : phase === 'listening' ? 'var(--color-ink)' : 'var(--color-ink-3)';
  return (
    <div className="relative rounded-2xl border border-line bg-ground/60 px-3 py-4">
      <svg viewBox={`0 0 ${BARS * 6} 50`} className="block h-24 w-full" preserveAspectRatio="none" aria-hidden>
        <line x1="0" x2={BARS * 6} y1="25" y2="25" stroke="var(--color-line)" strokeWidth="0.6" />
        {Array.from({ length: BARS }).map((_, i) => (
          <rect
            key={i}
            ref={(el) => {
              bars.current[i] = el;
            }}
            x={i * 6 + 1.5}
            y={24}
            width={3}
            height={2}
            rx={1.5}
            fill={tone}
            style={{ transition: 'fill 240ms' }}
          />
        ))}
      </svg>
      <div className="tnum pointer-events-none absolute bottom-1.5 left-4 right-4 flex justify-between text-[10px] text-ink-3/70" aria-hidden>
        <span>-6 s</span>
        <span>now</span>
      </div>
    </div>
  );
}
