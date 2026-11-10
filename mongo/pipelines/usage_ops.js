// =====================================================================
// MongoDB usage operations used by the app (and the tests).
// CommonJS, so Next.js route handlers and Vitest can import it.
// Every function takes a `db` handle for the royalty_events database.
//
// The one output PostgreSQL consumes is aggregateUsage():
//     [{ track_id: Number, platform: String (= platform.code), plays: Number }]
// =====================================================================
const { ObjectId } = require('mongodb');

const DEFAULT_BOT_PLAYS_PER_HOUR = 20;

const batches = db => db.collection('usage_batches');
const events  = db => db.collection('usage_events');
const toId    = id => (id instanceof ObjectId ? id : new ObjectId(String(id)));

// Batch filter for "one batch" or "every batch of a period".
function scope({ batchId, periodId }) {
  if (batchId != null) return { batch_id: toId(batchId) };
  if (periodId != null) return { period_id: periodId };
  throw new Error('batchId or periodId is required');
}

// A notes[] entry; `by` is the app_user id (0 = system, e.g. the seed script).
const note = (userId, kind, text) => ({ at: new Date(), by: userId ?? 0, kind, text });

async function addNote(db, batchId, userId, kind, text) {
  await batches(db).updateOne({ _id: toId(batchId) }, { $push: { notes: note(userId, kind, text) } });
}

// ---- CREATE ----------------------------------------------------------------
// Insert one uploaded report: a batch document plus one event per row.
// rows: [{ track_id, plays, listener_hash, played_at: Date, device?, raw? }] (validated by the caller).
// MongoDB here runs without a replica set (no multi-document transactions), so if the
// events cannot be inserted the batch is removed again (compensating delete).
async function ingest(db, { period_id, platform, source_file, uploaded_by }, rows) {
  const batch = {
    period_id, platform, source_file, uploaded_by,
    uploaded_at: new Date(), row_count: rows.length, status: 'uploaded', notes: []
  };
  const { insertedId } = await batches(db).insertOne(batch);
  try {
    if (rows.length) {
      await events(db).insertMany(rows.map(r => ({
        batch_id: insertedId, period_id, platform,
        track_id: r.track_id, plays: r.plays, listener_hash: r.listener_hash, played_at: r.played_at,
        ...(r.device ? { device: r.device } : {}),
        status: 'valid',
        ...(r.raw ? { raw: r.raw } : {})
      })));
    }
  } catch (err) {
    await events(db).deleteMany({ batch_id: insertedId });
    await batches(db).deleteOne({ _id: insertedId });
    throw err;
  }
  return { batch_id: insertedId, row_count: rows.length };
}

// ---- READ ------------------------------------------------------------------
// Groups of valid events that report the same play twice: same track, platform,
// listener and timestamp. `keep` is the first-inserted event; `duplicates` are the rest.
function findDuplicates(db, { batchId, periodId } = {}) {
  return events(db).aggregate([
    { $match: { ...scope({ batchId, periodId }), status: 'valid' } },
    { $sort: { _id: 1 } },
    { $group: {
        _id: { track_id: '$track_id', platform: '$platform', listener_hash: '$listener_hash', played_at: '$played_at' },
        ids: { $push: '$_id' }, plays: { $sum: '$plays' }, n: { $sum: 1 } } },
    { $match: { n: { $gt: 1 } } },
    { $project: { _id: 0, track_id: '$_id.track_id', platform: '$_id.platform', listener_hash: '$_id.listener_hash',
                  played_at: '$_id.played_at', count: '$n', keep: { $first: '$ids' },
                  duplicates: { $slice: ['$ids', 1, { $subtract: ['$n', 1] }] } } },
    { $sort: { played_at: 1, track_id: 1 } }
  ]).toArray();
}

// Bot heuristic: a listener with more than `maxPlaysPerHour` plays in one clock hour
// (per platform). Returns the offending listener-hours.
function findFlagged(db, { batchId, periodId, maxPlaysPerHour = DEFAULT_BOT_PLAYS_PER_HOUR } = {}) {
  return events(db).aggregate([
    { $match: { ...scope({ batchId, periodId }), status: 'valid' } },
    { $group: {
        _id: { platform: '$platform', listener_hash: '$listener_hash',
               hour: { $dateTrunc: { date: '$played_at', unit: 'hour' } } },
        plays: { $sum: '$plays' }, ids: { $push: '$_id' } } },
    { $match: { plays: { $gt: maxPlaysPerHour } } },
    { $project: { _id: 0, platform: '$_id.platform', listener_hash: '$_id.listener_hash', hour: '$_id.hour',
                  plays: 1, event_count: { $size: '$ids' }, ids: 1 } },
    { $sort: { plays: -1 } }
  ]).toArray();
}

