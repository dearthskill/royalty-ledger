// API sweep: one success and one failure call for every route method, in one table.
// The first test scans app/api and fails if a handler is missing here, so new routes need an entry.
// Scratch data only: period 2030-01, a scratch artist and tracks; seeded rows are only read.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { POST as login } from '@/app/api/auth/login/route';
import { POST as logout } from '@/app/api/auth/logout/route';
import { GET as authMe } from '@/app/api/auth/me/route';
import * as artists from '@/app/api/artists/route';
import * as artist from '@/app/api/artists/[id]/route';
import * as members from '@/app/api/artists/[id]/members/route';
import * as tracks from '@/app/api/tracks/route';
import * as track from '@/app/api/tracks/[id]/route';
import * as trackContracts from '@/app/api/tracks/[id]/contracts/route';
import { GET as effective } from '@/app/api/tracks/[id]/effective-split/route';
import { GET as history } from '@/app/api/tracks/[id]/history/route';
import * as contract from '@/app/api/contracts/[id]/route';
import { PUT as splits } from '@/app/api/contracts/[id]/splits/route';
import { POST as activate } from '@/app/api/contracts/[id]/activate/route';
import { GET as search } from '@/app/api/search/route';
import { GET as platforms } from '@/app/api/platforms/route';
import * as periods from '@/app/api/periods/route';
import { GET as period } from '@/app/api/periods/[id]/route';
import { POST as importUsage } from '@/app/api/periods/[id]/usage/import/route';
import { GET as batches } from '@/app/api/usage/batches/route';
import { GET as duplicates } from '@/app/api/periods/[id]/usage/duplicates/route';
import { POST as voidDuplicates } from '@/app/api/periods/[id]/usage/void-duplicates/route';
import { GET as flagged } from '@/app/api/periods/[id]/usage/flagged/route';
import { POST as voidFlagged } from '@/app/api/periods/[id]/usage/void-flagged/route';
import { DELETE as purge } from '@/app/api/periods/[id]/usage/voided/route';
import { POST as dispute } from '@/app/api/usage/batches/[batchId]/dispute/route';
import { POST as resolve } from '@/app/api/usage/batches/[batchId]/resolve/route';
import { POST as aggregate } from '@/app/api/periods/[id]/aggregate/route';
import { POST as close } from '@/app/api/periods/[id]/close/route';
import { GET as ledger } from '@/app/api/periods/[id]/ledger/route';
import { GET as payouts } from '@/app/api/payouts/route';
import { POST as pay } from '@/app/api/payouts/[id]/pay/route';
import { GET as myStatement } from '@/app/api/me/statement/route';
import { GET as myPayouts } from '@/app/api/me/payouts/route';
import { GET as audit } from '@/app/api/audit/route';
import { mongoDb } from '@/lib/mongo';
import { ADMIN, AUDITOR, NOVA, PASSWORD, call, cookieFor, request } from '../helpers';

let admin: string, auditor: string, nova: string;
// ids created along the way (cases run in table order)
const s: Record<string, number | string> = {};
const p = (id: number | string) => ({ id: String(id) });
const P = () => s.period as number;

beforeAll(async () => {
  [admin, auditor, nova] = await Promise.all([ADMIN, AUDITOR, NOVA].map(cookieFor));
  const db = await mongoDb();
  await db.collection('usage_events').deleteMany({});
  await db.collection('usage_batches').deleteMany({});
  // A track for the contract cases (its draft is activated, so it can earn money in the sweep period).
  s.contractTrack = (await call(tracks.POST, '/api/tracks', { method: 'POST', cookie: admin,
    body: { title: 'Sweep Contract Track', isrc: 'INSWP3000001', primary_artist_id: 1 } })).body.track.track_id;
});
afterAll(async () => {
  await (globalThis as unknown as { mongoClient?: Promise<{ close(): Promise<void> }> }).mongoClient?.then(c => c.close());
});

type Res = { status: number; body: { [k: string]: never } & Record<string, unknown> };
type Case = { route: string; ok: () => Promise<Res>; okStatus: number; fail: (() => Promise<Res>) | null; failStatus?: number };
const row = (track_id: number, listener_hash: string, played_at: string) => ({ track_id, plays: 1, listener_hash, played_at });

