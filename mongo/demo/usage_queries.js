// =====================================================================
// MongoDB read / update / delete on the usage collections, with printed results.
// Run on a scratch copy by scripts/run_mongo_queries.sh (init + seed + this file, then dropped);
// the app does the same through mongo/pipelines/usage_ops.js.
// =====================================================================
const t = db.getSiblingDB(typeof dbName === 'string' ? dbName : 'royalty_events');
const show = (title, value) => { print('\n// ' + title); printjson(value); };

// ---------- READ ----------
show('R1 find + projection + sort + limit: one listener\'s first plays',
  t.usage_events.find({ period_id: 1, listener_hash: 'lh_186a0' },
    { _id: 0, track_id: 1, platform: 1, played_at: 1, device: 1 }).sort({ played_at: 1 }).limit(3).toArray());

show('R2 query inside the platform-specific raw field: YouTube plays watched under 60 s',
  t.usage_events.countDocuments({ platform: 'youtube', 'raw.watch_seconds': { $lt: 60 } }));

show('R3 batches with event counts ($group per batch, $lookup the batch file name)',
  t.usage_events.aggregate([
    { $group: { _id: '$batch_id', events: { $sum: 1 }, plays: { $sum: '$plays' } } },
    { $lookup: { from: 'usage_batches', localField: '_id', foreignField: '_id', as: 'b' } },
    { $project: { _id: 0, file: { $first: '$b.source_file' }, events: 1, plays: 1 } },
    { $sort: { file: 1 } }]).toArray());

const dupGroups = t.usage_events.aggregate([
  { $match: { period_id: 1, status: 'valid' } },
  { $sort: { _id: 1 } },
  { $group: { _id: { track_id: '$track_id', platform: '$platform', listener_hash: '$listener_hash', played_at: '$played_at' },
              ids: { $push: '$_id' }, n: { $sum: 1 } } },
  { $match: { n: { $gt: 1 } } }]).toArray();
show('R4 duplicate detection: same track, platform, listener and timestamp (groups, extra rows)',
  { groups: dupGroups.length, extra_rows: dupGroups.reduce((s, g) => s + g.n - 1, 0) });

const bots = t.usage_events.aggregate([
  { $match: { period_id: 1, status: 'valid' } },
  { $group: { _id: { platform: '$platform', listener_hash: '$listener_hash', hour: { $dateTrunc: { date: '$played_at', unit: 'hour' } } },
              plays: { $sum: '$plays' }, ids: { $push: '$_id' } } },
  { $match: { plays: { $gt: 20 } } }]).toArray();
show('R5 bot heuristic: listener-hours with more than 20 plays',
  bots.map(b => ({ platform: b._id.platform, listener_hash: b._id.listener_hash, hour: b._id.hour, plays: b.plays })));

// ---------- UPDATE ----------
show('U1 updateMany: void the duplicates (keep the first copy of each group)',
  t.usage_events.updateMany({ _id: { $in: dupGroups.flatMap(g => g.ids.slice(1)) } },
    { $set: { status: 'void', void_reason: 'duplicate' } }));
show('U2 updateMany: void the bot plays',
  t.usage_events.updateMany({ _id: { $in: bots.flatMap(b => b.ids) }, status: 'valid' },
    { $set: { status: 'void', void_reason: 'bot' } }));
const resend = t.usage_batches.findOne({ source_file: 'spotify_2026_09_resend.csv' });
show('U3 updateOne with $set + $push: dispute the resent batch (note kept in its history)',
  t.usage_batches.updateOne({ _id: resend._id, status: { $ne: 'aggregated' } },
    { $set: { status: 'disputed' }, $push: { notes: { at: new Date(), by: NumberInt(1), kind: 'dispute', text: 'resend of an earlier report' } } }));
show('    the batch afterwards', t.usage_batches.findOne({ _id: resend._id }, { _id: 0, source_file: 1, status: 1, notes: 1 }));

// ---------- DELETE ----------
show('    events by status before the purge',
  t.usage_events.aggregate([{ $group: { _id: { status: '$status', reason: '$void_reason' }, events: { $sum: 1 } } }, { $sort: { _id: 1 } }]).toArray());
show('D1 deleteMany: purge voided events', t.usage_events.deleteMany({ period_id: 1, status: 'void' }));

// ---------- the boundary to PostgreSQL ----------
const disputed = t.usage_batches.distinct('_id', { period_id: 1, status: 'disputed' });
show('R6 aggregateUsage: { track_id, platform, plays } for usage_summary (disputed batches excluded), first 5 rows',
  t.usage_events.aggregate([
    { $match: { period_id: 1, status: 'valid', batch_id: { $nin: disputed } } },
    { $group: { _id: { track_id: '$track_id', platform: '$platform' }, plays: { $sum: '$plays' } } },
    { $project: { _id: 0, track_id: '$_id.track_id', platform: '$_id.platform', plays: 1 } },
    { $sort: { track_id: 1, platform: 1 } }, { $limit: 5 }]).toArray());

show('Validator: an event without listener_hash is rejected', (() => {
  try { t.usage_events.insertOne({ batch_id: resend._id, period_id: NumberInt(1), track_id: NumberInt(1), platform: 'spotify',
          plays: NumberInt(1), played_at: new Date(), status: 'valid' }); return 'inserted?!'; }
  catch (e) { return e.errInfo ? 'Document failed validation (' + e.code + ')' : e.message; }
})());
