import Link from 'next/link';
import type { Role, Session } from '@/lib/session';
import { LogoutButton } from './LogoutButton';
import { SearchBox } from './SearchBox';

// Role-aware navigation: each role sees only the screens it may open.
const LINKS: Record<Role, { href: string; label: string }[]> = {
  admin: [
    { href: '/admin/artists', label: 'Artists' },
    { href: '/admin/tracks', label: 'Tracks' },
    { href: '/admin/periods', label: 'Periods' },
    { href: '/audit', label: 'Audit' },
  ],
  artist: [{ href: '/me', label: 'My earnings' }],
  auditor: [{ href: '/audit', label: 'Ledger & audit' }],
};

export function Nav({ session }: { session: Session | null }) {
  return (
    <header className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <nav className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-4 py-3">
        <Link href="/" className="font-semibold">Royalty Ledger</Link>
        {session && LINKS[session.role].map(l => (
          <Link key={l.href} href={l.href} className="text-sm text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white">
            {l.label}
          </Link>
        ))}
        {session && (
          <div className="ml-auto flex items-center gap-3 text-sm">
            {session.role === 'admin' && <SearchBox />}
            <span className="text-slate-500">{session.email} · {session.role}</span>
            <LogoutButton />
          </div>
        )}
      </nav>
    </header>
  );
}
