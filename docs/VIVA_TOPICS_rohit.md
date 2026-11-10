# Viva topics: Rohit (Member A)

Per work package: files touched and questions an examiner could ask, with where the answer lives.

## WP-Z: bootstrap
Files: `CLAUDE.md`, `docs/PROGRESS.md`, `.gitignore`, `.githooks/`, `scripts/setup_git_guards.sh`
* Why is `.env` git-ignored while `.env.example` is committed? -> `.gitignore`, `.env.example`
* How does each teammate's work show up under their own GitHub account? -> `CLAUDE.md` section 1, `git log --format='%an %ae'`
* Why merge commits instead of squash merges for PRs? -> `CLAUDE.md` section 1 (PR flow step 6)

## WP0: PostgreSQL foundation
Files: `sql/init/01_schema.sql`, `02_logic.sql`, `03_roles.sql`, `04_seed.sql`, `sql/tests/test_logic.sql`, `sql/demo/ddl_demo.sql`, `docs/DESIGN.md`
* How does `resolve_contract_split` handle a group inside a group, and where does it stop? -> `02_logic.sql` (recursive CTE, `depth < 16`, `kind = 'solo'` filter)
* Why is the "group shares = 100" trigger DEFERRABLE INITIALLY DEFERRED? What breaks if it were immediate? -> `trg_group_member_sum`, test T2
* What stops two active contracts for one track, even under concurrent requests? -> `uq_contract_one_active` partial unique index, test T6
* Why does `v_artist_statement` use `security_invoker = true`? -> `02_logic.sql` views, `03_roles.sql` policies, test T16
* How is the audit actor known when the app connects with a single login? -> `fn_audit` (SECURITY DEFINER, `app.user_id`), test T18

## WP0b: MongoDB foundation and API contract
Files: `mongo/init/01_init.js`, `mongo/pipelines/usage_ops.js`, `mongo/seed/seed_events.js`, `mongo/tests/usage_ops.test.js`, `docs/API_CONTRACT.md`
* Why are usage events in MongoDB and not a PostgreSQL table? What is in `raw`? -> `docs/DESIGN.md` section 3, `01_init.js` header
* How does `findDuplicates` decide two events are the same play, and which one is kept? -> `usage_ops.js` (`$group` on 4 keys, `$sort: {_id: 1}`, `keep`)
* Which index serves duplicate detection, and which one serves `aggregateUsage`? -> `01_init.js` indexes
* Without multi-document transactions, how does `ingest` avoid a half-stored batch? -> `ingest` compensating delete, test "removes the batch again"
* What exact shape crosses from MongoDB to PostgreSQL, and where is it validated? -> `aggregateUsage`, `docs/API_CONTRACT.md` "Interface"

## WP1: Next.js scaffold and auth
Files: `lib/db.ts`, `lib/session.ts`, `lib/http.ts`, `lib/mongo.ts`, `proxy.ts`, `app/api/auth/*`, `app/login/*`, `components/Nav.tsx`, `tests/api/auth.test.ts`
* What exactly happens inside `withDb` for an artist, and why is `SET LOCAL ROLE` not built from user input? -> `lib/db.ts` (`DB_ROLE` whitelist)
* If someone bypasses the Next.js role check, what still stops an artist reading another artist's payouts? -> `03_roles.sql` RLS, test "runs as the database role"
* Why httpOnly + SameSite=Lax for the session cookie, and what is inside the JWT? -> `lib/session.ts`, login route
* Why does a wrong password and an unknown e-mail give the same message and take the same time? -> `DUMMY_HASH` in `app/api/auth/login/route.ts`
* How is a PostgreSQL trigger error turned into an HTTP status? -> `PG_STATUS` in `lib/http.ts`
