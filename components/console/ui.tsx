import Link from 'next/link';
import type { ReactNode } from 'react';

export function PageHeader({ title, lede, actions, back }: { title: string; lede?: ReactNode; actions?: ReactNode; back?: { href: string; label: string } }) {
  return (
    <header className="mb-8 flex flex-wrap items-end gap-x-6 gap-y-4">
      <div className="min-w-0 flex-1">
        {back ? <Link href={back.href} className="mb-2 inline-block text-sm text-ink-3 hover:text-ink">← {back.label}</Link> : null}
        <h1 className="font-display text-[2rem] leading-tight sm:text-[2.4rem]">{title}</h1>
        {lede ? <p className="mt-2 max-w-2xl text-ink-2">{lede}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function Section({ title, aside, children, className = '' }: { title: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`mt-10 first:mt-0 ${className}`}>
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <h2 className="font-display text-xl">{title}</h2>
        {aside ? <div className="text-sm text-ink-3">{aside}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-dashed border-line-2 px-6 py-10 text-center">
      <p className="font-medium">{title}</p>
      {children ? <p className="mx-auto mt-1 max-w-md text-sm text-ink-2">{children}</p> : null}
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
    </div>
  );
}

const TONE = {
  pass: 'border-pass/40 bg-pass/10 text-pass',
  warn: 'border-warn/40 bg-warn/10 text-warn',
  fail: 'border-fail/40 bg-fail/10 text-fail',
  live: 'border-lamp/50 bg-lamp/10 text-lamp',
  idle: 'border-line-2 text-ink-2',
} as const;
export type Tone = keyof typeof TONE;

export function Pill({ tone = 'idle', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium ${TONE[tone]}`}>{children}</span>;
}

export const STATUS_TONE: Record<string, Tone> = {
  draft: 'idle', running: 'live', paused: 'warn', completed: 'pass', cancelled: 'idle',
  queued: 'idle', dialing: 'live', ringing: 'live', in_progress: 'live', failed: 'fail',
};

/** A table that scrolls sideways on phones instead of breaking the page. */
export function Table({ head, children, label }: { head: string[]; children: ReactNode; label: string }) {
  return (
    <div className="surface overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-sm" aria-label={label}>
        <thead className="text-ink-3">
          <tr className="border-b border-line">
            {head.map((h, i) => <th key={i} scope="col" className="px-4 py-3 font-normal">{h}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
    </div>
  );
}

export function Stat({ label, value, note, tone }: { label: string; value: ReactNode; note?: ReactNode; tone?: Tone }) {
  const color = tone === 'fail' ? 'text-fail' : tone === 'warn' ? 'text-warn' : tone === 'pass' ? 'text-pass' : 'text-ink';
  return (
    <div className="px-5 py-4">
      <dt className="text-sm text-ink-3">{label}</dt>
      <dd className={`tnum mt-1 font-display text-3xl ${color}`}>{value}</dd>
      {note ? <dd className="mt-1 text-xs text-ink-3">{note}</dd> : null}
    </div>
  );
}

export function Field({ label, hint, error, children, htmlFor }: { label: string; hint?: ReactNode; error?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium text-ink-2">{label}</label>
      {children}
      {error ? <p className="mt-1.5 text-sm text-fail">{error}</p> : hint ? <p className="mt-1.5 text-sm text-ink-3">{hint}</p> : null}
    </div>
  );
}

export function Denied({ need }: { need: string }) {
  return <p className="rounded-xl border border-line-2 bg-panel px-4 py-3 text-sm text-ink-2">You need the {need} role or higher to change this. Ask an admin in your organisation.</p>;
}
