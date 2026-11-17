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
