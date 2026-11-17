import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import * as periods from '@/app/api/periods/route';
import { GET as getPeriod } from '@/app/api/periods/[id]/route';
import { POST as importUsage } from '@/app/api/periods/[id]/usage/import/route';
import { GET as listBatches } from '@/app/api/usage/batches/route';
import { GET as duplicates } from '@/app/api/periods/[id]/usage/duplicates/route';
import { POST as voidDuplicates } from '@/app/api/periods/[id]/usage/void-duplicates/route';
import { GET as flagged } from '@/app/api/periods/[id]/usage/flagged/route';
import { POST as voidFlagged } from '@/app/api/periods/[id]/usage/void-flagged/route';
import { DELETE as purge } from '@/app/api/periods/[id]/usage/voided/route';
import { POST as dispute } from '@/app/api/usage/batches/[batchId]/dispute/route';
import { POST as resolve } from '@/app/api/usage/batches/[batchId]/resolve/route';
import { GET as platforms } from '@/app/api/platforms/route';
import { mongoDb } from '@/lib/mongo';
import { ops } from '@/lib/usage';
import { ADMIN, AUDITOR, NOVA, call, cookieFor } from '../helpers';

// Seed: period 1 = '2026-09' (open), period 2 = '2026-08' (closed); tracks 1-8; platforms spotify, youtube, apple_music.
let admin: string, auditor: string, nova: string;
beforeAll(async () => {
  [admin, auditor, nova] = await Promise.all([cookieFor(ADMIN), cookieFor(AUDITOR), cookieFor(NOVA)]);
});
beforeEach(async () => {
  const db = await mongoDb();
  await db.collection('usage_events').deleteMany({});
  await db.collection('usage_batches').deleteMany({});
});
afterAll(async () => {
  await (globalThis as unknown as { mongoClient?: Promise<{ close(): Promise<void> }> }).mongoClient?.then(c => c.close());
});

const p = (id: number | string) => ({ id: String(id) });
const ev = (track_id: number, listener_hash: string, played_at: string, extra: Record<string, unknown> = {}) =>
  ({ track_id, plays: 1, listener_hash, played_at, ...extra });
const rows3 = [
  ev(1, 'L1', '2026-09-03T10:00:00Z', { country: 'IN' }),
  ev(2, 'L2', '2026-09-03T11:00:00Z'),
  ev(3, 'L3', '2026-09-04T09:30:00Z'),
];
async function upload(rows: unknown[], platform = 'spotify', period = 1, source_file = 'spotify-sep.json') {
  return call(importUsage, `/api/periods/${period}/usage/import`,
    { method: 'POST', cookie: admin, params: p(period), body: { platform, source_file, rows } });
}

describe('periods', () => {
  it('lists v_period_totals rows newest first for admin and auditor', async () => {
    const r = await call(periods.GET, '/api/periods', { cookie: auditor });
    expect(r.status).toBe(200);
    expect(r.body.periods.map((x: { label: string }) => x.label).slice(-2)).toEqual(['2026-09', '2026-08']);
    expect(r.body.periods.at(-1)).toMatchObject({ status: 'closed', payouts_total: 4 });
  });
  it('401 without a session, 403 for artists', async () => {
    expect((await call(periods.GET, '/api/periods')).status).toBe(401);
    expect((await call(periods.GET, '/api/periods', { cookie: nova })).status).toBe(403);
  });
  it('creates a period; the database rejects overlap, duplicate label and reversed dates', async () => {
    const make = (body: unknown) => call(periods.POST, '/api/periods', { method: 'POST', cookie: admin, body });
    const ok = await make({ label: '2027-01', starts_on: '2027-01-01', ends_on: '2027-01-31' });
    expect(ok.status).toBe(201);
    expect(ok.body.period).toMatchObject({ label: '2027-01', status: 'open', total_plays: '0' });

    const overlap = await make({ label: '2027-01b', starts_on: '2027-01-15', ends_on: '2027-02-15' });
    expect(overlap.status).toBe(409);
    expect(overlap.body.error).toMatch(/period_no_overlap/);
    expect((await make({ label: '2027-01', starts_on: '2027-03-01', ends_on: '2027-03-31' })).status).toBe(409);
    const reversed = await make({ label: '2027-05', starts_on: '2027-05-31', ends_on: '2027-05-01' });
    expect(reversed.status).toBe(400);
    expect(reversed.body.error).toMatch(/period_dates/);
    expect((await make({ label: 'x', starts_on: '1 May', ends_on: '2027-05-01' })).status).toBe(400);
    expect((await call(periods.POST, '/api/periods', { method: 'POST', cookie: auditor, body: {} })).status).toBe(403);
  });
  it('gets one period; 404 for unknown ids', async () => {
    expect((await call(getPeriod, '/api/periods/1', { cookie: admin, params: p(1) })).body.period.label).toBe('2026-09');
    expect((await call(getPeriod, '/api/periods/999', { cookie: admin, params: p(999) })).status).toBe(404);
    expect((await call(getPeriod, '/api/periods/abc', { cookie: admin, params: p('abc') })).status).toBe(404);
  });
});

