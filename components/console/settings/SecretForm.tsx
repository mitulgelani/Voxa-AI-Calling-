'use client';

import { useActionState, useEffect, useRef, useState, type ReactNode } from 'react';
import type { SecretResult } from '@/app/console/_actions/settings';
import { Submit } from '../forms';

/** A form whose success returns a one-time secret, shown with a copy button until dismissed. */
export function SecretForm({ action, children, submit, className = '' }: {
  action: (prev: SecretResult | null, fd: FormData) => Promise<SecretResult>; children: ReactNode; submit: string; className?: string;
}) {
  const [state, run] = useActionState(action, null);
  const [copied, setCopied] = useState(false);
  const [hidden, setHidden] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state?.ok) { form.current?.reset(); setHidden(false); setCopied(false); } }, [state]);
  return (
    <div className={className}>
      <form ref={form} action={run} className="flex flex-wrap items-end gap-3">
        {children}
        <Submit pending="Working">{submit}</Submit>
      </form>
      {state && !state.ok ? <p role="alert" className="mt-3 text-sm text-fail">{state.error}</p> : null}
      {state?.ok && state.secret && !hidden ? (
        <div className="mt-4 rounded-xl border border-lamp/50 bg-lamp/5 p-4" role="status">
          <p className="text-sm">{state.message}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded-lg bg-ground px-3 py-2 font-mono text-sm">{state.secret}</code>
            <button type="button" className="btn btn-quiet btn-sm" onClick={async () => { await navigator.clipboard.writeText(state.secret!); setCopied(true); }}>{copied ? 'Copied' : 'Copy'}</button>
            <button type="button" className="btn btn-sm text-ink-3" onClick={() => setHidden(true)}>Done</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
