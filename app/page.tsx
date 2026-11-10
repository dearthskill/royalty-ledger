import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentSession } from '@/lib/auth-server';

const START: Record<string, { href: string; label: string; text: string }[]> = {
  admin: [
    { href: '/admin/artists', label: 'Artists & groups', text: 'Payees, nested groups and their member shares.' },
    { href: '/admin/tracks', label: 'Tracks & contracts', text: 'Versioned split contracts and effective shares.' },
    { href: '/admin/periods', label: 'Usage & payouts', text: 'Upload and clean usage, close periods, pay artists.' },
    { href: '/audit', label: 'Audit trail', text: 'Every change to contracts, groups, periods and payouts.' },
  ],
  artist: [{ href: '/me', label: 'My earnings', text: 'Your statement lines and payouts, period by period.' }],
  auditor: [{ href: '/audit', label: 'Ledger & audit', text: 'Read-only view of the ledger, payouts and audit trail.' }],
};

export default async function Home() {
  const session = await currentSession();
  if (!session) redirect('/login');
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Welcome</h1>
      <div className="grid gap-4 sm:grid-cols-2">
        {START[session.role].map(s => (
          <Link key={s.href} href={s.href} className="card block hover:border-indigo-400">
            <div className="font-medium">{s.label}</div>
            <div className="text-sm text-slate-500">{s.text}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
