// End-to-end scenario through the real route handlers, in the order of the money flow:
// catalogue -> contract -> upload -> clean -> aggregate -> close -> pay -> artist statement -> audit.
// Uses its own period (2029-01) and track, so the seeded demo data is untouched.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as periods from '@/app/api/periods/route';
import * as tracks from '@/app/api/tracks/route';
import * as trackContracts from '@/app/api/tracks/[id]/contracts/route';
import { PUT as putSplits } from '@/app/api/contracts/[id]/splits/route';
import { POST as activate } from '@/app/api/contracts/[id]/activate/route';
import { GET as effective } from '@/app/api/tracks/[id]/effective-split/route';
import { POST as importUsage } from '@/app/api/periods/[id]/usage/import/route';
import { GET as duplicates } from '@/app/api/periods/[id]/usage/duplicates/route';
import { POST as voidDuplicates } from '@/app/api/periods/[id]/usage/void-duplicates/route';
import { DELETE as purge } from '@/app/api/periods/[id]/usage/voided/route';
import { GET as batches } from '@/app/api/usage/batches/route';
import { POST as aggregate } from '@/app/api/periods/[id]/aggregate/route';
import { POST as close } from '@/app/api/periods/[id]/close/route';
import { GET as ledger } from '@/app/api/periods/[id]/ledger/route';
import { POST as pay } from '@/app/api/payouts/[id]/pay/route';
import { GET as myPayouts } from '@/app/api/me/payouts/route';
import { GET as myStatement } from '@/app/api/me/statement/route';
import { GET as audit } from '@/app/api/audit/route';
import { mongoDb } from '@/lib/mongo';
import { ADMIN, AUDITOR, call, cookieFor } from '../helpers';

const KAI = 'kai@royalty.test';    // artist 2
const LINA = 'lina@royalty.test';  // artist 4
let admin: string, auditor: string, kai: string, lina: string;
let period: number, trackId: number, contractId: number;
const p = (id: number | string) => ({ id: String(id) });

beforeAll(async () => {
  [admin, auditor, kai, lina] = await Promise.all([ADMIN, AUDITOR, KAI, LINA].map(cookieFor));
  const db = await mongoDb();
  await db.collection('usage_events').deleteMany({});
  await db.collection('usage_batches').deleteMany({});
});
afterAll(async () => {
  await (globalThis as unknown as { mongoClient?: Promise<{ close(): Promise<void> }> }).mongoClient?.then(c => c.close());
});

