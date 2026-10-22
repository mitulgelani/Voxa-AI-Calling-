'use client';

import { useEffect, useRef, useState } from 'react';
import { Plate } from '../Plate';
import { GATE, GATE_SVG } from './art.generated';

const CHECKS = ['Purpose', 'Caller ID', 'Consent', 'DND scrub', 'Script', 'Calling hours'];
const MISSING = [
  'purpose not chosen',
  'caller ID not verified',
  'no consent on record',
  'DND scrub is stale',
  'script not approved',
  'outside legal hours',
];

// Idle tour: each state is which checks pass. The last one opens the gate.
const TOUR: boolean[][] = [
  [true, true, true, false, true, true],
  [true, false, true, true, true, true],
  [true, true, true, true, true, false],
  [true, true, true, true, true, true],
];

const move = (u: readonly number[], n: number) => `translate(${(u[0] * n).toFixed(2)} ${(u[1] * n).toFixed(2)})`;

function readout(p: boolean[]) {
  const n = p.filter(Boolean).length;
  const first = p.findIndex((v) => !v);
  return n === 6 ? '6 of 6 checks pass, launch released' : `${n} of 6 pass, ${MISSING[first]}`;
}

/** With `state`, the figure shows a real campaign's checks and takes no input. */
export function GateFigure({ state }: { state?: boolean[] } = {}) {
  const host = useRef<HTMLDivElement | null>(null);
  const readoutRef = useRef<HTMLSpanElement | null>(null);
  const [pass, setPass] = useState<boolean[]>(state ?? TOUR[0]);
  const passRef = useRef(pass);
  const touring = useRef(!state);
  const stateKey = state?.join(',');
  useEffect(() => {
    if (state) setPass(state);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stateKey]);
  const kick = useRef<() => void>(() => undefined);

  useEffect(() => {
    passRef.current = pass;
    kick.current();
  }, [pass]);

  useEffect(() => {
    const root = host.current;
    if (!root) return;
    const svg = root.querySelector('svg');
    if (!svg) return;
    const caps = Array.from(svg.querySelectorAll<SVGGElement>('[data-part="cap"]'));
    const lamps = Array.from(svg.querySelectorAll<SVGGElement>('[data-part="lamp"] .iso-solid'));
    const armed = svg.querySelector<SVGGElement>('[data-part="armed"] .iso-solid');
    const button = svg.querySelector<SVGGElement>('[data-part="button"] .iso-solid');
    const plunger = svg.querySelector<SVGGElement>('[data-part="plunger"]');
    const bar = svg.querySelector<SVGGElement>('[data-part="bar"]');
    const hold = plunger?.querySelectorAll<SVGElement>('[data-hold]') ?? [];
    const still = window.matchMedia('(prefers-reduced-motion: reduce)');

    const capY: number[] = caps.map((c): number => (passRef.current[Number(c.dataset.index)] ? GATE.capOn : GATE.capOff));
    let barX = 0;
    let lift = { at: 0, rate: 0 };
    let raf = 0;
    let last = 0;
    let visible = false;

    const draw = () => {
      caps.forEach((c, i) => c.setAttribute('transform', move(GATE.unitY, capY[i])));
      bar?.setAttribute('transform', move(GATE.unitX, barX));
      plunger?.setAttribute('transform', move(GATE.unitZ, lift.at));
      const dx = GATE.unitZ[0] * lift.at;
      const dy = GATE.unitZ[1] * lift.at;
      hold.forEach((n) => n.setAttribute('transform', `translate(${(-dx).toFixed(2)} ${(-dy).toFixed(2)})`));
    };

    const tick = (now: number) => {
      const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
      last = now;
      const calm = still.matches;
      const p = passRef.current;
      const all = p.every(Boolean);
      let moving = false;
      caps.forEach((c, i) => {
        const target: number = p[Number(c.dataset.index)] ? GATE.capOn : GATE.capOff;
        capY[i] = calm ? target : capY[i] + (target - capY[i]) * (1 - Math.exp(-dt / 0.18));
        if (Math.abs(target - capY[i]) < 0.02) capY[i] = target;
        else moving = true;
      });
      lamps.forEach((l, i) => (p[i] ? l.setAttribute('data-lit', '') : l.removeAttribute('data-lit')));
      // the bar withdraws first, then the plunger springs up; locking reverses the order
      const barTarget: number = all ? GATE.barSlide : 0;
      const capsSettled = !moving;
      const barGo = all ? capsSettled : lift.at < 0.4;
      if (barGo) {
        barX = calm ? barTarget : barX + (barTarget - barX) * (1 - Math.exp(-dt / 0.16));
        if (Math.abs(barTarget - barX) < 0.02) barX = barTarget;
        else moving = true;
      } else moving = true;
      const liftTarget: number = all && Math.abs(barX - GATE.barSlide) < 0.5 ? GATE.rise : 0;
      if (calm) lift = { at: liftTarget, rate: 0 };
      else {
        for (let s = 0; s < 4; s++) {
          lift.rate += ((liftTarget - lift.at) * 260 - lift.rate * 17) * (dt / 4);
          lift.at += lift.rate * (dt / 4);
        }
        if (Math.abs(liftTarget - lift.at) < 0.01 && Math.abs(lift.rate) < 0.01) lift = { at: liftTarget, rate: 0 };
        else moving = true;
      }
      const open = lift.at > GATE.rise * 0.6;
      if (armed) open ? armed.setAttribute('data-lit', '') : armed.removeAttribute('data-lit');
      if (button) open ? button.setAttribute('data-lit', '') : button.removeAttribute('data-lit');
      draw();
      const failing = p.map((ok, i) => (ok ? null : MISSING[i])).filter(Boolean);
      const text = all ? (open ? '6 of 6 checks pass, launch released' : '6 of 6 checks pass, releasing') : `${p.filter(Boolean).length} of 6 pass, ${failing[0]}`;
      if (readoutRef.current && readoutRef.current.textContent !== text) readoutRef.current.textContent = text;
      raf = visible && moving ? requestAnimationFrame(tick) : 0;
    };
    const run = () => {
      if (!raf && visible) {
        last = 0;
        raf = requestAnimationFrame(tick);
      }
    };
    kick.current = run;
    const io = new IntersectionObserver((e) => {
      visible = e[e.length - 1].isIntersecting;
      if (visible) run();
    }, { rootMargin: '100px 0px' });
    io.observe(root);
    draw();
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, []);

  // idle tour, paused once someone touches a check, and under reduced motion
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let step = 0;
    const id = window.setInterval(() => {
      if (!touring.current) return;
      step = (step + 1) % TOUR.length;
      setPass(TOUR[step]);
    }, 2600);
    return () => window.clearInterval(id);
  }, []);

  const toggle = (i: number) => {
    touring.current = false;
    setPass((p) => p.map((v, j) => (j === i ? !v : v)));
  };


  return (
    <figure>
      <Plate fig={state ? 'Pre-flight' : 'Fig 1'} title="Six-check interlock" hint={state ? 'Live state of this campaign' : 'Toggle a check below'} readout={readout(pass)} readoutRef={readoutRef}>
        <div ref={host} className="[&_svg]:h-auto [&_svg]:w-full" dangerouslySetInnerHTML={{ __html: GATE_SVG }} />
      </Plate>
      {state ? null : <figcaption className="mt-4">
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3" aria-label="Compliance checks">
          {CHECKS.map((c, i) => (
            <li key={c}>
              <button
                type="button"
                onClick={() => toggle(i)}
                aria-pressed={pass[i]}
                className={`flex w-full items-center gap-2.5 rounded-xl border px-3 py-2 text-left text-sm transition-colors ${pass[i] ? 'border-line-2 text-ink' : 'border-fail/50 text-ink-2'}`}
              >
                <span className={`h-2 w-2 shrink-0 rounded-full ${pass[i] ? 'bg-lamp' : 'bg-fail'}`} aria-hidden />
                <span className="tnum text-ink-3">{i + 1}</span> {c}
              </button>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-sm text-ink-3">
          Each fader is one check, its lamp lit while it passes. A locking bar holds the launch plunger down until all six are up.
        </p>
      </figcaption>}
    </figure>
  );
}
