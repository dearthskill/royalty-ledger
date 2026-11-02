// =====================================================================
// MongoDB operations used by the app. Plain CommonJS so Next.js route
// handlers can `require`/import it, and mongosh can `load()` it.
// Every function takes a mongodb `db` handle (royalty_events) and returns the
// driver's promise. Dates are JS Date objects (period_end is INCLUSIVE).
// =====================================================================

// ---- READ ----------------------------------------------------------------
// The pipeline that feeds PostgreSQL. Output rows are the interface contract:
//   { track_id: Number, platform: String (= platform.code), plays: Number }
// The app maps `platform` -> platform_id and upserts into usage_summary.
function aggregateUsagePipeline(periodStart, periodEnd) {
  const endExclusive = new Date(periodEnd.getTime() + 24 * 60 * 60 * 1000);
  return [
    { $match: { status: 'valid', occurred_at: { $gte: periodStart, $lt: endExclusive } } },
    { $group: { _id: { track_id: '$track_id', platform: '$platform' }, plays: { $sum: '$plays' } } },
    { $project: { _id: 0, track_id: '$_id.track_id', platform: '$_id.platform', plays: 1 } },
    { $sort: { track_id: 1, platform: 1 } }
  ];
}

function aggregateUsage(db, periodStart, periodEnd) {
  return db.collection('usage_events').aggregate(aggregateUsagePipeline(periodStart, periodEnd)).toArray();
}

// Report rows that share (platform, source_ref): likely duplicates inside a batch.
function findDuplicates(db, batchId) {
  return db.collection('usage_events').aggregate([
    { $match: { batch_id: batchId, status: 'valid', source_ref: { $exists: true } } },
    { $sort: { occurred_at: 1, event_id: 1 } },
    { $group: { _id: { platform: '$platform', source_ref: '$source_ref' },
                event_ids: { $push: '$event_id' }, n: { $sum: 1 } } },
    { $match: { n: { $gt: 1 } } }
  ]).toArray();
}

// ---- CREATE --------------------------------------------------------------
async function ingestBatch(db, batch, events) {
  await db.collection('usage_batches').insertOne({
    ...batch, status: 'ingested', notes: [], event_count: events.length, uploaded_at: new Date()
  });
  if (events.length) {
    await db.collection('usage_events').insertMany(
      events.map(e => ({ ...e, batch_id: batch.batch_id, status: 'valid', flags: e.flags || [] })),
      { ordered: false });
  }
  return events.length;
}

// ---- UPDATE --------------------------------------------------------------
// Void every duplicate except the first row of each duplicate group.
async function voidDuplicates(db, batchId, userId) {
  const groups = await findDuplicates(db, batchId);
  const toVoid = groups.flatMap(g => g.event_ids.slice(1));
  if (!toVoid.length) return 0;
  const r = await db.collection('usage_events').updateMany(
    { event_id: { $in: toVoid }, status: 'valid' },
    { $set: { status: 'void', void_reason: 'duplicate', voided_by: userId, voided_at: new Date() },
      $addToSet: { flags: 'duplicate' } });
  return r.modifiedCount;
}

// Void events carrying a flag (e.g. 'bot') in a batch, with a reason.
function voidFlagged(db, batchId, flag, reason, userId) {
  return db.collection('usage_events').updateMany(
    { batch_id: batchId, status: 'valid', flags: flag },
    { $set: { status: 'void', void_reason: reason, voided_by: userId, voided_at: new Date() } });
}

// Attach a dispute note and mark the batch disputed; its events are held out of aggregation.
async function disputeBatch(db, batchId, userId, text) {
  await db.collection('usage_batches').updateOne(
    { batch_id: batchId },
    { $set: { status: 'disputed' }, $push: { notes: { at: new Date(), by: userId, text } } });
  return db.collection('usage_events').updateMany(
    { batch_id: batchId, status: 'valid' }, { $set: { status: 'disputed' } });
}

// Resolve a dispute: events become valid again.
async function resolveDispute(db, batchId, userId, text) {
  await db.collection('usage_batches').updateOne(
    { batch_id: batchId },
    { $set: { status: 'ingested' }, $push: { notes: { at: new Date(), by: userId, text } } });
  return db.collection('usage_events').updateMany(
    { batch_id: batchId, status: 'disputed' }, { $set: { status: 'valid' } });
}

async function markBatchAggregated(db, batchId) {
  return db.collection('usage_batches').updateOne({ batch_id: batchId }, { $set: { status: 'aggregated' } });
}

// ---- DELETE --------------------------------------------------------------
// Permanently purge voided events (fraud / bot streams) of a batch.
function purgeVoided(db, batchId) {
  return db.collection('usage_events').deleteMany({ batch_id: batchId, status: 'void' });
}

module.exports = {
  aggregateUsagePipeline, aggregateUsage, findDuplicates,
  ingestBatch, voidDuplicates, voidFlagged, disputeBatch, resolveDispute,
  markBatchAggregated, purgeVoided
};
