import { describe, it, expect, beforeAll } from 'vitest';
import { GET as myStatement } from '@/app/api/me/statement/route';
import { GET as myPayouts } from '@/app/api/me/payouts/route';
import { GET as audit } from '@/app/api/audit/route';
import * as periods from '@/app/api/periods/route';
import { ADMIN, AUDITOR, MIRA, NOVA, call, cookieFor } from '../helpers';

// Seed August (period 2, closed): Nova = artist 1 (Midnight Static via The Night Owls 160.0000 + Paper Lanterns 100.0000),
// Mira = artist 3 (Midnight Static 80.0000). Other test files may close more periods, so checks are scoped to period 2.
let admin: string, auditor: string, nova: string, mira: string;
beforeAll(async () => {
  [admin, auditor, nova, mira] = await Promise.all([ADMIN, AUDITOR, NOVA, MIRA].map(cookieFor));
});

type Line = { period_id: number; title: string; amount: string; share_path: string };

describe('GET /api/me/statement', () => {
  it('returns the artist\'s own ledger lines and total', async () => {
    const r = await call(myStatement, '/api/me/statement?period_id=2', { cookie: nova });
    expect(r.status).toBe(200);
    expect(r.body.lines.map((l: Line) => [l.title, l.amount, l.share_path])).toEqual([
      ['Midnight Static', '160.0000', 'The Night Owls 80% > Nova 50%'],
      ['Paper Lanterns', '100.0000', 'Nova 100%'],
    ]);
    expect(r.body.total).toBe('260.0000');
  });
  it('artist A cannot see artist B: same query, different rows (RLS)', async () => {
    const n = (await call(myStatement, '/api/me/statement', { cookie: nova })).body.lines as Line[];
    const m = (await call(myStatement, '/api/me/statement', { cookie: mira })).body.lines as Line[];
    expect(m.filter(l => l.period_id === 2).map(l => [l.title, l.amount])).toEqual([['Midnight Static', '80.0000']]);
    expect(n.some(l => l.share_path.startsWith('Mira'))).toBe(false);
    expect(m.some(l => l.share_path.includes('Nova'))).toBe(false);
  });
  it('403 for admin and auditor, 401 without a session, 400 for a bad period id', async () => {
    expect((await call(myStatement, '/api/me/statement', { cookie: admin })).status).toBe(403);
    expect((await call(myStatement, '/api/me/statement', { cookie: auditor })).status).toBe(403);
    expect((await call(myStatement, '/api/me/statement')).status).toBe(401);
    expect((await call(myStatement, '/api/me/statement?period_id=x', { cookie: nova })).status).toBe(400);
  });
});

describe('GET /api/me/payouts', () => {
  it('lists only the caller\'s payouts', async () => {
    const r = await call(myPayouts, '/api/me/payouts', { cookie: nova });
    expect(r.status).toBe(200);
    expect(new Set(r.body.payouts.map((p: { artist_name: string }) => p.artist_name))).toEqual(new Set(['Nova']));
    expect(r.body.payouts.find((p: { period_id: number }) => p.period_id === 2))
      .toMatchObject({ amount: '260.00', status: 'paid', period_label: '2026-08' });
    expect((await call(myPayouts, '/api/me/payouts', { cookie: auditor })).status).toBe(403);
  });
});

describe('GET /api/audit', () => {
  it('lists entries newest first with before / after JSON and filters by table, row, actor and date', async () => {
    // An action by the admin, so there is an entry with a known actor.
    const created = await call(periods.POST, '/api/periods', { method: 'POST', cookie: admin,
      body: { label: '2028-01', starts_on: '2028-01-01', ends_on: '2028-01-31' } });
    const pk = String(created.body.period.period_id);

    const all = await call(audit, '/api/audit', { cookie: auditor });
    expect(all.status).toBe(200);
    const ids = all.body.entries.map((e: { audit_id: number }) => Number(e.audit_id));
    expect(ids).toEqual([...ids].sort((a, b) => b - a));

    const mine = await call(audit, `/api/audit?table=payout_period&row_pk=${pk}&actor=admin@royalty&from=2020-01-01&to=2100-01-01`, { cookie: admin });
    expect(mine.body.entries).toEqual([expect.objectContaining({
      table_name: 'payout_period', op: 'INSERT', row_pk: pk, actor: 'admin@royalty.test', before: null,
      after: expect.objectContaining({ label: '2028-01', status: 'open' }) })]);

    const paid = await call(audit, '/api/audit?table=payout&limit=500', { cookie: auditor });
    expect(paid.body.entries.length).toBeGreaterThan(0);
    expect(paid.body.entries.every((e: { table_name: string }) => e.table_name === 'payout')).toBe(true);
    expect((await call(audit, '/api/audit?limit=2', { cookie: auditor })).body.entries).toHaveLength(2);
    expect((await call(audit, '/api/audit?to=2000-01-01', { cookie: auditor })).body.entries).toEqual([]);
  });
  it('400 for bad filters, 403 for artists', async () => {
    expect((await call(audit, '/api/audit?limit=501', { cookie: auditor })).status).toBe(400);
    expect((await call(audit, '/api/audit?table=app_user', { cookie: auditor })).status).toBe(400);
    expect((await call(audit, '/api/audit?from=yesterday', { cookie: auditor })).status).toBe(400);
    expect((await call(audit, '/api/audit', { cookie: nova })).status).toBe(403);
  });
});
