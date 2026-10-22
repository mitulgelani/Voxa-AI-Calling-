import { redirect } from 'next/navigation';
import { consoleContext } from '@/lib/console/context';
import { CreateOrgForm } from '@/components/console/CreateOrgForm';

export const metadata = { title: 'Create your organisation' };

export default async function Welcome() {
  const { org, user } = await consoleContext();
  if (org) redirect('/console');
  return (
    <div className="max-w-xl">
      <p className="text-ink-3">Signed in as {user.email}</p>
      <h1 className="mt-2 font-display text-[2.4rem] leading-tight">Set up your organisation</h1>
      <p className="mt-3 text-ink-2">
        Everything in VaniDial belongs to an organisation: agents, contact lists, caller IDs, calls and the audit trail.
        You become its owner. If a teammate already uses VaniDial, ask them to invite you instead.
      </p>
      <div className="surface mt-8 p-6"><CreateOrgForm /></div>
    </div>
  );
}
