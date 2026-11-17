// =====================================================================
// Demo usage events for period 1 ('2026-09' in the PostgreSQL seed), tracks 1-7.
// Deterministic (fixed PRNG seed), so every teammate gets identical data:
//     mongosh "$MONGODB_URI" mongo/seed/seed_events.js
// Replaces all usage data. Contains, on purpose:
//   * a "resent" Spotify report that repeats 120 events already uploaded (duplicates)
//   * 30 in-batch duplicate rows in the YouTube report
//   * a bot pattern: one listener with 150 plays of track 1 within one hour
// mongosh numbers are doubles, so integer fields are wrapped in NumberInt
// (the validators require int/long).
// =====================================================================
// Target database: royalty_events, or `var dbName = '...'` passed with --eval (used by scripts/run_mongo_queries.sh).
const target = db.getSiblingDB(typeof dbName === 'string' ? dbName : 'royalty_events');
target.usage_events.deleteMany({});
target.usage_batches.deleteMany({});

let state = 20260901;
const rnd = () => (state = (state * 1664525 + 1013904223) % 4294967296) / 4294967296;
const pick = arr => arr[Math.floor(rnd() * arr.length)];

const PERIOD = NumberInt(1);
const ADMIN = NumberInt(1);
const tracks = [1, 2, 3, 4, 5, 6, 7];
const weights = [30, 18, 14, 10, 12, 9, 7];            // track popularity
const listeners = Array.from({ length: 400 }, (_, i) => 'lh_' + (100000 + i * 7919).toString(16));
const devices = ['mobile', 'desktop', 'smart_speaker', 'tv', 'car'];

function pickTrack() {
  let r = rnd() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < tracks.length; i++) { r -= weights[i]; if (r < 0) return tracks[i]; }
  return tracks[0];
}
function playedAt() {   // somewhere in September 2026, whole minutes
  return new Date(Date.UTC(2026, 8, 1 + Math.floor(rnd() * 30), Math.floor(rnd() * 24), Math.floor(rnd() * 60)));
}

// Different platforms send different extra fields: kept as-is in `raw`.
const rawFor = {
  spotify:     () => ({ playlist: pick(['Discover Weekly', 'Indie Chill', 'none', 'Release Radar']), premium: rnd() > 0.4, shuffle: rnd() > 0.5 }),
  youtube:     () => ({ watch_seconds: NumberInt(30 + Math.floor(rnd() * 240)), ad_supported: rnd() > 0.3, surface: pick(['music_app', 'web', 'shorts']) }),
  apple_music: () => ({ storefront: pick(['in', 'us', 'gb', 'ae']), lossless: rnd() > 0.5, library_add: rnd() > 0.8 })
};

function makeEvents(platform, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({
      period_id: PERIOD, track_id: NumberInt(pickTrack()), platform, plays: NumberInt(1),
      listener_hash: pick(listeners), played_at: playedAt(), device: pick(devices),
      status: 'valid', raw: rawFor[platform]()
    });
  }
  return out;
}

function insertBatch(platform, sourceFile, docs) {
  const batchId = target.usage_batches.insertOne({
    period_id: PERIOD, platform, source_file: sourceFile, uploaded_by: ADMIN,
    uploaded_at: new Date(), row_count: NumberInt(docs.length), status: 'uploaded', notes: []
  }).insertedId;
  target.usage_events.insertMany(docs.map(d => ({ batch_id: batchId, ...d })));
  return batchId;
}

// 1) Spotify main report, with the bot burst on track 1 (Sep 12, 14:00-14:59)
const spotify = makeEvents('spotify', 2100);
for (let i = 0; i < 150; i++) {
  spotify.push({
    period_id: PERIOD, track_id: NumberInt(1), platform: 'spotify', plays: NumberInt(1),
    listener_hash: 'lh_bot_7f3a', played_at: new Date(Date.UTC(2026, 8, 12, 14, Math.floor(i / 2.5), (i * 23) % 60)),
    device: 'desktop', status: 'valid', raw: { playlist: 'none', premium: false, shuffle: false }
  });
}
insertBatch('spotify', 'spotify_2026_09.csv', spotify);

// 2) Spotify "resent" report: 120 rows the platform already sent in report 1 (duplicates across batches)
const resent = [];
for (let i = 0; i < 120; i++) resent.push({ ...spotify[i * 17] });
insertBatch('spotify', 'spotify_2026_09_resend.csv', resent);

// 3) YouTube report with 30 rows repeated inside the same file
const youtube = makeEvents('youtube', 1400);
for (let i = 0; i < 30; i++) youtube.push({ ...youtube[i * 41] });
insertBatch('youtube', 'youtube_2026_09.json', youtube);

// 4) Apple Music report, clean
insertBatch('apple_music', 'apple_music_2026_09.csv', makeEvents('apple_music', 1200));

print('seeded ' + target.usage_events.countDocuments() + ' events in ' + target.usage_batches.countDocuments() + ' batches for period 1');