describe('GET /api/platforms', () => {
  it('lists platforms for any role; 401 without a session', async () => {
    const r = await call(platforms, '/api/platforms', { cookie: nova });
    expect(r.body.platforms.map((x: { code: string }) => x.code)).toEqual(['apple_music', 'spotify', 'youtube']);
    expect((await call(platforms, '/api/platforms')).status).toBe(401);
  });
});

describe('POST /api/periods/:id/usage/import', () => {
  it('stores a JSON batch; unknown keys go into raw', async () => {
    const r = await upload(rows3);
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ row_count: 3 });
    expect(r.body.batch_id).toMatch(/^[0-9a-f]{24}$/);
    const e = await (await mongoDb()).collection('usage_events').findOne({ track_id: 1 });
    expect(e).toMatchObject({ platform: 'spotify', period_id: 1, status: 'valid', raw: { country: 'IN' } });
    expect(e!.played_at).toBeInstanceOf(Date);
  });
  it('stores a multipart CSV upload (columns in any order, quoted fields, extra columns -> raw)', async () => {
    const csv = 'listener_hash,played_at,track_id,plays,device,campaign\n' +
      'L1,2026-09-05T08:00:00Z,4,2,mobile,"Promo, week 1"\r\n' +
      'L2,2026-09-05T09:00:00Z,5,1,,\n';
    const form = new FormData();
    form.set('platform', 'youtube');
    form.set('file', new File([csv], 'youtube-sep.csv', { type: 'text/csv' }));
    const r = await call(importUsage, '/api/periods/1/usage/import', { method: 'POST', cookie: admin, params: p(1), body: form });
    expect(r.status).toBe(201);
    expect(r.body.row_count).toBe(2);
    const docs = await (await mongoDb()).collection('usage_events').find({}, { sort: { track_id: 1 } }).toArray();
    expect(docs[0]).toMatchObject({ track_id: 4, plays: 2, device: 'mobile', raw: { campaign: 'Promo, week 1' } });
    expect(docs[1]).toMatchObject({ track_id: 5, raw: { campaign: '' } });
    expect(docs[1].device).toBeUndefined();
  });
  it('rejects the whole batch with 1-based row numbers when any row is invalid', async () => {
    const r = await upload([
      rows3[0],
      { track_id: 1, plays: 0, listener_hash: 'L9', played_at: '2026-09-03T10:00:00Z' },
      { track_id: 'x', plays: 1, played_at: 'yesterday' },
      ev(2, 'L2', '2026-10-01T00:00:00Z'),
      ev(999, 'L4', '2026-09-03T10:00:00Z'),
    ]);
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('4 invalid rows');
    expect(r.body.details).toEqual([
      { row: 2, message: 'plays: must be >= 1' },
      { row: 3, message: expect.stringMatching(/listener_hash: is required.*track_id: must be a whole number.*played_at: must be an ISO timestamp/) },
      { row: 4, message: 'played_at: 2026-10-01T00:00:00Z is outside period 2026-09' },
      { row: 5, message: 'track_id: track 999 does not exist' },
    ]);
    expect(await (await mongoDb()).collection('usage_batches').countDocuments()).toBe(0);
  });
  it('rejects unknown tracks and platforms (validated against PostgreSQL)', async () => {
    const r = await upload([rows3[0], ev(999, 'L1', '2026-09-03T10:00:00Z')]);
    expect(r.status).toBe(400);
    expect(r.body.details).toEqual([{ row: 2, message: 'track_id: track 999 does not exist' }]);
    expect((await upload(rows3, 'napster')).body.error).toBe('platform: unknown platform "napster"');
    expect((await upload([])).status).toBe(400);
  });
  it('rejects wrong file types, closed periods and non-admins', async () => {
    const form = new FormData();
    form.set('platform', 'spotify');
    form.set('file', new File(['hello'], 'report.txt'));
    const bad = await call(importUsage, '/api/periods/1/usage/import', { method: 'POST', cookie: admin, params: p(1), body: form });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/\.csv or \.json/);

    const closed = await upload([ev(1, 'L1', '2026-08-03T10:00:00Z')], 'spotify', 2);
    expect(closed.status).toBe(409);
    expect(closed.body.error).toBe('Period 2026-08 is closed');
    const asAuditor = await call(importUsage, '/api/periods/1/usage/import',
      { method: 'POST', cookie: auditor, params: p(1), body: { platform: 'spotify', source_file: 'x', rows: rows3 } });
    expect(asAuditor.status).toBe(403);
  });
});

