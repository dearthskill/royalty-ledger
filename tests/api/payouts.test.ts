import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as periods from '@/app/api/periods/route';
import { POST as importUsage } from '@/app/api/periods/[id]/usage/import/route';
import { POST as dispute } from '@/app/api/usage/batches/[batchId]/dispute/route';
import { POST as resolve } from '@/app/api/usage/batches/[batchId]/resolve/route';
import { GET as listBatches } from '@/app/api/usage/batches/route';
import { POST as aggregate } from '@/app/api/periods/[id]/aggregate/route';
import { POST as close } from '@/app/api/periods/[id]/close/route';
import { GET as ledger } from '@/app/api/periods/[id]/ledger/route';
import { GET as payouts } from '@/app/api/payouts/route';
import { POST as pay } from '@/app/api/payouts/[id]/pay/route';
import { mongoDb } from '@/lib/mongo';
import { ops } from '@/lib/usage';
import { ADMIN, AUDITOR, MIRA, NOVA, call, cookieFor } from '../helpers';

// Own periods (2026-10..12) so the seeded 2026-09 stays open for the other test files.
// Seed contracts: track 2 = Nova 100%; track 5 = Mira 70% / Nova 30%; track 8 = draft only (no active contract).
// Rates: spotify 0.004, youtube 0.002 per play.
let admin: string, auditor: string, nova: string, mira: string;
let oct: number, nov: number, dec: number;

const p = (id: number | string) => ({ id: String(id) });
const ev = (track_id: number, plays: number, listener_hash: string, played_at: string) =>
  ({ track_id, plays, listener_hash, played_at });

async function newPeriod(label: string, starts_on: string, ends_on: string) {
  const r = await call(periods.POST, '/api/periods', { method: 'POST', cookie: admin, body: { label, starts_on, ends_on } });
  return r.body.period.period_id as number;
}
async function upload(period: number, platform: string, rows: unknown[]) {
  const r = await call(importUsage, `/api/periods/${period}/usage/import`,
    { method: 'POST', cookie: admin, params: p(period), body: { platform, source_file: `${platform}.json`, rows } });
  expect(r.status).toBe(201);
  return r.body.batch_id as string;
}
const agg = (period: number, body: unknown = {}, cookie = admin) =>
  call(aggregate, `/api/periods/${period}/aggregate`, { method: 'POST', cookie, params: p(period), body });
const doClose = (period: number) => call(close, `/api/periods/${period}/close`, { method: 'POST', cookie: admin, params: p(period) });

beforeAll(async () => {
  [admin, auditor, nova, mira] = await Promise.all([ADMIN, AUDITOR, NOVA, MIRA].map(cookieFor));
  const db = await mongoDb();
  await db.collection('usage_events').deleteMany({});
  await db.collection('usage_batches').deleteMany({});
  oct = await newPeriod('2026-10', '2026-10-01', '2026-10-31');
  nov = await newPeriod('2026-11', '2026-11-01', '2026-11-30');
  dec = await newPeriod('2026-12', '2026-12-01', '2026-12-31');
});
afterAll(async () => {
  await (globalThis as unknown as { mongoClient?: Promise<{ close(): Promise<void> }> }).mongoClient?.then(c => c.close());
});