describe('end-to-end: from a new track to an artist seeing a paid royalty', () => {
  it('1. admin sets up a period, a track and its contract (Kai 60 / Lina 40)', async () => {
    period = (await call(periods.POST, '/api/periods', { method: 'POST', cookie: admin,
      body: { label: '2029-01', starts_on: '2029-01-01', ends_on: '2029-01-31' } })).body.period.period_id;
    trackId = (await call(tracks.POST, '/api/tracks', { method: 'POST', cookie: admin,
      body: { title: 'Monsoon Postcard', isrc: 'INXYZ2900001', primary_artist_id: 2 } })).body.track.track_id;
    contractId = (await call(trackContracts.POST, `/api/tracks/${trackId}/contracts`, { method: 'POST', cookie: admin, params: p(trackId) }))
      .body.contract.contract_id;
    const s = await call(putSplits, `/api/contracts/${contractId}/splits`, { method: 'PUT', cookie: admin, params: p(contractId),
      body: { splits: [{ artist_id: 2, share_pct: 60 }, { artist_id: 4, share_pct: 40 }] } });
    expect(s.body.contract.total_share_pct).toBe('100.00');
    expect((await call(activate, `/api/contracts/${contractId}/activate`, { method: 'POST', cookie: admin, params: p(contractId) }))
      .body.contract.status).toBe('active');
    const eff = await call(effective, `/api/tracks/${trackId}/effective-split`, { cookie: auditor, params: p(trackId) });
    expect(eff.body.split.map((x: { name: string; effective_pct: string }) => [x.name, Number(x.effective_pct)]))
      .toEqual([['Kai', 60], ['Lina', 40]]);
  });

  it('2. usage arrives: a Spotify CSV with one duplicated row and a YouTube JSON report', async () => {
    const csv = 'track_id,plays,listener_hash,played_at,country\n' +
      `${trackId},500,L1,2029-01-05T10:00:00Z,IN\n` +
      `${trackId},500,L2,2029-01-06T10:00:00Z,IN\n` +
      `${trackId},500,L1,2029-01-05T10:00:00Z,IN\n`;           // same play reported twice
    const form = new FormData();
    form.set('platform', 'spotify');
    form.set('file', new File([csv], 'spotify-2029-01.csv'));
    expect((await call(importUsage, `/api/periods/${period}/usage/import`, { method: 'POST', cookie: admin, params: p(period), body: form })).status).toBe(201);
    const yt = await call(importUsage, `/api/periods/${period}/usage/import`, { method: 'POST', cookie: admin, params: p(period),
      body: { platform: 'youtube', source_file: 'youtube-2029-01.json', rows: [
        { track_id: trackId, plays: 1000, listener_hash: 'Y1', played_at: '2029-01-10T08:00:00Z', watch_seconds: 212 }] } });
    expect(yt.status).toBe(201);
  });

  it('3. admin cleans: previews and voids the duplicate, then purges it', async () => {
    const d = await call(duplicates, `/api/periods/${period}/usage/duplicates`, { cookie: admin, params: p(period) });
    expect(d.body.extra_rows).toBe(1);
    expect((await call(voidDuplicates, `/api/periods/${period}/usage/void-duplicates`, { method: 'POST', cookie: admin, params: p(period), body: {} }))
      .body.voided).toBe(1);
    expect((await call(purge, `/api/periods/${period}/usage/voided`, { method: 'DELETE', cookie: admin, params: p(period) }))
      .body.deleted).toBe(1);
  });

  it('4. aggregate writes { track_id, platform, plays } into usage_summary', async () => {
    const a = await call(aggregate, `/api/periods/${period}/aggregate`, { method: 'POST', cookie: admin, params: p(period), body: {} });
    expect(a.body).toMatchObject({ written: true, total_plays: 2000, rows: [
      { track_id: trackId, platform: 'spotify', plays: 1000 }, { track_id: trackId, platform: 'youtube', plays: 1000 }] });
    const b = await call(batches, `/api/usage/batches?period_id=${period}`, { cookie: auditor });
    expect(b.body.batches.every((x: { status: string }) => x.status === 'aggregated')).toBe(true);
  });

  it('5. close: spotify 1000 x 0.004 + youtube 1000 x 0.002 = 6.00, split 60/40', async () => {
    const c = await call(close, `/api/periods/${period}/close`, { method: 'POST', cookie: admin, params: p(period) });
    expect(c.status).toBe(200);
    expect(c.body.payouts.map((x: { artist_name: string; amount: string }) => [x.artist_name, x.amount]))
      .toEqual([['Kai', '3.60'], ['Lina', '2.40']]);
    const l = await call(ledger, `/api/periods/${period}/ledger`, { cookie: auditor, params: p(period) });
    expect(l.body.entries).toHaveLength(4);
  });

  it('6. admin pays Kai; each artist sees only their own money', async () => {
    const kaiPayout = (await call(myPayouts, '/api/me/payouts', { cookie: kai })).body.payouts
      .find((x: { period_id: number }) => x.period_id === period);
    expect(kaiPayout).toMatchObject({ amount: '3.60', status: 'pending' });
    expect((await call(pay, `/api/payouts/${kaiPayout.payout_id}/pay`, { method: 'POST', cookie: admin, params: p(kaiPayout.payout_id) }))
      .body.payout.status).toBe('paid');

    const kaiNow = (await call(myPayouts, '/api/me/payouts', { cookie: kai })).body.payouts;
    expect(kaiNow.find((x: { period_id: number }) => x.period_id === period).status).toBe('paid');
    expect(kaiNow.every((x: { artist_name: string }) => x.artist_name === 'Kai')).toBe(true);

    const linaSt = await call(myStatement, `/api/me/statement?period_id=${period}`, { cookie: lina });
    expect(linaSt.body.lines.map((x: { platform_code: string; amount: string }) => [x.platform_code, x.amount]))
      .toEqual([['spotify', '1.6000'], ['youtube', '0.8000']]);
    expect(linaSt.body.total).toBe('2.4000');
  });

  it('7. the audit trail shows who activated the contract and who paid', async () => {
    const paid = await call(audit, '/api/audit?table=payout&actor=admin@royalty.test', { cookie: auditor });
    expect(paid.body.entries[0]).toMatchObject({ op: 'UPDATE', before: { status: 'pending' }, after: { status: 'paid', artist_id: 2 } });
    const act = await call(audit, `/api/audit?table=contract&row_pk=${contractId}`, { cookie: auditor });
    expect(act.body.entries.map((e: { op: string; after: { status: string } }) => [e.op, e.after.status]))
      .toEqual([['UPDATE', 'active'], ['INSERT', 'draft']]);
  });

  it('8. after closing, usage of the period can no longer change', async () => {
    const r = await call(importUsage, `/api/periods/${period}/usage/import`, { method: 'POST', cookie: admin, params: p(period),
      body: { platform: 'spotify', source_file: 'late.json', rows: [{ track_id: trackId, plays: 1, listener_hash: 'Z', played_at: '2029-01-20T00:00:00Z' }] } });
    expect(r).toMatchObject({ status: 409, body: { error: 'Period 2029-01 is closed' } });
  });
});
