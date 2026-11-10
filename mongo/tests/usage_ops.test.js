// Vitest against the local MongoDB (MONGODB_URI from .env).
// Each run uses its own scratch database, initialised with mongo/init/01_init.js and dropped afterwards.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { MongoClient, ObjectId } from 'mongodb';
import ops from '../pipelines/usage_ops.js';

const DB = `royalty_events_test_${process.pid}`;
let client, db;

const at = (d, h, m = 0) => new Date(Date.UTC(2026, 8, d, h, m));
const row = (track_id, listener_hash, played_at, extra = {}) => ({ track_id, plays: 1, listener_hash, played_at, ...extra });
const meta = (platform, source_file = `${platform}.csv`) => ({ period_id: 1, platform, source_file, uploaded_by: 1 });

beforeAll(async () => {
  execFileSync('mongosh', [process.env.MONGODB_URI, '--quiet', '--eval', `var dbName = '${DB}'`, 'mongo/init/01_init.js']);
  client = await MongoClient.connect(process.env.MONGODB_URI);
  db = client.db(DB);
});
afterAll(async () => {
  await db?.dropDatabase();
  await client?.close();
});
beforeEach(async () => {
  await db.collection('usage_events').deleteMany({});
  await db.collection('usage_batches').deleteMany({});
});

describe('validators', () => {
  it('reject an event without listener_hash and a batch with an unknown status', async () => {
    await expect(db.collection('usage_events').insertOne({
      batch_id: new ObjectId(),
      period_id: 1, track_id: 1, platform: 'spotify', plays: 1, played_at: new Date(), status: 'valid'
    })).rejects.toThrow(/Document failed validation/);
    await expect(db.collection('usage_batches').insertOne({
      period_id: 1, platform: 'spotify', source_file: 'x', uploaded_by: 1, uploaded_at: new Date(),
      row_count: 0, status: 'weird', notes: []
    })).rejects.toThrow(/Document failed validation/);
  });

  it('create the agreed indexes', async () => {
    const keys = (await db.collection('usage_events').indexes()).map(i => JSON.stringify(i.key));
    expect(keys).toContain(JSON.stringify({ period_id: 1, status: 1 }));
    expect(keys).toContain(JSON.stringify({ batch_id: 1 }));
    expect(keys).toContain(JSON.stringify({ track_id: 1, platform: 1, listener_hash: 1, played_at: 1 }));
  });
});

describe('ingest', () => {
  it('stores a batch and its events with platform extras in raw', async () => {
    const { batch_id, row_count } = await ops.ingest(db, meta('spotify'),
      [row(1, 'a', at(1, 10), { device: 'mobile', raw: { premium: true } }), row(2, 'b', at(1, 11))]);
    expect(row_count).toBe(2);
    const batch = await db.collection('usage_batches').findOne({ _id: batch_id });
    expect(batch).toMatchObject({ status: 'uploaded', row_count: 2, platform: 'spotify', notes: [] });
    const ev = await db.collection('usage_events').find({ batch_id }).sort({ track_id: 1 }).toArray();
    expect(ev).toHaveLength(2);
    expect(ev[0]).toMatchObject({ period_id: 1, status: 'valid', device: 'mobile', raw: { premium: true } });
  });

  it('removes the batch again if any event is rejected', async () => {
    await expect(ops.ingest(db, meta('spotify'), [row(1, 'a', at(1, 10)), { ...row(1, 'b', at(1, 10)), plays: 0 }]))
      .rejects.toThrow();
    expect(await db.collection('usage_batches').countDocuments()).toBe(0);
    expect(await db.collection('usage_events').countDocuments()).toBe(0);
  });
});

describe('duplicates', () => {
  it('finds repeats within a batch and across batches of a period, and voids all but the first', async () => {
    const { batch_id: b1 } = await ops.ingest(db, meta('spotify'),
      [row(1, 'a', at(2, 9)), row(1, 'a', at(2, 9)), row(1, 'a', at(2, 10)), row(2, 'a', at(2, 9))]);
    const { batch_id: b2 } = await ops.ingest(db, meta('spotify', 'resend.csv'), [row(1, 'a', at(2, 9))]);

    expect(await ops.findDuplicates(db, { batchId: b1 })).toHaveLength(1);
    const groups = await ops.findDuplicates(db, { periodId: 1 });
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ track_id: 1, listener_hash: 'a', count: 3 });

    const { voided } = await ops.voidDuplicates(db, { periodId: 1, userId: 1 });
    expect(voided).toBe(2);
    const first = await db.collection('usage_events').findOne({ _id: groups[0].keep });
    expect(first.status).toBe('valid');
    expect(await db.collection('usage_events').countDocuments({ status: 'void', void_reason: 'duplicate' })).toBe(2);
    expect(await db.collection('usage_events').countDocuments({ batch_id: b2, status: 'void' })).toBe(1);
    expect((await db.collection('usage_batches').findOne({ _id: b1 })).status).toBe('cleaned');
    expect(await ops.findDuplicates(db, { periodId: 1 })).toHaveLength(0);
  });

  it('adds a clean note when voiding one batch', async () => {
    const { batch_id } = await ops.ingest(db, meta('youtube'), [row(3, 'x', at(3, 1)), row(3, 'x', at(3, 1))]);
    await ops.voidDuplicates(db, { batchId: batch_id, userId: 7 });
    const batch = await db.collection('usage_batches').findOne({ _id: batch_id });
    expect(batch.notes.at(-1)).toMatchObject({ by: 7, kind: 'clean', text: 'voided 1 duplicate event(s)' });
  });
});

