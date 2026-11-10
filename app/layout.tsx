import type { Metadata } from 'next';
import { Nav } from '@/components/Nav';
import { currentSession } from '@/lib/auth-server';
import './globals.css';

export const metadata: Metadata = {
  title: 'Royalty Ledger',
  description: 'Transparent royalty splits and payouts for independent music',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await currentSession();
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <Nav session={session} />
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