// THE interface to PostgreSQL: valid plays of a period per track and platform.
// Events of disputed batches are excluded (callers refuse to aggregate while one is disputed).
async function aggregateUsage(db, periodId) {
  const disputed = await batches(db).distinct('_id', { period_id: periodId, status: 'disputed' });
  return events(db).aggregate([
    { $match: { period_id: periodId, status: 'valid', batch_id: { $nin: disputed } } },
    { $group: { _id: { track_id: '$track_id', platform: '$platform' }, plays: { $sum: '$plays' } } },
    { $project: { _id: 0, track_id: '$_id.track_id', platform: '$_id.platform', plays: 1 } },
    { $sort: { track_id: 1, platform: 1 } }
  ]).toArray();
}

function listBatches(db, periodId) {
  return batches(db).find(periodId != null ? { period_id: periodId } : {}).sort({ uploaded_at: -1 }).toArray();
}

// Valid / void event and play counts per batch (for batch lists).
function batchStats(db, periodId) {
  return events(db).aggregate([
    { $match: { period_id: periodId } },
    { $group: { _id: { batch_id: '$batch_id', status: '$status' }, events: { $sum: 1 }, plays: { $sum: '$plays' } } },
    { $group: { _id: '$_id.batch_id', by_status: { $push: { k: '$_id.status', v: { events: '$events', plays: '$plays' } } } } },
    { $project: { _id: 0, batch_id: '$_id', by_status: { $arrayToObject: '$by_status' } } }
  ]).toArray();
}

// ---- UPDATE ----------------------------------------------------------------
async function markCleaned(db, filter) {
  await batches(db).updateMany({ ...filter, status: 'uploaded' }, { $set: { status: 'cleaned' } });
}

function batchFilter({ batchId, periodId }) {
  return batchId != null ? { _id: toId(batchId) } : { period_id: periodId };
}

// Void every duplicate except the first-inserted event of each group.
async function voidDuplicates(db, { batchId, periodId, userId } = {}) {
  const groups = await findDuplicates(db, { batchId, periodId });
  const ids = groups.flatMap(g => g.duplicates);
  let voided = 0;
  if (ids.length) {
    const r = await events(db).updateMany({ _id: { $in: ids }, status: 'valid' },
      { $set: { status: 'void', void_reason: 'duplicate' } });
    voided = r.modifiedCount;
  }
  await markCleaned(db, batchFilter({ batchId, periodId }));
  if (batchId != null) await addNote(db, batchId, userId, 'clean', `voided ${voided} duplicate event(s)`);
  return { voided };
}

// Void all events of listener-hours that exceed the bot threshold.
async function voidFlagged(db, { batchId, periodId, userId, maxPlaysPerHour = DEFAULT_BOT_PLAYS_PER_HOUR } = {}) {
  const flagged = await findFlagged(db, { batchId, periodId, maxPlaysPerHour });
  const ids = flagged.flatMap(f => f.ids);
  let voided = 0;
  if (ids.length) {
    const r = await events(db).updateMany({ _id: { $in: ids }, status: 'valid' },
      { $set: { status: 'void', void_reason: 'bot' } });
    voided = r.modifiedCount;
  }
  await markCleaned(db, batchFilter({ batchId, periodId }));
  if (batchId != null) {
    await addNote(db, batchId, userId, 'clean', `voided ${voided} event(s) over ${maxPlaysPerHour} plays/listener/hour`);
  }
  return { voided, listeners: flagged.length };
}

// Hold a batch out of aggregation until the dispute is resolved.
async function disputeBatch(db, batchId, userId, text) {
  const r = await batches(db).updateOne({ _id: toId(batchId), status: { $ne: 'aggregated' } },
    { $set: { status: 'disputed' }, $push: { notes: note(userId, 'dispute', text) } });
  return { updated: r.modifiedCount };
}

async function resolveDispute(db, batchId, userId, text) {
  const r = await batches(db).updateOne({ _id: toId(batchId), status: 'disputed' },
    { $set: { status: 'cleaned' }, $push: { notes: note(userId, 'resolve', text) } });
  return { updated: r.modifiedCount };
}

// After usage_summary has been written in PostgreSQL.
async function markAggregated(db, periodId, userId) {
  const r = await batches(db).updateMany({ period_id: periodId, status: { $in: ['uploaded', 'cleaned'] } },
    { $set: { status: 'aggregated' },
      $push: { notes: note(userId, 'aggregate', 'included in usage_summary') } });
  return { updated: r.modifiedCount };
}

// ---- DELETE ----------------------------------------------------------------
// Permanently remove voided events (they never count towards money anyway).
async function purgeVoided(db, { batchId, periodId, userId } = {}) {
  const r = await events(db).deleteMany({ ...scope({ batchId, periodId }), status: 'void' });
  if (batchId != null) await addNote(db, batchId, userId, 'purge', `purged ${r.deletedCount} voided event(s)`);
  return { deleted: r.deletedCount };
}

module.exports = {
  DEFAULT_BOT_PLAYS_PER_HOUR,
  ingest, findDuplicates, findFlagged, aggregateUsage, listBatches, batchStats,
  voidDuplicates, voidFlagged, disputeBatch, resolveDispute, markAggregated, purgeVoided
};
