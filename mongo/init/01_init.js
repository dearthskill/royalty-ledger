// =====================================================================
// MongoDB schema: collections, $jsonSchema validators, indexes.
// Runs automatically in docker-compose (mongo/init is mounted into
// /docker-entrypoint-initdb.d), or manually:  mongosh "$MONGODB_URI" mongo/init/01_init.js
// Safe to re-run: existing collections get their validator updated (collMod).
//
// Why MongoDB here: usage reports arrive from many platforms with different
// fields (kept in `raw`) and at high volume, are written once and then cleaned
// (voided, disputed, purged) and summarised by aggregation pipelines.
// The money itself stays in PostgreSQL, where it needs ACID and constraints.
// =====================================================================
const target = db.getSiblingDB(typeof dbName === 'string' ? dbName : 'royalty_events');

const intType = ['int', 'long'];

const batchSchema = {
  bsonType: 'object',
  required: ['period_id', 'platform', 'source_file', 'uploaded_by', 'uploaded_at', 'row_count', 'status', 'notes'],
  additionalProperties: false,
  properties: {
    _id:         { bsonType: 'objectId' },
    period_id:   { bsonType: intType, minimum: 1, description: 'payout_period.period_id in PostgreSQL' },
    platform:    { bsonType: 'string', pattern: '^[a-z_]+$', description: 'platform.code in PostgreSQL' },
    source_file: { bsonType: 'string', minLength: 1 },
    uploaded_by: { bsonType: intType, description: 'app_user.user_id in PostgreSQL' },
    uploaded_at: { bsonType: 'date' },
    row_count:   { bsonType: intType, minimum: 0 },
    status:      { enum: ['uploaded', 'cleaned', 'disputed', 'aggregated'] },
    notes: {                                   // review / dispute history, appended with $push
      bsonType: 'array',
      items: {
        bsonType: 'object',
        required: ['at', 'by', 'kind', 'text'],
        properties: {
          at:   { bsonType: 'date' },
          by:   { bsonType: intType },
          kind: { enum: ['dispute', 'resolve', 'clean', 'purge', 'aggregate', 'note'] },
          text: { bsonType: 'string', minLength: 1 }
        }
      }
    }
  }
};

const eventSchema = {
  bsonType: 'object',
  required: ['batch_id', 'period_id', 'track_id', 'platform', 'plays', 'listener_hash', 'played_at', 'status'],
  properties: {
    batch_id:      { bsonType: 'objectId', description: 'usage_batches._id' },
    period_id:     { bsonType: intType, minimum: 1 },
    track_id:      { bsonType: intType, minimum: 1, description: 'track.track_id in PostgreSQL' },
    platform:      { bsonType: 'string', pattern: '^[a-z_]+$' },
    plays:         { bsonType: intType, minimum: 1 },
    listener_hash: { bsonType: 'string', minLength: 1, description: 'anonymised listener id from the platform' },
    played_at:     { bsonType: 'date' },
    device:        { bsonType: 'string' },
    status:        { enum: ['valid', 'void'] },
    void_reason:   { enum: ['duplicate', 'bot', 'manual'] },
    raw:           { bsonType: 'object', description: 'platform-specific extra fields, kept as sent' }
  }
};

function ensureCollection(name, schema) {
  if (target.getCollectionNames().includes(name)) {
    target.runCommand({ collMod: name, validator: { $jsonSchema: schema }, validationLevel: 'strict' });
  } else {
    target.createCollection(name, { validator: { $jsonSchema: schema }, validationLevel: 'strict' });
  }
}

ensureCollection('usage_batches', batchSchema);
ensureCollection('usage_events', eventSchema);

target.usage_batches.createIndex({ period_id: 1, status: 1 });
target.usage_events.createIndex({ period_id: 1, status: 1 });                                // aggregation, period views
target.usage_events.createIndex({ batch_id: 1 });                                            // batch views, purge
target.usage_events.createIndex({ track_id: 1, platform: 1, listener_hash: 1, played_at: 1 }); // duplicate detection

print(target.getName() + ' initialised: ' + target.getCollectionNames().sort().join(', '));
