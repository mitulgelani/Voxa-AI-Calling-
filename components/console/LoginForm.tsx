'use client';

import { useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/browser';

export function LoginForm({ next }: { next?: string }) {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [error, setError] = useState('');
  const redirect = () => `${window.location.origin}/auth/callback?next=${encodeURIComponent(next && next.startsWith('/') ? next : '/console')}`;

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setState('sending');
    const { error } = await supabaseBrowser().auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: redirect() } });
    if (error) {
      setError(error.message.includes('rate') ? 'Too many links requested. Wait a minute and try again.' : 'Could not send the link. Check the email address.');
      setState('error');
    } else setState('sent');
  };

  const google = async () => {
    await supabaseBrowser().auth.signInWithOAuth({ provider: 'google', options: { redirectTo: redirect() } });
  };

  if (state === 'sent') {
    return (
      <div className="mt-8 rounded-xl border border-line-2 bg-panel p-5">
        <p className="font-medium">Check your inbox</p>
        <p className="mt-1 text-sm text-ink-2">We sent a sign-in link to {email}. It works once and expires in an hour.</p>
      </div>
    );
  }
  return (
    <div className="mt-8 space-y-4">
      <form onSubmit={send} className="space-y-3">
        <label className="block">
          <span className="mb-1.5 block text-sm text-ink-2">Work email</span>
          <input id="login-email" className="field" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
        </label>
        <button className="btn btn-lamp w-full" disabled={state === 'sending'}>{state === 'sending' ? 'Sending link' : 'Email me a sign-in link'}</button>
        {state === 'error' ? <p role="alert" className="text-sm text-fail">{error}</p> : null}
      </form>
      <div className="flex items-center gap-3 text-xs text-ink-3"><span className="h-px flex-1 bg-line" />or<span className="h-px flex-1 bg-line" /></div>
      <button type="button" onClick={google} className="btn btn-quiet w-full">Continue with Google</button>
    </div>
  );
}
