'use client';

import { useActionState, useEffect, useRef, useState, type ReactNode } from 'react';
import { useFormStatus } from 'react-dom';
import type { ActionResult } from '@/lib/console/result';

export function Submit({ children, pending, className = 'btn btn-lamp', disabled }: { children: ReactNode; pending?: string; className?: string; disabled?: boolean }) {
  const { pending: busy } = useFormStatus();
  return <button className={className} disabled={busy || disabled} aria-busy={busy}>{busy && pending ? pending : children}</button>;
}

export function Notice({ state }: { state: ActionResult | null }) {
  if (!state) return null;
  return state.ok
    ? state.message ? <p role="status" className="text-sm text-pass">{state.message}</p> : null
    : <p role="alert" className="text-sm text-fail">{state.error}</p>;
}

/**
 * A form bound to a server action. The action receives FormData; the result shows inline.
 * `resetOnSuccess` clears the inputs after a successful save (useful for "add" forms).
 */
export function ActionForm({ action, children, className = '', resetOnSuccess, onDone }: {
  action: (prev: ActionResult | null, fd: FormData) => Promise<ActionResult>;
  children: ReactNode; className?: string; resetOnSuccess?: boolean; onDone?: (r: ActionResult) => void;
}) {
  const [state, run] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok && resetOnSuccess) ref.current?.reset();
    if (state) onDone?.(state);
  }, [state, resetOnSuccess, onDone]);
  return (
    <form ref={ref} action={run} className={className}>
      {children}
      <div className="mt-3 min-h-5"><Notice state={state} /></div>
    </form>
  );
}

/** One-button form for actions like Approve, Pause, Revoke. With `confirm`, the first press arms it. */
export function ActionButton({ action, fields, children, className = 'btn btn-quiet btn-sm', confirm, pending }: {
  action: (prev: ActionResult | null, fd: FormData) => Promise<ActionResult>;
  fields: Record<string, string>; children: ReactNode; className?: string; confirm?: string; pending?: string;
}) {
  const [state, run] = useActionState(action, null);
  const [armed, setArmed] = useState(false);
  return (
    <form action={run} className="inline-flex flex-col items-start gap-1">
      {Object.entries(fields).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      {confirm && !armed ? (
        <button type="button" className={className} onClick={() => setArmed(true)}>{children}</button>
      ) : confirm ? (
        <span className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-ink-2">{confirm}</span>
          <Submit className="btn btn-sm border border-fail/50 bg-fail/15 text-ink" pending={pending}>Yes, {String(children).toLowerCase()}</Submit>
          <button type="button" className="btn btn-sm text-ink-3 hover:text-ink" onClick={() => setArmed(false)}>Keep</button>
        </span>
      ) : (
        <Submit className={className} pending={pending}>{children}</Submit>
      )}
      {state && !state.ok ? <span role="alert" className="max-w-xs text-xs text-fail">{state.error}</span> : null}
    </form>
  );
}
