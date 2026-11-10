'use client';

import { useState } from 'react';

export function LoginForm({ next }: { next: string }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: form.get('email'), password: form.get('password') }),
    });
    if (res.ok) {
      // only same-site paths, never an absolute URL from the query string
      window.location.href = next.startsWith('/') && !next.startsWith('//') ? next : '/';
      return;
    }
    setError((await res.json()).error ?? 'Login failed');
    setBusy(false);
  }

  return (
    <form onSubmit={submit} className="card w-full max-w-sm space-y-3">
      <h1 className="text-lg font-semibold">Sign in</h1>
      {error && <div className="error" role="alert">{error}</div>}
      <div>
        <label className="label" htmlFor="email">E-mail</label>
        <input id="email" name="email" type="email" required autoComplete="username" className="input" />
      </div>
      <div>
        <label className="label" htmlFor="password">Password</label>
        <input id="password" name="password" type="password" required autoComplete="current-password" className="input" />
      </div>
      <button type="submit" disabled={busy} className="btn w-full justify-center">{busy ? 'Signing in…' : 'Sign in'}</button>
      <p className="text-xs text-slate-500">Demo: admin@royalty.test, auditor@royalty.test, nova@royalty.test · Password@123</p>
    </form>
  );
}
