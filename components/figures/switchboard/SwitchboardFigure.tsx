'use client';

import { useEffect, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import { DECK_FIG, DECK_SVG } from './art.generated';

const LANGS = [
  { name: 'Hinglish', voice: 'hi-IN-SwaraNeural', lang: 'hinglish', speaker: 'Swara' },
  { name: 'हिन्दी', voice: 'hi-IN-MadhurNeural', lang: 'hi-IN', speaker: 'Madhur' },
  { name: 'ગુજરાતી', voice: 'gu-IN-DhwaniNeural', lang: 'gu-IN', speaker: 'Dhwani' },
  { name: 'English', voice: 'en-US-AriaNeural', lang: 'en-US', speaker: 'Aria' },
];
// Idle tour: the order a real call might switch in.
const TOUR = [0, 3, 0, 1, 2];

// Kit projection, ported for the one part rebuilt per frame (the needle).
function iso([x, y, z]: [number, number, number]) {
  const { origin, scale, azimuth, elevation } = DECK_FIG.P;
  const a = (azimuth * Math.PI) / 180;
  const e = (elevation * Math.PI) / 180;
  const k = scale * Math.sqrt(1.6);
  return [origin[0] + (x * Math.sin(a) - y * Math.cos(a)) * k, origin[1] + ((x * Math.cos(a) + y * Math.sin(a)) * Math.sin(e) - z * Math.cos(e)) * k];
}
function needleD(share: number) {
  const n = DECK_FIG.needle;
  const ang = n.from + n.span * share;
  const tip = iso([n.cx + Math.sin(ang) * n.r, n.cy - Math.cos(ang) * n.r, n.z]);
  const tail = iso([n.cx - Math.sin(ang) * n.tail, n.cy + Math.cos(ang) * n.tail, n.z]);
  return `M${tail[0].toFixed(1)} ${tail[1].toFixed(1)}L${tip[0].toFixed(1)} ${tip[1].toFixed(1)}`;
}

export function SwitchboardFigure() {
  const host = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState(0);
  const activeRef = useRef(0);
  const touring = useRef(true);
  const kick = useRef<() => void>(() => undefined);
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<number | null>(null);
  const [loading, setLoading] = useState<number | null>(null);

  useEffect(() => () => audio.current?.pause(), []);

  const pick = async (i: number) => {
    touring.current = false;
    setActive(i);
    if (playing === i) {
      audio.current?.pause();
      setPlaying(null);
      return;
    }
    const l = LANGS[i];
    if (!audio.current) audio.current = new Audio();
    audio.current.pause();
    audio.current.src = `/api/voice-sample?voice=${encodeURIComponent(l.voice)}&lang=${encodeURIComponent(l.lang)}&name=${encodeURIComponent(l.speaker)}`;
    audio.current.onended = () => setPlaying(null);
    setLoading(i);
    try {
      await audio.current.play();
      setPlaying(i);
    } catch {
      setPlaying(null);
    } finally {
      setLoading(null);
    }
  };

  useEffect(() => {
    activeRef.current = active;
    kick.current();
  }, [active]);

  useEffect(() => {
    const root = host.current;
    const svg = root?.querySelector('svg');
    if (!root || !svg) return;
    const carts = Array.from(svg.querySelectorAll<SVGGElement>('[data-part="cart-pos"]'));
    const shells = carts.map((c) => c.querySelector<SVGGElement>('.iso-solid'));
    const lamps = Array.from(svg.querySelectorAll<SVGGElement>('[data-part="lamp"] .iso-solid'));
    const needle = svg.querySelector<SVGPathElement>('[data-part="needle"]');
    const still = window.matchMedia('(prefers-reduced-motion: reduce)');
    const z: number[] = carts.map((c): number => (Number(c.dataset.index) === activeRef.current ? DECK_FIG.drop : 0));
    let vu = 0.35;
    let vuTarget = 0.35;
    let t = 0;
    let raf = 0;
    let last = 0;
    let visible = false;

    const place = (c: SVGGElement, dz: number) => {
      const dx = DECK_FIG.unitZ[0] * dz;
      const dy = DECK_FIG.unitZ[1] * dz;
      c.setAttribute('transform', `translate(${dx.toFixed(2)} ${dy.toFixed(2)})`);
      c.querySelectorAll('[data-hold]').forEach((n) => n.setAttribute('transform', `translate(${(-dx).toFixed(2)} ${(-dy).toFixed(2)})`));
    };

    const tick = (now: number) => {
      const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
      last = now;
      t += dt;
      const calm = still.matches;
      const a = activeRef.current;
      // the seated cartridge rises first; the new one drops once the slot it leaves is clear
      const leaving = carts.some((c, i) => Number(c.dataset.index) !== a && z[i] < -0.5);
      carts.forEach((c, i) => {
        const idx = Number(c.dataset.index);
        const target: number = idx === a ? (leaving ? z[i] : DECK_FIG.drop) : 0;
        z[i] = calm ? target : z[i] + (target - z[i]) * (1 - Math.exp(-dt / 0.14));
        if (Math.abs(target - z[i]) < 0.02) z[i] = target;
        place(c, z[i]);
        const on = idx === a && Math.abs(z[i] - DECK_FIG.drop) < 2;
        const shell = shells[i];
        if (shell) on ? shell.setAttribute('data-lit', '') : shell.removeAttribute('data-lit');
        const lamp = lamps[idx];
        if (lamp) on ? lamp.setAttribute('data-lit', '') : lamp.removeAttribute('data-lit');
      });
      // VU needle: syllable-like level while the seated cartridge talks
      if (Math.random() < dt * 9) vuTarget = 0.25 + Math.random() * 0.6;
      vu = calm ? 0.45 : vu + (vuTarget - vu) * (1 - Math.exp(-dt / 0.08));
      needle?.setAttribute('d', needleD(leaving ? 0.08 : vu));
      raf = visible ? requestAnimationFrame(tick) : 0;
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
      else {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    }, { rootMargin: '100px 0px' });
    io.observe(root);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, []);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let step = 0;
    const id = window.setInterval(() => {
      if (!touring.current) return;
      step = (step + 1) % TOUR.length;
      setActive(TOUR[step]);
    }, 3200);
    return () => window.clearInterval(id);
  }, []);

  return (
    <figure>
      <div className="iso vd-iso overflow-hidden rounded-[var(--radius-card)] border border-line bg-[#101c2e] px-1 py-4 sm:px-3">
        <div ref={host} className="[&_svg]:h-auto [&_svg]:w-full" dangerouslySetInnerHTML={{ __html: DECK_SVG }} />
      </div>
      <figcaption className="mt-4">
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Hear a voice">
          {LANGS.map((l, i) => (
            <li key={l.name}>
              <button
                type="button"
                onClick={() => void pick(i)}
                aria-pressed={active === i}
                aria-label={`Hear ${l.speaker} in ${l.name}`}
                className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors ${active === i ? 'border-lamp bg-lamp/10 text-ink' : 'border-line-2 text-ink-2 hover:text-ink'}`}
              >
                <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full ${active === i ? 'bg-lamp text-lamp-ink' : 'bg-panel-2 text-ink-2'}`}>
                  {playing === i ? <Pause size={13} aria-hidden /> : <Play size={13} aria-hidden fill="currentColor" className={loading === i ? 'animate-pulse' : ''} />}
                </span>
                <span className="min-w-0">
                  <span className="indic block text-sm leading-tight">{l.name}</span>
                  <span className="block text-xs text-ink-3">{l.speaker}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </figcaption>
    </figure>
  );
}