describe('GET /api/usage/batches', () => {
  it('lists batches newest first with valid / void counts', async () => {
    await upload(rows3, 'spotify', 1, 'first.json');
    await upload([{ ...rows3[0], plays: 4 }], 'youtube', 1, 'second.json');
    const r = await call(listBatches, '/api/usage/batches?period_id=1', { cookie: auditor });
    expect(r.status).toBe(200);
    expect(r.body.batches.map((b: { source_file: string }) => b.source_file)).toEqual(['second.json', 'first.json']);
    expect(r.body.batches[1]).toMatchObject({ status: 'uploaded', row_count: 3, notes: [],
      counts: { valid: { events: 3, plays: 3 }, void: { events: 0, plays: 0 } } });
  });
  it('400 without period_id, 404 for an unknown period', async () => {
    expect((await call(listBatches, '/api/usage/batches', { cookie: admin })).status).toBe(400);
    expect((await call(listBatches, '/api/usage/batches?period_id=999', { cookie: admin })).status).toBe(404);
  });
});

describe('duplicates', () => {
  it('finds a report uploaded twice across batches and voids the extra copies', async () => {
    const first = await upload(rows3);
    await upload(rows3, 'spotify', 1, 'resend.json');
    const pre = await call(duplicates, '/api/periods/1/usage/duplicates', { cookie: admin, params: p(1) });
    expect(pre.status).toBe(200);
    expect(pre.body.extra_rows).toBe(3);
    expect(pre.body.groups[0]).toMatchObject({ track_id: 1, platform: 'spotify', listener_hash: 'L1', count: 2 });

    // Scoped to one batch there are none (each batch on its own is clean).
    const scoped = await call(duplicates, `/api/periods/1/usage/duplicates?batch_id=${first.body.batch_id}`,
      { cookie: admin, params: p(1) });
    expect(scoped.body.groups).toEqual([]);

    const v = await call(voidDuplicates, '/api/periods/1/usage/void-duplicates', { method: 'POST', cookie: admin, params: p(1), body: {} });
    expect(v.body).toEqual({ voided: 3 });
    expect((await call(duplicates, '/api/periods/1/usage/duplicates', { cookie: admin, params: p(1) })).body.extra_rows).toBe(0);
    const batches = (await call(listBatches, '/api/usage/batches?period_id=1', { cookie: admin })).body.batches;
    expect(batches.map((b: { status: string; counts: { void: { events: number } } }) => [b.status, b.counts.void.events]))
      .toEqual([['cleaned', 3], ['cleaned', 0]]);
  });
  it('404 for a batch of another period or a malformed id; 403 for the auditor', async () => {
    const other = await ops.ingest(await mongoDb(), { period_id: 2, platform: 'spotify', source_file: 'aug', uploaded_by: 1 }, []);
    const id = other.batch_id.toHexString();
    expect((await call(duplicates, `/api/periods/1/usage/duplicates?batch_id=${id}`, { cookie: admin, params: p(1) })).status).toBe(404);
    expect((await call(duplicates, '/api/periods/1/usage/duplicates?batch_id=nope', { cookie: admin, params: p(1) })).status).toBe(400);
    expect((await call(duplicates, '/api/periods/1/usage/duplicates', { cookie: auditor, params: p(1) })).status).toBe(403);
  });
});

describe('bot plays (flagged)', () => {
  const bot = Array.from({ length: 25 }, (_, i) => ev(6, 'BOT', `2026-09-10T03:${String(i * 2).padStart(2, '0')}:00Z`));
  it('lists listener-hours over the threshold and voids them', async () => {
    await upload([...rows3, ...bot]);
    const f = await call(flagged, '/api/periods/1/usage/flagged', { cookie: admin, params: p(1) });
    expect(f.status).toBe(200);
    expect(f.body.listeners).toEqual([{ platform: 'spotify', listener_hash: 'BOT', hour: '2026-09-10T03:00:00.000Z', plays: 25 }]);
    expect((await call(flagged, '/api/periods/1/usage/flagged?max_per_hour=30', { cookie: admin, params: p(1) })).body.listeners).toEqual([]);

    const v = await call(voidFlagged, '/api/periods/1/usage/void-flagged', { method: 'POST', cookie: admin, params: p(1), body: {} });
    expect(v.body).toEqual({ voided: 25, listeners: 1 });
  });
  it('400 for a bad threshold', async () => {
    expect((await call(flagged, '/api/periods/1/usage/flagged?max_per_hour=0', { cookie: admin, params: p(1) })).status).toBe(400);
    const r = await call(voidFlagged, '/api/periods/1/usage/void-flagged',
      { method: 'POST', cookie: admin, params: p(1), body: { max_per_hour: 'lots' } });
    expect(r.status).toBe(400);
  });
});

