// Demo usage data for September 2026 (matches the PostgreSQL seed: tracks 1-3, period 1).
// Deterministic, so every teammate gets identical data:  mongosh <uri> mongo/seed/seed_events.js
// Includes deliberate duplicates (same source_ref) and bot-flagged rows so the
// void / purge / dispute flows have something to act on.
const events = db.getSiblingDB('royalty_events');
events.usage_events.deleteMany({});
events.usage_batches.deleteMany({});

let seed = 42;
const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const platforms = ['spotify', 'youtube', 'apple_music', 'radio'];
const tracks = [1, 2, 3];
const countries = ['IN', 'US', 'GB', 'DE', 'BR'];

platforms.forEach((platform, pi) => {
  const batchId = 'seed-batch-' + platform;
  const docs = [];
  for (let day = 1; day <= 30; day++) {
    tracks.forEach(track_id => {
      const plays = Math.floor(2000 + rnd() * 18000);
      const base = {
        event_id: batchId + '-' + track_id + '-' + day,
        source_ref: platform + '-' + track_id + '-' + day,
        batch_id: batchId, track_id, platform,
        occurred_at: new Date(Date.UTC(2026, 8, day)),
        plays, country: countries[Math.floor(rnd() * countries.length)],
        status: 'valid', flags: [],
        // differs per platform on purpose
        platform_payload: platform === 'spotify' ? { playlist_share: +(rnd()).toFixed(2), premium: rnd() > 0.5 }
                        : platform === 'youtube' ? { watch_minutes: plays * 3, ad_revenue_share: 0.55 }
                        : platform === 'apple_music' ? { storefront: 'in', library_adds: Math.floor(rnd() * 50) }
                        : { station_count: Math.floor(rnd() * 12) + 1 }
      };
      docs.push(base);
      if (day % 10 === 0) docs.push({ ...base, event_id: base.event_id + '-dup' });          // duplicate row
      if (day % 7 === 0 && track_id === 1) docs.push({ ...base, event_id: base.event_id + '-bot',
        source_ref: base.source_ref + '-bot', plays: 50000, flags: ['bot'] });                // suspicious spike
    });
  }
  events.usage_events.insertMany(docs);
  events.usage_batches.insertOne({
    batch_id: batchId, platform, period_id: 1, file_name: platform + '_2026_09.csv',
    uploaded_by: 1, uploaded_at: new Date(), event_count: docs.length, status: 'ingested', notes: []
  });
});
print('seeded ' + events.usage_events.countDocuments() + ' events in ' + events.usage_batches.countDocuments() + ' batches');
