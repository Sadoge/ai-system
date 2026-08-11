'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const MOVEMENTS = [
  { href: '/', label: 'Runs', tone: 'cue' },
  { href: '/gates', label: 'Gates', tone: 'mark' },
  { href: '/findings', label: 'Findings', tone: 'hold' },
  { href: '/analytics', label: 'Analytics', tone: 'aqua' },
  { href: '/knowledge', label: 'Knowledge', tone: 'violet' },
  { href: '/knowledge/inbox', label: 'Inbox', tone: 'violet' },
  { href: '/brain', label: 'Brain', tone: 'mint' },
  { href: '/settings/models', label: 'Models', tone: 'cue' },
  { href: '/settings/webhooks', label: 'Webhooks', tone: 'hold' },
];

/**
 * The movement the reader is in. A run detail page belongs to Runs, and the
 * deepest match wins so /knowledge/inbox marks Inbox rather than both it and
 * Knowledge.
 */
function activeHref(pathname: string): string | undefined {
  return MOVEMENTS.map((m) => m.href)
    .filter((href) =>
      href === '/'
        ? pathname === '/' || pathname.startsWith('/runs')
        : pathname === href || pathname.startsWith(`${href}/`),
    )
    .sort((a, b) => b.length - a.length)[0];
}

export function Movements() {
  const pathname = usePathname();
  const current = activeHref(pathname);
  return (
    <nav className="flex flex-wrap items-center gap-1.5" aria-label="Primary navigation">
      {MOVEMENTS.map((m) => {
        const active = m.href === current;
        return (
          <Link
            key={m.href}
            href={m.href}
            aria-current={active ? 'page' : undefined}
            className={`movement movement-${m.tone} relative px-2.5 py-1.5 font-mono text-xs tracking-wide`}
          >
            {active && (
              <span
                aria-hidden
                className="absolute inset-x-1 bottom-0 h-px bg-[var(--movement-accent)]"
              />
            )}
            {m.label}
          </Link>
        );
      })}
    </nav>
  );
}
