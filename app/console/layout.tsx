import type { Metadata } from 'next';
import { hasSupabase } from '@/lib/env';
import { consoleContext, atLeast } from '@/lib/console/context';
import { ConsoleNav } from '@/components/console/ConsoleNav';

export const metadata: Metadata = { title: { default: 'Console', template: '%s | VaniDial console' }, robots: { index: false } };

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  if (!hasSupabase) {
    return <main className="mx-auto max-w-lg px-6 py-24"><h1 className="font-display text-3xl">Console unavailable</h1><p className="mt-3 text-ink-2">The console opens once the database is connected.</p></main>;
  }
  const { db, user, memberships, org, role } = await consoleContext();
  let reviewOpen = 0;
  if (org && atLeast(role, 'reviewer')) {
    const { count } = await db.from('review_tasks').select('id', { count: 'exact', head: true }).eq('org_id', org.id).eq('state', 'open');
    reviewOpen = count ?? 0;
  }
  return (
    <div className="lg:grid lg:min-h-dvh lg:grid-cols-[248px_minmax(0,1fr)]">
      <ConsoleNav
        email={user.email ?? ''}
        role={role}
        org={org ? { id: org.id, name: org.name } : null}
        orgs={memberships.map((m) => ({ id: m.org.id, name: m.org.name, role: m.role }))}
        reviewOpen={reviewOpen}
      />
      <main id="main" className="min-w-0 px-4 pb-24 pt-6 sm:px-8 lg:px-12 lg:pt-10">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