describe('POST /api/periods/:id/aggregate', () => {
  let spotifyBatch: string;
  it('previews { track_id, platform, plays } per track and platform without writing', async () => {
    spotifyBatch = await upload(oct, 'spotify', [ev(2, 600, 'L1', '2026-10-02T10:00:00Z'), ev(2, 400, 'L2', '2026-10-03T10:00:00Z')]);
    await upload(oct, 'youtube', [ev(5, 500, 'L1', '2026-10-04T10:00:00Z')]);
    const r = await agg(oct, { preview: true });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ written: false, total_plays: 1500, rows: [
      { track_id: 2, title: 'Paper Lanterns', platform: 'spotify', plays: 1000 },
      { track_id: 5, title: 'Glass Harbour', platform: 'youtube', plays: 500 },
    ] });
    expect((await call(periods.GET, '/api/periods', { cookie: admin })).body.periods
      .find((x: { period_id: number }) => x.period_id === oct).total_plays).toBe('0');
  });
  it('409 while a batch is disputed', async () => {
    await call(dispute, `/api/usage/batches/${spotifyBatch}/dispute`,
      { method: 'POST', cookie: admin, params: { batchId: spotifyBatch }, body: { note: 'check counts' } });
    const r = await agg(oct);
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('Period 2026-10 has disputed batches (spotify.json); resolve them first');
    await call(resolve, `/api/usage/batches/${spotifyBatch}/resolve`,
      { method: 'POST', cookie: admin, params: { batchId: spotifyBatch }, body: { note: 'ok' } });
  });
  it('400 listing unknown track ids / platforms that reached MongoDB directly; nothing written', async () => {
    const db = await mongoDb();
    const bad = await ops.ingest(db, { period_id: oct, platform: 'tidal', source_file: 'direct', uploaded_by: 1 },
      [{ track_id: 999, plays: 1, listener_hash: 'X', played_at: new Date('2026-10-05T00:00:00Z') }]);
    const r = await agg(oct);
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('Usage cannot be aggregated: unknown track_id 999; unknown platform tidal');
    expect(r.body.details).toEqual({ track_ids: [999], platforms: ['tidal'] });
    await db.collection('usage_events').deleteMany({ batch_id: bad.batch_id });
    await db.collection('usage_batches').deleteOne({ _id: bad.batch_id });
  });
  it('writes usage_summary, marks batches aggregated, and replaces the summary on a second run', async () => {
    const r = await agg(oct);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ written: true, total_plays: 1500 });
    const batches = (await call(listBatches, `/api/usage/batches?period_id=${oct}`, { cookie: admin })).body.batches;
    expect(batches.map((b: { status: string }) => b.status)).toEqual(['aggregated', 'aggregated']);

    await upload(oct, 'spotify', [ev(2, 250, 'L3', '2026-10-06T10:00:00Z')]);
    expect((await agg(oct)).body.total_plays).toBe(1750);
    const period = (await call(periods.GET, '/api/periods', { cookie: admin })).body.periods
      .find((x: { period_id: number }) => x.period_id === oct);
    expect(period).toMatchObject({ tracks_with_usage: 2, total_plays: '1750' });
  });
  it('403 for the auditor, 409 for an empty period, 404 for an unknown one', async () => {
    expect((await agg(oct, {}, auditor)).status).toBe(403);
    const empty = await agg(dec);
    expect(empty.status).toBe(409);
    expect(empty.body.error).toBe('Period 2026-12 has no valid usage to aggregate');
    expect((await agg(999)).status).toBe(404);
    expect((await agg(oct, { preview: 'yes' })).status).toBe(400);
  });
});

describe('POST /api/periods/:id/close', () => {
  it('refuses without usage and without an active contract (database messages verbatim)', async () => {
    const noUsage = await doClose(dec);
    expect(noUsage.status).toBe(409);
    expect(noUsage.body.error).toBe('Period 2026-12 has no usage loaded; aggregate usage first');

    await upload(nov, 'spotify', [ev(8, 10, 'L1', '2026-11-02T10:00:00Z')]);
    expect((await agg(nov)).status).toBe(200);
    const noContract = await doClose(nov);
    expect(noContract.status).toBe(409);
    expect(noContract.body.error).toMatch(/^Cannot close period 2026-11: no active contract for /);
  });
  it('closes: ledger entries per payee, payouts summed per artist', async () => {
    const r = await doClose(oct);
    expect(r.status).toBe(200);
    expect(r.body.period).toMatchObject({ status: 'closed', payouts_total: 2, payout_total: '6.00' });
    // Nova: 1250 spotify plays x 0.004 (100%) + 500 youtube x 0.002 x 30% = 5.00 + 0.30; Mira: 500 x 0.002 x 70% = 0.70
    expect(r.body.payouts.map((x: { artist_name: string; amount: string; status: string }) => [x.artist_name, x.amount, x.status]))
      .toEqual([['Mira', '0.70', 'pending'], ['Nova', '5.30', 'pending']]);
  });
  it('409 on a second close, and usage of the closed period can no longer change', async () => {
    const again = await doClose(oct);
    expect(again.status).toBe(409);
    expect(again.body.error).toBe('Period 2026-10 is already closed');
    const r = await agg(oct);
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('Period 2026-10 is closed');
  });
});

