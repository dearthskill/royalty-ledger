# Viva topics: Shana (Member B)

Per work package: files touched and questions an examiner could ask, with where the answer lives.

## WP2: usage ingestion API (MongoDB read / update / delete)
Files: `lib/usage.ts`, `lib/csv.ts`, `mongo/pipelines/usage_ops.d.ts`, `app/api/periods/**`, `app/api/usage/batches/**`,
`tests/api/usage.test.ts`, `tests/setup/global-db.ts`, `tests/setup/env.ts`, `tests/helpers.ts`
* Which routes are the MongoDB Create, Read, Update and Delete, and which driver calls do they end in? ->
  `import` -> `ingest` (`insertOne` + `insertMany`); `duplicates` / `flagged` -> `aggregate` with `$group`;
  `void-*`, `dispute`, `resolve` -> `updateMany` / `updateOne` with `$set` + `$push`; `voided` -> `deleteMany` (`usage_ops.js`)
* How is a whole upload rejected when only one row is bad, and how are row numbers reported? ->
  `validateImport` in `lib/usage.ts` (errors collected per row, nothing written until all pass), test "rejects the whole batch"
* MongoDB has no triggers or foreign keys here. What stops usage changes in a closed period, or an unknown `track_id`? ->
  `requireOpenPeriod` and the `track` / `platform` lookups in `validateImport` (both read PostgreSQL through `withDb`)
* Why does dispute / resolve use the `updateOne` filter (`status: { $ne: 'aggregated' }`) instead of "read, check, then write"? ->
  `disputeBatch` / `resolveDispute` in `usage_ops.js`, `changeDispute` in `lib/usage.ts`
* Who enforces "no overlapping periods" and "ends_on after starts_on" when a period is created? ->
  `payout_period` constraints `period_no_overlap` (EXCLUDE gist) and `period_dates` in `01_schema.sql`; `app/api/periods/route.ts` only inserts

Live modification to try: change the default bot threshold (`DEFAULT_BOT_PLAYS_PER_HOUR` in `usage_ops.js`, 20) and
watch `GET /api/periods/1/usage/flagged` list more or fewer listeners; or add a rule in `validateImport` that rejects
`plays` above 100 per row and see the row number appear in the 400 response.

## WP5: aggregate, close, ledger, payouts
Files: `lib/payouts.ts`, `app/api/periods/[id]/aggregate|close|ledger/route.ts`, `app/api/payouts/route.ts`,
`app/api/payouts/[id]/pay/route.ts`, `tests/api/payouts.test.ts`
* What exactly crosses from MongoDB into PostgreSQL, and what happens if it names a track that does not exist? ->
  `aggregateUsage` in `usage_ops.js`, `checkUsage` in `lib/payouts.ts` (400 before anything is written), test "400 listing unknown"
* Why does aggregate lock the period row `FOR UPDATE`, and what happens if usage is aggregated twice? ->
  `aggregate` in `lib/payouts.ts` (same lock as `close_payout_period`; DELETE + INSERT in one transaction), test "replaces the summary"
* Where is the money computed, and why is none of it in TypeScript? -> `close_payout_period` in `02_logic.sql`
  (`plays * rate_per_play * effective_pct / 100`, `resolve_split`), `app/api/periods/[id]/close/route.ts` only `CALL`s it
* Two admins click Pay at the same moment. Why is the artist paid only once? -> `mark_payout_paid` (`SELECT ... FOR UPDATE`),
  test "two concurrent pays"
* `GET /api/payouts` has no `WHERE artist_id = ...` for artists. Why can Nova still not see Mira's payout? ->
  `payout_artist` policy in `03_roles.sql`, `withDb` sets `app.artist_id` (`lib/db.ts`), test "an artist only their own (RLS)"

Live modification to try: change a platform rate (`UPDATE platform SET rate_per_play = 0.005 WHERE code = 'spotify'`) in a
scratch period before closing it and compare the ledger amounts; or add `ORDER BY amount DESC` to `listPayouts` and
watch the payouts table reorder.