const cases: Case[] = [
  // ---------- auth ----------
  { route: 'POST /api/auth/login', okStatus: 200, failStatus: 401,
    ok: async () => { const r = await login(request('/api/auth/login', { method: 'POST', body: { email: ADMIN, password: PASSWORD } })); return { status: r.status, body: await r.json() }; },
    fail: async () => { const r = await login(request('/api/auth/login', { method: 'POST', body: { email: ADMIN, password: 'wrong' } })); return { status: r.status, body: await r.json() }; } },
  { route: 'POST /api/auth/logout', okStatus: 200, fail: null, // public and idempotent: there is no failing request
    ok: async () => { const r = await logout(); return { status: r.status, body: await r.json() }; } },
  { route: 'GET /api/auth/me', okStatus: 200, failStatus: 401,
    ok: () => call(authMe, '/api/auth/me', { cookie: nova }), fail: () => call(authMe, '/api/auth/me') },

  // ---------- catalogue ----------
  { route: 'GET /api/artists', okStatus: 200, failStatus: 401,
    ok: () => call(artists.GET, '/api/artists', { cookie: nova }), fail: () => call(artists.GET, '/api/artists') },
  { route: 'POST /api/artists', okStatus: 201, failStatus: 403,
    ok: async () => { const r = await call(artists.POST, '/api/artists', { method: 'POST', cookie: admin, body: { name: 'Sweep Artist', kind: 'solo' } }); s.artist = r.body.artist.artist_id; return r; },
    fail: () => call(artists.POST, '/api/artists', { method: 'POST', cookie: auditor, body: { name: 'X', kind: 'solo' } }) },
  { route: 'GET /api/artists/[id]', okStatus: 200, failStatus: 404,
    ok: () => call(artist.GET, '/api/artists/1', { cookie: nova, params: p(1) }), fail: () => call(artist.GET, '/api/artists/9999', { cookie: nova, params: p(9999) }) },
  { route: 'PATCH /api/artists/[id]', okStatus: 200, failStatus: 400,
    ok: () => call(artist.PATCH, '', { method: 'PATCH', cookie: admin, params: p(s.artist), body: { name: 'Sweep Artist 2' } }),
    fail: () => call(artist.PATCH, '', { method: 'PATCH', cookie: admin, params: p(s.artist), body: { kind: 'group' } }) },
  { route: 'DELETE /api/artists/[id]', okStatus: 204, failStatus: 409,
    ok: () => call(artist.DELETE, '', { method: 'DELETE', cookie: admin, params: p(s.artist) }),
    fail: () => call(artist.DELETE, '', { method: 'DELETE', cookie: admin, params: p(1) }) },
  { route: 'GET /api/artists/[id]/members', okStatus: 200, failStatus: 409,
    ok: () => call(members.GET, '', { cookie: auditor, params: p(6) }), fail: () => call(members.GET, '', { cookie: auditor, params: p(1) }) },
  { route: 'PUT /api/artists/[id]/members', okStatus: 200, failStatus: 409,
    ok: () => call(members.PUT, '', { method: 'PUT', cookie: admin, params: p(6), body: { members: [{ member_id: 2, share_pct: 60 }, { member_id: 4, share_pct: 40 }] } }),
    fail: () => call(members.PUT, '', { method: 'PUT', cookie: admin, params: p(6), body: { members: [{ member_id: 2, share_pct: 59 }, { member_id: 4, share_pct: 40 }] } }) },
  { route: 'GET /api/tracks', okStatus: 200, failStatus: 401,
    ok: () => call(tracks.GET, '/api/tracks', { cookie: nova }), fail: () => call(tracks.GET, '/api/tracks') },
  { route: 'POST /api/tracks', okStatus: 201, failStatus: 400,
    ok: async () => { const r = await call(tracks.POST, '', { method: 'POST', cookie: admin, body: { title: 'Sweep Track', isrc: 'INSWP3000002', primary_artist_id: 1 } }); s.track = r.body.track.track_id; return r; },
    fail: () => call(tracks.POST, '', { method: 'POST', cookie: admin, body: { title: 'Bad', isrc: 'nope', primary_artist_id: 1 } }) },
  { route: 'GET /api/tracks/[id]', okStatus: 200, failStatus: 404,
    ok: () => call(track.GET, '', { cookie: nova, params: p(1) }), fail: () => call(track.GET, '', { cookie: nova, params: p(999) }) },
  { route: 'PATCH /api/tracks/[id]', okStatus: 200, failStatus: 400,
    ok: () => call(track.PATCH, '', { method: 'PATCH', cookie: admin, params: p(s.track), body: { title: 'Sweep Track 2' } }),
    fail: () => call(track.PATCH, '', { method: 'PATCH', cookie: admin, params: p(s.track), body: { released_on: 'soon' } }) },
  { route: 'DELETE /api/tracks/[id]', okStatus: 204, failStatus: 409,
    ok: () => call(track.DELETE, '', { method: 'DELETE', cookie: admin, params: p(s.track) }),
    fail: () => call(track.DELETE, '', { method: 'DELETE', cookie: admin, params: p(1) }) },
  { route: 'GET /api/search', okStatus: 200, failStatus: 401,
    ok: () => call(search, '/api/search?q=owl', { cookie: nova }), fail: () => call(search, '/api/search?q=owl') },
  { route: 'GET /api/platforms', okStatus: 200, failStatus: 401,
    ok: () => call(platforms, '/api/platforms', { cookie: nova }), fail: () => call(platforms, '/api/platforms') },

  // ---------- contracts ----------
  { route: 'GET /api/tracks/[id]/contracts', okStatus: 200, failStatus: 403,
    ok: () => call(trackContracts.GET, '', { cookie: auditor, params: p(1) }), fail: () => call(trackContracts.GET, '', { cookie: nova, params: p(1) }) },
  { route: 'POST /api/tracks/[id]/contracts', okStatus: 201, failStatus: 404,
    ok: async () => { const r = await call(trackContracts.POST, '', { method: 'POST', cookie: admin, params: p(s.contractTrack) }); s.contract = r.body.contract.contract_id; return r; },
    fail: () => call(trackContracts.POST, '', { method: 'POST', cookie: admin, params: p(999) }) },
  { route: 'GET /api/contracts/[id]', okStatus: 200, failStatus: 404,
    ok: () => call(contract.GET, '', { cookie: auditor, params: p(s.contract) }), fail: () => call(contract.GET, '', { cookie: auditor, params: p(9999) }) },
  { route: 'PUT /api/contracts/[id]/splits', okStatus: 200, failStatus: 409,
    ok: () => call(splits, '', { method: 'PUT', cookie: admin, params: p(s.contract), body: { splits: [{ artist_id: 1, share_pct: 100 }] } }),
    fail: () => call(splits, '', { method: 'PUT', cookie: admin, params: p(9), body: { splits: [{ artist_id: 1, share_pct: 100 }] } }) },
  { route: 'POST /api/contracts/[id]/activate', okStatus: 200, failStatus: 409,
    ok: () => call(activate, '', { method: 'POST', cookie: admin, params: p(s.contract) }),
    fail: () => call(activate, '', { method: 'POST', cookie: admin, params: p(8) }) },        // seeded draft at 90%
  { route: 'DELETE /api/contracts/[id]', okStatus: 204, failStatus: 409,
    ok: async () => { const d = await call(trackContracts.POST, '', { method: 'POST', cookie: admin, params: p(s.contractTrack) });
      return call(contract.DELETE, '', { method: 'DELETE', cookie: admin, params: p(d.body.contract.contract_id) }); },
    fail: () => call(contract.DELETE, '', { method: 'DELETE', cookie: admin, params: p(s.contract) }) },   // now active
  { route: 'GET /api/tracks/[id]/effective-split', okStatus: 200, failStatus: 409,
    ok: () => call(effective, '', { cookie: auditor, params: p(s.contractTrack) }), fail: () => call(effective, '', { cookie: auditor, params: p(8) }) },
  { route: 'GET /api/tracks/[id]/history', okStatus: 200, failStatus: 404,
    ok: () => call(history, '', { cookie: auditor, params: p(1) }), fail: () => call(history, '', { cookie: auditor, params: p(999) }) },

  // ---------- periods and usage (MongoDB) ----------
  { route: 'GET /api/periods', okStatus: 200, failStatus: 403,
    ok: () => call(periods.GET, '', { cookie: auditor }), fail: () => call(periods.GET, '', { cookie: nova }) },
  { route: 'POST /api/periods', okStatus: 201, failStatus: 409,
    ok: async () => { const r = await call(periods.POST, '', { method: 'POST', cookie: admin, body: { label: '2030-01', starts_on: '2030-01-01', ends_on: '2030-01-31' } }); s.period = r.body.period.period_id; return r; },
    fail: () => call(periods.POST, '', { method: 'POST', cookie: admin, body: { label: '2030-01x', starts_on: '2030-01-15', ends_on: '2030-02-15' } }) },
  { route: 'GET /api/periods/[id]', okStatus: 200, failStatus: 404,
    ok: () => call(period, '', { cookie: auditor, params: p(P()) }), fail: () => call(period, '', { cookie: auditor, params: p(999) }) },
  { route: 'POST /api/periods/[id]/usage/import', okStatus: 201, failStatus: 400,
    ok: async () => { const r = await call(importUsage, '', { method: 'POST', cookie: admin, params: p(P()), body: { platform: 'spotify', source_file: 'sweep.json',
      rows: [row(s.contractTrack as number, 'A', '2030-01-02T10:00:00Z'), row(s.contractTrack as number, 'A', '2030-01-02T10:00:00Z')] } }); s.batch = r.body.batch_id; return r; },
    fail: () => call(importUsage, '', { method: 'POST', cookie: admin, params: p(P()), body: { platform: 'spotify', source_file: 'bad.json', rows: [{ track_id: 1 }] } }) },
  { route: 'GET /api/usage/batches', okStatus: 200, failStatus: 400,
    ok: () => call(batches, `/api/usage/batches?period_id=${P()}`, { cookie: auditor }), fail: () => call(batches, '/api/usage/batches', { cookie: auditor }) },
  { route: 'GET /api/periods/[id]/usage/duplicates', okStatus: 200, failStatus: 403,
    ok: () => call(duplicates, '', { cookie: admin, params: p(P()) }), fail: () => call(duplicates, '', { cookie: auditor, params: p(P()) }) },
  { route: 'POST /api/periods/[id]/usage/void-duplicates', okStatus: 200, failStatus: 409,
    ok: () => call(voidDuplicates, '', { method: 'POST', cookie: admin, params: p(P()), body: {} }),
    fail: () => call(voidDuplicates, '', { method: 'POST', cookie: admin, params: p(2), body: {} }) },      // closed
  { route: 'GET /api/periods/[id]/usage/flagged', okStatus: 200, failStatus: 400,
    ok: () => call(flagged, '/x', { cookie: admin, params: p(P()) }), fail: () => call(flagged, '/x?max_per_hour=0', { cookie: admin, params: p(P()) }) },
  { route: 'POST /api/periods/[id]/usage/void-flagged', okStatus: 200, failStatus: 409,
    ok: () => call(voidFlagged, '', { method: 'POST', cookie: admin, params: p(P()), body: {} }),
    fail: () => call(voidFlagged, '', { method: 'POST', cookie: admin, params: p(2), body: {} }) },
  { route: 'DELETE /api/periods/[id]/usage/voided', okStatus: 200, failStatus: 409,
    ok: () => call(purge, '', { method: 'DELETE', cookie: admin, params: p(P()) }), fail: () => call(purge, '', { method: 'DELETE', cookie: admin, params: p(2) }) },
  { route: 'POST /api/usage/batches/[batchId]/dispute', okStatus: 200, failStatus: 404,
    ok: () => call(dispute, '', { method: 'POST', cookie: admin, params: { batchId: String(s.batch) }, body: { note: 'sweep' } }),
    fail: () => call(dispute, '', { method: 'POST', cookie: admin, params: { batchId: '0123456789abcdef01234567' }, body: { note: 'x' } }) },
  { route: 'POST /api/usage/batches/[batchId]/resolve', okStatus: 200, failStatus: 409,
    ok: () => call(resolve, '', { method: 'POST', cookie: admin, params: { batchId: String(s.batch) }, body: { note: 'ok' } }),
    fail: () => call(resolve, '', { method: 'POST', cookie: admin, params: { batchId: String(s.batch) }, body: { note: 'again' } }) },

  // ---------- money ----------
  { route: 'POST /api/periods/[id]/aggregate', okStatus: 200, failStatus: 409,
    ok: () => call(aggregate, '', { method: 'POST', cookie: admin, params: p(P()), body: {} }),
    fail: () => call(aggregate, '', { method: 'POST', cookie: admin, params: p(2), body: {} }) },
  { route: 'POST /api/periods/[id]/close', okStatus: 200, failStatus: 409,
    ok: () => call(close, '', { method: 'POST', cookie: admin, params: p(P()) }), fail: () => call(close, '', { method: 'POST', cookie: admin, params: p(2) }) },
  { route: 'GET /api/periods/[id]/ledger', okStatus: 200, failStatus: 403,
    ok: () => call(ledger, '/x', { cookie: auditor, params: p(P()) }), fail: () => call(ledger, '/x', { cookie: nova, params: p(P()) }) },
  { route: 'GET /api/payouts', okStatus: 200, failStatus: 401,
    ok: async () => { const r = await call(payouts, `/api/payouts?period_id=${P()}`, { cookie: admin }); s.payout = (r.body.payouts as unknown as { payout_id: number }[])[0].payout_id; return r; },
    fail: () => call(payouts, '/api/payouts') },
  { route: 'POST /api/payouts/[id]/pay', okStatus: 200, failStatus: 409,
    ok: () => call(pay, '', { method: 'POST', cookie: admin, params: p(s.payout) }), fail: () => call(pay, '', { method: 'POST', cookie: admin, params: p(s.payout) }) },
  { route: 'GET /api/me/statement', okStatus: 200, failStatus: 403,
    ok: () => call(myStatement, '/api/me/statement', { cookie: nova }), fail: () => call(myStatement, '/api/me/statement', { cookie: admin }) },
  { route: 'GET /api/me/payouts', okStatus: 200, failStatus: 403,
    ok: () => call(myPayouts, '/api/me/payouts', { cookie: nova }), fail: () => call(myPayouts, '/api/me/payouts', { cookie: auditor }) },
  { route: 'GET /api/audit', okStatus: 200, failStatus: 400,
    ok: () => call(audit, '/api/audit?limit=5', { cookie: auditor }), fail: () => call(audit, '/api/audit?limit=0', { cookie: auditor }) },
];

// "METHOD /api/path" for every exported handler under app/api.
function routeHandlers(dir = 'app/api'): string[] {
  return readdirSync(dir).flatMap(name => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return routeHandlers(full);
    if (name !== 'route.ts') return [];
    const src = readFileSync(full, 'utf8');
    const methods = [...src.matchAll(/export (?:const|async function) (GET|POST|PUT|PATCH|DELETE)\b/g)].map(m => m[1]);
    return methods.map(m => `${m} /${dir.replace(/^app\//, '')}`);
  });
}

describe('API sweep', () => {
  it('every route handler has a sweep entry', () => {
    expect(routeHandlers().sort()).toEqual(cases.map(c => c.route).sort());
  });
  for (const c of cases) {
    it(`${c.route}: ${c.okStatus}${c.fail ? ` / ${c.failStatus}` : ''}`, async () => {
      const ok = await c.ok();
      expect(ok.status, JSON.stringify(ok.body)).toBe(c.okStatus);
      if (c.fail) {
        const bad = await c.fail();
        expect(bad.status, JSON.stringify(bad.body)).toBe(c.failStatus);
        expect(bad.body.error).toEqual(expect.any(String));     // every failure carries a readable message
      }
    });
  }
});