describe('GET /api/periods/:id/ledger', () => {
  it('lists entries with share paths; filters by artist and track', async () => {
    const all = await call(ledger, `/api/periods/${oct}/ledger`, { cookie: auditor, params: p(oct) });
    expect(all.status).toBe(200);
    expect(all.body.entries).toHaveLength(3);
    expect(all.body.entries[0]).toMatchObject({ title: 'Glass Harbour', platform_code: 'youtube', plays: 500 });
    const mine = await call(ledger, `/api/periods/${oct}/ledger?artist_id=3`, { cookie: admin, params: p(oct) });
    expect(mine.body.entries).toEqual([expect.objectContaining({
      artist_name: 'Mira', track_id: 5, effective_pct: '70.000000', amount: '0.7000' })]);
    const t2 = await call(ledger, `/api/periods/${oct}/ledger?track_id=2`, { cookie: admin, params: p(oct) });
    expect(t2.body.entries.map((e: { amount: string }) => e.amount)).toEqual(['5.0000']);
  });
  it('403 for artists, 404 for unknown periods', async () => {
    expect((await call(ledger, `/api/periods/${oct}/ledger`, { cookie: nova, params: p(oct) })).status).toBe(403);
    expect((await call(ledger, '/api/periods/999/ledger', { cookie: admin, params: p(999) })).status).toBe(404);
  });
});

describe('payouts', () => {
  it('admin sees every payout; an artist only their own (RLS)', async () => {
    const all = await call(payouts, `/api/payouts?period_id=${oct}`, { cookie: admin });
    expect(all.body.payouts).toHaveLength(2);
    const own = await call(payouts, '/api/payouts', { cookie: mira });
    expect(own.status).toBe(200);
    expect(new Set(own.body.payouts.map((x: { artist_name: string }) => x.artist_name))).toEqual(new Set(['Mira']));
    expect(own.body.payouts.some((x: { period_label: string }) => x.period_label === '2026-10')).toBe(true);
    expect((await call(payouts, '/api/payouts')).status).toBe(401);
  });
  it('pays once; a second pay is 409', async () => {
    const mine = (await call(payouts, `/api/payouts?period_id=${oct}`, { cookie: mira })).body.payouts[0];
    const r = await call(pay, `/api/payouts/${mine.payout_id}/pay`, { method: 'POST', cookie: admin, params: p(mine.payout_id) });
    expect(r.status).toBe(200);
    expect(r.body.payout).toMatchObject({ status: 'paid', artist_name: 'Mira' });
    expect(r.body.payout.paid_at).toBeTruthy();
    const again = await call(pay, `/api/payouts/${mine.payout_id}/pay`, { method: 'POST', cookie: admin, params: p(mine.payout_id) });
    expect(again.status).toBe(409);
    expect(again.body.error).toBe(`Payout ${mine.payout_id} is already paid`);
  });
  it('two concurrent pays of the same payout: exactly one succeeds (row lock)', async () => {
    const nv = (await call(payouts, `/api/payouts?period_id=${oct}`, { cookie: nova })).body.payouts[0];
    const req = () => call(pay, `/api/payouts/${nv.payout_id}/pay`, { method: 'POST', cookie: admin, params: p(nv.payout_id) });
    const statuses = (await Promise.all([req(), req()])).map(r => r.status).sort();
    expect(statuses).toEqual([200, 409]);
  });
  it('403 for non-admins, 404 for unknown payouts', async () => {
    expect((await call(pay, '/api/payouts/1/pay', { method: 'POST', cookie: auditor, params: p(1) })).status).toBe(403);
    expect((await call(pay, '/api/payouts/1/pay', { method: 'POST', cookie: nova, params: p(1) })).status).toBe(403);
    expect((await call(pay, '/api/payouts/9999/pay', { method: 'POST', cookie: admin, params: p(9999) })).status).toBe(404);
  });
});
