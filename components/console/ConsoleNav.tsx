'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Logo } from '@/components/site/Logo';
import { switchOrg } from '@/app/console/_actions/org';

type Item = { href: string; label: string; min?: 'reviewer' | 'admin'; badge?: number };
const RANK = { viewer: 0, reviewer: 1, operator: 2, admin: 3, owner: 4 } as const;

export function ConsoleNav({ email, role, org, orgs, reviewOpen }: {
  email: string; role: keyof typeof RANK; org: { id: string; name: string } | null;
  orgs: { id: string; name: string; role: string }[]; reviewOpen: number;
}) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);

  const groups: { title: string; items: Item[] }[] = [
    { title: 'Run', items: [
      { href: '/console/campaigns', label: 'Campaigns' },
      { href: '/console/calls', label: 'Calls' },
      { href: '/console/review', label: 'Review queue', min: 'reviewer', badge: reviewOpen },
    ] },
    { title: 'Build', items: [
      { href: '/console/agents', label: 'Agents' },
      { href: '/console/contacts', label: 'Contacts' },
      { href: '/console/numbers', label: 'Caller IDs' },
    ] },
    { title: 'Govern', items: [
      { href: '/console/compliance', label: 'Compliance', min: 'reviewer' },
      { href: '/console/billing', label: 'Usage & billing' },
      { href: '/console/settings', label: 'Settings' },
    ] },
  ];
  const active = (href: string) => (href === '/console' ? path === href : path.startsWith(href));
  const link = (i: Item) => (
    <li key={i.href}>
      <Link href={i.href} aria-current={active(i.href) ? 'page' : undefined}
        className={`flex items-center gap-2 rounded-lg px-3 py-2 text-[0.94rem] transition-colors ${active(i.href) ? 'bg-panel-2 text-ink' : 'text-ink-2 hover:bg-panel hover:text-ink'}`}>
        <span className={`h-1.5 w-1.5 rounded-full ${active(i.href) ? 'bg-lamp' : 'bg-transparent'}`} aria-hidden />
        {i.label}
        {i.badge ? <span className="tnum ml-auto rounded-full bg-warn/15 px-2 text-xs text-warn" aria-label={`${i.badge} waiting`}>{i.badge}</span> : null}
      </Link>
    </li>
  );

  return (
    <>
      <div className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b border-line bg-ground/90 px-4 backdrop-blur lg:hidden">
        <Link href="/console" aria-label="Console home"><Logo /></Link>
        <button type="button" className="btn btn-quiet btn-sm ml-auto" aria-expanded={open} aria-controls="console-nav" onClick={() => setOpen((v) => !v)}>
          {open ? 'Close' : 'Menu'}
        </button>
      </div>
      <aside id="console-nav"
        className={`${open ? 'block' : 'hidden'} fixed inset-x-0 top-14 bottom-0 z-30 overflow-y-auto border-r border-line bg-ground px-4 py-5 lg:sticky lg:top-0 lg:block lg:h-dvh lg:bg-panel/40`}>
        <Link href="/console" className="hidden px-2 lg:block" aria-label="Console home"><Logo /></Link>

        {org ? (
          orgs.length > 1 ? (
            <form action={switchOrg} className="mt-6">
              <label htmlFor="org-switch" className="px-2 text-xs text-ink-3">Organisation</label>
              <div className="mt-1 flex gap-1.5">
                <select id="org-switch" name="org" defaultValue={org.id} className="field py-2 text-sm">
                  {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
                <button className="btn btn-quiet btn-sm">Go</button>
              </div>
            </form>
          ) : (
            <div className="mt-6 px-2">
              <p className="text-xs text-ink-3">Organisation</p>
              <p className="truncate font-medium">{org.name}</p>
            </div>
          )
        ) : null}

        <nav aria-label="Console" className="mt-6">
          <ul><li>{link({ href: '/console', label: 'Overview' })}</li></ul>
          {org ? groups.map((g) => (
            <div key={g.title} className="mt-5">
              <p className="px-3 pb-1 text-xs text-ink-3">{g.title}</p>
              <ul>{g.items.filter((i) => !i.min || RANK[role] >= RANK[i.min]).map(link)}</ul>
            </div>
          )) : null}
        </nav>

        <div className="mt-8 border-t border-line px-2 pt-4 text-sm lg:absolute lg:inset-x-4 lg:bottom-4">
          <p className="truncate text-ink-2" title={email}>{email}</p>
          <p className="text-xs capitalize text-ink-3">{role}</p>
          <div className="mt-3 flex items-center gap-3">
            <Link href="/playground" className="text-ink-3 hover:text-ink">Playground</Link>
            <form action="/auth/signout" method="post"><button className="text-ink-3 hover:text-ink">Sign out</button></form>
          </div>
        </div>
      </aside>
    </>
  );
}