describe('DELETE /api/periods/:id/usage/voided', () => {
  it('purges only voided events and notes it on the batch', async () => {
    const b = await upload(rows3);
    await upload(rows3, 'spotify', 1, 'resend.json');
    await call(voidDuplicates, '/api/periods/1/usage/void-duplicates', { method: 'POST', cookie: admin, params: p(1), body: {} });
    const r = await call(purge, '/api/periods/1/usage/voided', { method: 'DELETE', cookie: admin, params: p(1) });
    expect(r.body).toEqual({ deleted: 3 });
    expect(await (await mongoDb()).collection('usage_events').countDocuments()).toBe(3);
    expect((await call(purge, `/api/periods/1/usage/voided?batch_id=${b.body.batch_id}`,
      { method: 'DELETE', cookie: admin, params: p(1) })).body).toEqual({ deleted: 0 });
  });
  it('409 once the period is closed', async () => {
    const r = await call(purge, '/api/periods/2/usage/voided', { method: 'DELETE', cookie: admin, params: p(2) });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('Period 2026-08 is closed');
  });
});

describe('dispute and resolve', () => {
  it('disputes and resolves a batch, appending notes', async () => {
    const id = (await upload(rows3)).body.batch_id;
    const d = await call(dispute, `/api/usage/batches/${id}/dispute`,
      { method: 'POST', cookie: admin, params: { batchId: id }, body: { note: 'Spotify says row counts are off' } });
    expect(d.status).toBe(200);
    expect(d.body.batch).toMatchObject({ batch_id: id, status: 'disputed',
      notes: [{ kind: 'dispute', text: 'Spotify says row counts are off' }] });

    const r = await call(resolve, `/api/usage/batches/${id}/resolve`,
      { method: 'POST', cookie: admin, params: { batchId: id }, body: { note: 'Confirmed by Spotify' } });
    expect(r.body.batch.status).toBe('cleaned');
    expect(r.body.batch.notes.map((n: { kind: string }) => n.kind)).toEqual(['dispute', 'resolve']);

    const again = await call(resolve, `/api/usage/batches/${id}/resolve`,
      { method: 'POST', cookie: admin, params: { batchId: id }, body: { note: 'again' } });
    expect(again.status).toBe(409);
    expect(again.body.error).toMatch(/is not disputed \(status: cleaned\)/);
  });
  it('409 for aggregated batches and closed periods; 404 / 400 for bad input', async () => {
    const db = await mongoDb();
    const id = (await upload(rows3)).body.batch_id;
    await ops.markAggregated(db, 1, 1);
    const agg = await call(dispute, `/api/usage/batches/${id}/dispute`,
      { method: 'POST', cookie: admin, params: { batchId: id }, body: { note: 'too late' } });
    expect(agg.status).toBe(409);
    expect(agg.body.error).toMatch(/already aggregated/);

    const aug = (await ops.ingest(db, { period_id: 2, platform: 'spotify', source_file: 'aug', uploaded_by: 1 }, [])).batch_id.toHexString();
    const closed = await call(dispute, `/api/usage/batches/${aug}/dispute`,
      { method: 'POST', cookie: admin, params: { batchId: aug }, body: { note: 'x' } });
    expect(closed.status).toBe(409);
    expect(closed.body.error).toBe('Period 2026-08 is closed');

    const missing = '0123456789abcdef01234567';
    expect((await call(dispute, `/api/usage/batches/${missing}/dispute`,
      { method: 'POST', cookie: admin, params: { batchId: missing }, body: { note: 'x' } })).status).toBe(404);
    expect((await call(dispute, `/api/usage/batches/${id}/dispute`,
      { method: 'POST', cookie: admin, params: { batchId: id }, body: { note: '  ' } })).status).toBe(400);
    expect((await call(dispute, `/api/usage/batches/${id}/dispute`,
      { method: 'POST', cookie: nova, params: { batchId: id }, body: { note: 'x' } })).status).toBe(403);
  });
});
