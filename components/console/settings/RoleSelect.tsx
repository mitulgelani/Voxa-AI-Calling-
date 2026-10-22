'use client';

import { useActionState } from 'react';
import { changeRole } from '@/app/console/_actions/settings';

export function RoleSelect({ user, role }: { user: string; role: string }) {
  const [state, run] = useActionState(changeRole, null);
  return (
    <form action={run} className="inline-flex flex-col">
      <input type="hidden" name="user" value={user} />
      <label className="sr-only" htmlFor={`role-${user}`}>Role</label>
      <select id={`role-${user}`} name="role" defaultValue={role} className="field w-36 py-1.5 text-sm" onChange={(e) => e.currentTarget.form?.requestSubmit()}>
        {['viewer', 'reviewer', 'operator', 'admin'].map((r) => <option key={r} value={r} className="capitalize">{r}</option>)}
      </select>
      {state && !state.ok ? <span role="alert" className="mt-1 text-xs text-fail">{state.error}</span> : null}
    </form>
  );
}
