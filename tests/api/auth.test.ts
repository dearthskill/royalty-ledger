import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as login } from '@/app/api/auth/login/route';
import { POST as logout } from '@/app/api/auth/logout/route';
import { GET as me } from '@/app/api/auth/me/route';
import { json, route } from '@/lib/http';
import { withDb } from '@/lib/db';
import { proxy } from '@/proxy';
import { ADMIN, AUDITOR, MIRA, NOVA, PASSWORD, call, cookieFor } from '../helpers';

describe('POST /api/auth/login', () => {
  it('logs in with the right password and sets an httpOnly session cookie', async () => {
    const r = await call(login, '/api/auth/login', { method: 'POST', body: { email: 'Nova@Royalty.test', password: PASSWORD } });
    expect(r.status).toBe(200);
    expect(r.body.user).toMatchObject({ email: 'nova@royalty.test', role: 'artist', artist_id: 1 });
    const cookie = r.headers.get('set-cookie')!;
    expect(cookie).toMatch(/^rl_session=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=lax/i);
  });

  it('rejects a wrong password and an unknown e-mail with the same 401', async () => {
    const wrong = await call(login, '/api/auth/login', { method: 'POST', body: { email: ADMIN, password: 'nope' } });
    const unknown = await call(login, '/api/auth/login', { method: 'POST', body: { email: 'ghost@royalty.test', password: PASSWORD } });
    expect(wrong).toMatchObject({ status: 401, body: { error: 'Invalid email or password' } });
    expect(unknown).toMatchObject({ status: 401, body: { error: 'Invalid email or password' } });
    expect(wrong.headers.get('set-cookie')).toBeNull();
  });

  it('validates the body (400)', async () => {
    const r = await call(login, '/api/auth/login', { method: 'POST', body: { email: 'not-an-email' } });
    expect(r.status).toBe(400);
    expect(r.body.details.map((d: { path: string }) => d.path)).toEqual(['email', 'password']);
  });
});

describe('GET /api/auth/me and logout', () => {
  it('401 without a session or with a tampered cookie', async () => {
    expect((await call(me, '/api/auth/me')).status).toBe(401);
    const cookie = await cookieFor(ADMIN);
    const tampered = cookie.slice(0, -3) + (cookie.endsWith('abc') ? 'xyz' : 'abc');
    expect(await call(me, '/api/auth/me', { cookie: tampered })).toMatchObject({ status: 401, body: { error: 'Not logged in' } });
  });

  it('returns the session for every role', async () => {
    for (const [email, role] of [[ADMIN, 'admin'], [AUDITOR, 'auditor'], [MIRA, 'artist']] as const) {
      const r = await call(me, '/api/auth/me', { cookie: await cookieFor(email) });
      expect(r.status).toBe(200);
      expect(r.body.user).toMatchObject({ email, role });
    }
  });

  it('logout expires the cookie', async () => {
    const r = await call(logout, '/api/auth/logout', { method: 'POST' });
    expect(r.status).toBe(200);
    expect(r.headers.get('set-cookie')).toMatch(/rl_session=;.*Max-Age=0/i);
  });
});

describe('role checks', () => {
  const adminOnly = route(['admin'], async () => json({ ok: true }));
  const staff = route(['admin', 'auditor'], async () => json({ ok: true }));

  it('route(): 401 without session, 403 for the wrong role, 200 for the right one', async () => {
    expect((await call(adminOnly, '/x')).status).toBe(401);
    expect((await call(adminOnly, '/x', { cookie: await cookieFor(AUDITOR) })).status).toBe(403);
    expect((await call(adminOnly, '/x', { cookie: await cookieFor(NOVA) })).status).toBe(403);
    expect((await call(adminOnly, '/x', { cookie: await cookieFor(ADMIN) })).status).toBe(200);
    expect((await call(staff, '/x', { cookie: await cookieFor(AUDITOR) })).status).toBe(200);
    expect((await call(staff, '/x', { cookie: await cookieFor(MIRA) })).status).toBe(403);
  });

  const page = async (path: string, email?: string) => {
    const headers: Record<string, string> = email ? { cookie: await cookieFor(email) } : {};
    return proxy(new NextRequest(new URL(path, 'http://localhost'), { headers }));
  };

  it('proxy: pages redirect to /login without a session', async () => {
    const r = await page('/admin/tracks?x=1');
    expect(r.status).toBe(307);
    expect(r.headers.get('location')).toBe('http://localhost/login?next=%2Fadmin%2Ftracks%3Fx%3D1');
  });

  it('proxy: 403 page for the wrong role, pass-through for the right one', async () => {
    expect((await page('/admin/artists', NOVA)).status).toBe(403);
    expect((await page('/admin/artists', AUDITOR)).status).toBe(403);
    expect((await page('/me', ADMIN)).status).toBe(403);
    expect((await page('/audit', NOVA)).status).toBe(403);
    expect((await page('/admin/artists', ADMIN)).headers.get('x-middleware-next')).toBe('1');
    expect((await page('/me', MIRA)).headers.get('x-middleware-next')).toBe('1');
    expect((await page('/audit', AUDITOR)).headers.get('x-middleware-next')).toBe('1');
    expect((await page('/audit', ADMIN)).headers.get('x-middleware-next')).toBe('1');
  });
});

describe('withDb', () => {
  const session = (role: 'admin' | 'artist' | 'auditor', artist_id: number | null = null) =>
    ({ user_id: 1, email: 'x@royalty.test', role, artist_id });

  it('runs as the database role of the session and sets app.* for RLS and audit', async () => {
    const r = await withDb(session('artist', 3), async c =>
      (await c.query(`SELECT current_user AS who, current_setting('app.artist_id') AS artist,
                             (SELECT COUNT(*) FROM payout) AS payouts`)).rows[0]);
    expect(r).toEqual({ who: 'rl_artist', artist: '3', payouts: 1 });   // Mira's August payout only
    const a = await withDb(session('auditor'), async c => (await c.query('SELECT current_user AS who, (SELECT COUNT(*) FROM payout) AS n')).rows[0]);
    expect(a).toEqual({ who: 'rl_auditor', n: 4 });
  });

  it('rolls back on error and surfaces the database error code', async () => {
    await expect(withDb(session('auditor'), c => c.query(`UPDATE track SET title = 'x'`)))
      .rejects.toMatchObject({ code: '42501' });
    await expect(withDb(session('admin'), c => c.query('SELECT * FROM app_user')))
      .rejects.toMatchObject({ code: '42501' });
  });
});
