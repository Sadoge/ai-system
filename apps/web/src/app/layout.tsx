import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'ai-system',
  description: 'AI Software Engineering Platform',
};

const NAV = [
  { href: '/', label: 'Runs' },
  { href: '/gates', label: 'Gates' },
  { href: '/knowledge', label: 'Knowledge' },
  { href: '/settings/models', label: 'Models' },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="mx-auto max-w-5xl px-6 py-6">
          <header className="mb-8 flex items-center gap-6 border-b border-zinc-800 pb-4">
            <span className="font-mono text-lg font-bold text-emerald-400">ai-system</span>
            <nav className="flex gap-4 text-sm text-zinc-400">
              {NAV.map((item) => (
                <Link key={item.href} href={item.href} className="hover:text-zinc-100">
                  {item.label}
                </Link>
              ))}
            </nav>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