describe('bot heuristic', () => {
  it('voids every play of a listener-hour above the threshold, and nothing else', async () => {
    const burst = Array.from({ length: 25 }, (_, i) => row(1, 'bot', at(5, 14, i * 2)));
    const normal = [row(1, 'human', at(5, 14, 1)), row(1, 'bot', at(5, 16, 0))];
    const { batch_id } = await ops.ingest(db, meta('spotify'), [...burst, ...normal]);

    const flagged = await ops.findFlagged(db, { batchId: batch_id });
    expect(flagged).toHaveLength(1);
    expect(flagged[0]).toMatchObject({ listener_hash: 'bot', plays: 25 });
    expect(await ops.findFlagged(db, { batchId: batch_id, maxPlaysPerHour: 30 })).toHaveLength(0);

    const r = await ops.voidFlagged(db, { batchId: batch_id, userId: 1 });
    expect(r).toEqual({ voided: 25, listeners: 1 });
    expect(await db.collection('usage_events').countDocuments({ status: 'valid' })).toBe(2);
  });
});

describe('aggregateUsage (the PostgreSQL interface)', () => {
  it('returns { track_id, platform, plays } of valid events, without disputed batches', async () => {
    await ops.ingest(db, meta('spotify'), [row(1, 'a', at(1, 1)), row(1, 'b', at(1, 2)), { ...row(2, 'a', at(1, 3)), plays: 5 }]);
    await ops.ingest(db, meta('youtube'), [row(1, 'c', at(1, 4))]);
    const { batch_id: disputed } = await ops.ingest(db, meta('apple_music'), [row(1, 'd', at(1, 5))]);
    await ops.ingest(db, { ...meta('spotify'), period_id: 2 }, [row(1, 'z', at(1, 6))]);   // other period
    await db.collection('usage_events').updateOne({ listener_hash: 'b' }, { $set: { status: 'void', void_reason: 'manual' } });
    await ops.disputeBatch(db, disputed, 1, 'rates look wrong');

    expect(await ops.aggregateUsage(db, 1)).toEqual([
      { track_id: 1, platform: 'spotify', plays: 1 },
      { track_id: 1, platform: 'youtube', plays: 1 },
      { track_id: 2, platform: 'spotify', plays: 5 },
    ]);
  });
});

describe('dispute, resolve, purge, aggregated', () => {
  it('records notes and moves the batch through its statuses', async () => {
    const { batch_id } = await ops.ingest(db, meta('spotify'), [row(1, 'a', at(1, 1)), row(1, 'a', at(1, 1))]);
    expect(await ops.disputeBatch(db, batch_id, 3, 'platform resent this file')).toEqual({ updated: 1 });
    expect(await ops.resolveDispute(db, batch_id, 3, 'confirmed with platform')).toEqual({ updated: 1 });
    expect(await ops.resolveDispute(db, batch_id, 3, 'again')).toEqual({ updated: 0 });   // not disputed any more

    await ops.voidDuplicates(db, { batchId: batch_id, userId: 3 });
    expect(await ops.purgeVoided(db, { batchId: batch_id, userId: 3 })).toEqual({ deleted: 1 });
    expect(await db.collection('usage_events').countDocuments()).toBe(1);

    expect(await ops.markAggregated(db, 1, 3)).toEqual({ updated: 1 });
    expect(await ops.disputeBatch(db, batch_id, 3, 'too late')).toEqual({ updated: 0 });  // aggregated is final

    const batch = await db.collection('usage_batches').findOne({ _id: batch_id });
    expect(batch.status).toBe('aggregated');
    expect(batch.notes.map(n => n.kind)).toEqual(['dispute', 'resolve', 'clean', 'purge', 'aggregate']);
  });

  it('lists batches newest first with per-status counts', async () => {
    const { batch_id } = await ops.ingest(db, meta('spotify'), [row(1, 'a', at(1, 1)), row(1, 'a', at(1, 1))]);
    await ops.voidDuplicates(db, { batchId: batch_id, userId: 1 });
    expect(await ops.listBatches(db, 1)).toHaveLength(1);
    const [stats] = await ops.batchStats(db, 1);
    expect(stats.batch_id.equals(batch_id)).toBe(true);
    expect(stats.by_status).toEqual({ valid: { events: 1, plays: 1 }, void: { events: 1, plays: 1 } });
  });
});
