'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const MOVEMENTS = [
  { href: '/', label: 'Runs' },
  { href: '/gates', label: 'Gates' },
  { href: '/findings', label: 'Findings' },
  { href: '/analytics', label: 'Analytics' },
  { href: '/knowledge', label: 'Knowledge' },
  { href: '/knowledge/inbox', label: 'Inbox' },
  { href: '/brain', label: 'Brain' },
  { href: '/settings/models', label: 'Models' },
  { href: '/settings/webhooks', label: 'Webhooks' },
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
    <nav className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
      {MOVEMENTS.map((m) => {
        const active = m.href === current;
        return (
          <Link
            key={m.href}
            href={m.href}
            aria-current={active ? 'page' : undefined}
            className={`relative py-0.5 font-mono text-xs tracking-wide ${
              active ? 'text-ink' : 'text-ink-label hover:text-ink-secondary'
            }`}
          >
            {active && (
              <span aria-hidden className="absolute -left-2 top-0 h-full w-0.5 bg-mark" />
            )}
            {m.label}
          </Link>
        );
      })}
    </nav>
  );
}
