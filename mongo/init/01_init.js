// =====================================================================
// MongoDB schema: collections, validators, indexes.
// Runs automatically in docker-compose (mongo/init is mounted into
// /docker-entrypoint-initdb.d), or manually:  mongosh <uri> mongo/init/01_init.js
//
// Why MongoDB here: usage reports arrive from many platforms with different
// fields and at high volume, and are corrected after the fact (voided,
// disputed, purged). Documents with a free-form `platform_payload` fit that;
// the money itself stays in PostgreSQL where it needs ACID and constraints.
// =====================================================================
const dbName = 'royalty_events';
const events = db.getSiblingDB(dbName);

// ---- usage_batches: one uploaded platform report -----------------------
events.createCollection('usage_batches', {
  validator: { $jsonSchema: {
    bsonType: 'object',
    required: ['batch_id', 'platform', 'uploaded_by', 'uploaded_at', 'status', 'notes'],
    properties: {
      batch_id:    { bsonType: 'string', description: 'client-generated unique id (UUID)' },
      platform:    { bsonType: 'string', pattern: '^[a-z_]+$', description: 'matches platform.code in PostgreSQL' },
      period_id:   { bsonType: ['int', 'long'], description: 'payout_period.period_id in PostgreSQL' },
      file_name:   { bsonType: 'string' },
      uploaded_by: { bsonType: ['int', 'long'], description: 'app_user.user_id in PostgreSQL' },
      uploaded_at: { bsonType: 'date' },
      event_count: { bsonType: ['int', 'long'], minimum: 0 },
      status:      { enum: ['ingested', 'aggregated', 'disputed'] },
      notes: {                                  // dispute / review notes, appended with $push
        bsonType: 'array',
        items: {
          bsonType: 'object',
          required: ['at', 'by', 'text'],
          properties: {
            at:   { bsonType: 'date' },
            by:   { bsonType: ['int', 'long'] },
            text: { bsonType: 'string', minLength: 1 }
          }
        }
      }
    }
  } }
});
events.usage_batches.createIndex({ batch_id: 1 }, { unique: true });
events.usage_batches.createIndex({ period_id: 1, platform: 1 });

// ---- usage_events: one row of a platform report -------------------------
events.createCollection('usage_events', {
  validator: { $jsonSchema: {
    bsonType: 'object',
    required: ['event_id', 'batch_id', 'track_id', 'platform', 'occurred_at', 'plays', 'status'],
    properties: {
      event_id:    { bsonType: 'string', description: 'unique id of this record' },
      source_ref:  { bsonType: 'string', description: 'platform-side row id; duplicates share it' },
      batch_id:    { bsonType: 'string' },
      track_id:    { bsonType: ['int', 'long'], description: 'track.track_id in PostgreSQL' },
      platform:    { bsonType: 'string', pattern: '^[a-z_]+$' },
      occurred_at: { bsonType: 'date' },
      plays:       { bsonType: ['int', 'long'], minimum: 0 },
      country:     { bsonType: 'string', minLength: 2, maxLength: 2 },
      status:      { enum: ['valid', 'void', 'disputed'] },
      flags:       { bsonType: 'array', items: { bsonType: 'string' } },   // e.g. 'duplicate', 'bot'
      void_reason: { bsonType: 'string' },
      voided_by:   { bsonType: ['int', 'long'] },
      voided_at:   { bsonType: 'date' },
      platform_payload: { bsonType: 'object', description: 'free-form, differs per platform' }
    }
  } }
});
events.usage_events.createIndex({ event_id: 1 }, { unique: true });
// serves the aggregation pipeline (match period range + status, group by track/platform)
events.usage_events.createIndex({ status: 1, occurred_at: 1, track_id: 1, platform: 1 });
events.usage_events.createIndex({ batch_id: 1, status: 1 });
events.usage_events.createIndex({ source_ref: 1, platform: 1 });          // duplicate detection
// voided events are removed automatically 90 days after voiding
events.usage_events.createIndex(
  { voided_at: 1 },
  { expireAfterSeconds: 60 * 60 * 24 * 90, partialFilterExpression: { status: 'void' } }
);

print('royalty_events initialised: ' + events.getCollectionNames().join(', '));
