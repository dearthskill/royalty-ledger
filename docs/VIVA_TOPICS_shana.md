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

## WP7: admin UI for usage and payouts
Files: `app/admin/periods/PeriodsAdmin.tsx`, `app/admin/periods/[id]/PeriodDetail.tsx`, `components/StatusBadge.tsx`,
`components/api.ts` (FormData uploads), `app/api/platforms/route.ts`; screenshots `docs/screenshots/7-*.png`
* Where does the text "conflicting key value violates exclusion constraint period_no_overlap" come from, and how does it reach
  the screen unchanged? -> `payout_period` EXCLUDE constraint, `errorResponse` in `lib/http.ts` (23P01 -> 409), `ErrorBox`
* How does the upload screen show every bad row? -> `upload` in `PeriodDetail.tsx` reads `details`, built by `validateImport`
* Why are "Preview" and "Write" separate buttons for duplicates, bots and aggregate? -> GET vs POST routes; `preview: true`
  in `/aggregate` never writes (`lib/payouts.ts`)
* Why do the write buttons disappear once a period is closed, and what still stops a forged request? -> `open` flag in
  `PeriodDetail.tsx`; `requireOpenPeriod` (MongoDB writes) and `trg_usage_period_open` / `close_payout_period` (PostgreSQL)
* What happens in the browser if two admins press Pay together? -> second request gets 409 `Payout N is already paid`
  (`mark_payout_paid` row lock), shown in the error box

Live modification to try: show the batch's `uploaded_at` in the batches table (field is already in the API response), or
change the duplicates preview to show 20 groups instead of 10 (`slice(0, 10)` in `PeriodDetail.tsx`).

## WP8: artist and auditor views
Files: `lib/statements.ts`, `app/api/me/statement|payouts/route.ts`, `app/api/audit/route.ts`, `app/me/MyEarnings.tsx`,
`app/audit/AuditView.tsx`, `tests/api/me-audit.test.ts`; screenshots `docs/screenshots/8-*.png`
* `statement()` has no `WHERE artist_id = ...`. Prove Nova cannot read Mira's lines, and name the three pieces that make it work. ->
  `v_artist_statement` (`security_invoker = true`, `02_logic.sql`), policy `ledger_artist` (`03_roles.sql`), `app.artist_id` set in
  `withDb` (`lib/db.ts`); test "artist A cannot see artist B"
* What if the view were created without `security_invoker`? -> it would run with the owner's rights and skip RLS: every artist
  would see every line (try it on a scratch database, never in `sql/init`)
* Where do audit rows come from, and who is the `actor`? -> `fn_audit` trigger (`02_logic.sql`): `before`/`after` via `to_jsonb(OLD/NEW)`,
  actor = the `app_user` email for `app.user_id`, else the database role (seed rows show `royalty`)
* The audit filter takes a table name from the URL. Why is that not SQL injection? -> `AUDITED` whitelist (`z.enum`) and `$1`
  parameters in `listAudit` (`lib/statements.ts`), test "400 for bad filters"
* Can the auditor change anything from `/audit`? -> no buttons, and `rl_auditor` has SELECT only (`03_roles.sql`)

Live modification to try: add a "Plays" total row to the statement on `/me`, or add an `op` (INSERT/UPDATE/DELETE) filter to
`AuditQuery` and the filter form.

## WP9: end-to-end scenario and API test sweep
Files: `tests/api/e2e.test.ts`, `tests/api/sweep.test.ts`
* Walk through the money flow in the end-to-end test. Where do the numbers 3.60 / 2.40 come from? -> `e2e.test.ts` step 5
  (1000 x 0.004 + 1000 x 0.002 = 6.00; contract Kai 60 / Lina 40; `close_payout_period`)
* How do you know every route is tested, including ones added later? -> `routeHandlers()` in `sweep.test.ts` scans `app/api`
  and compares with the case table
* The tests never touch the dev databases. How? -> `tests/setup/global-db.ts` (scratch PostgreSQL from `sql/init`, scratch
  MongoDB from `mongo/init`, both dropped afterwards)
* Why do the tests create their own periods (2026-10, 2029-01, 2030-01) instead of closing the seeded 2026-09? ->
  the ledger is append-only (`fn_ledger_append_only`): a closed period cannot be reopened, and other files rely on 2026-09 being open
* Which test proves that the UI-independent API refuses a forged request to a closed period? -> `e2e.test.ts` step 8

Live modification to try: change Lina's share in the end-to-end contract to 30 (and Kai's to 70) and update the expected
amounts; or remove a route's entry from the sweep table and watch the guard test fail with the missing route.

## WP10b: report slice B
Files: `docs/REPORT.md` sections 9-15, `sql/demo/queries.sql` (Q11 DML, Q12 refusals), `sql/demo/queries_output.txt`,
`scripts/run_queries.sh`, `mongo/demo/usage_queries.js`, `mongo/demo/usage_queries_output.txt`, `scripts/run_mongo_queries.sh`,
`mongo/seed/seed_events.js` (optional `dbName`)
* Explain Q3 line by line: anchor member, recursive member, where it stops, why only solo artists are kept. -> `queries.sql` Q3
* What makes Q4 *correlated*, and how would you rewrite it with a window function? -> `x.artist_id` inside the subquery; compare Q6
* Q7 returns no rows. Why is that the result you want? -> reconciliation of ledger vs plays × rate (REPORT section 12)
* Which MongoDB operations are Read, Update and Delete in the demo, and what did each return? -> `usage_queries_output.txt` R1-R6, U1-U3, D1
* Where is the boundary between the two databases, and where is it validated in both directions? -> REPORT sections 9.3 and 10.1

Live modification to try: change Q2's `HAVING SUM(le.amount) > 100` to `> 150` and re-run `scripts/run_queries.sh` (Kai and Nova
remain); or add an R7 to `usage_queries.js` that counts events per `device` with `$group`.
