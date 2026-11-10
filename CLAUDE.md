# CLAUDE.md — Royalty Ledger (DBMS Level 3 mini project, PES University, Aug–Dec 2026)

Transparent Royalty Split & Payout Ledger for independent music. Next.js (App Router, TypeScript) + PostgreSQL 16 + MongoDB 7.
Team: **Rohit Krishna R** (Member A, repo owner) and **Shana Susan Varghese** (Member B, collaborator).
**Nothing exists yet.** You build the whole project from an empty folder, work package by work package (section 5).
Every session: read this file, then `docs/PROGRESS.md` (once it exists) and resume at the first unfinished WP for this session's person.

---------------------------------------------------------------------------------------------------

## 1. Sessions, people and accounts

| Person | Clone folder | git identity (local config only) | GitHub user | Branch prefix |
|---|---|---|---|---|
| Rohit (A) | `~/work/me/royalty-ledger` | `Rohit Krishna R` / `rohitkrishna133@gmail.com` | `ME_GH` in `~/work/accounts.env` | `feat/a-` |
| Shana (B) | `~/work/mate/royalty-ledger` | `Shana Susan Varghese` / `shana.susan.varghese@gmail.com` | `MATE_GH` in `~/work/accounts.env` | `feat/b-` |

**One session = one person.** A session started in Rohit's clone acts only as Rohit: his identity, his `gh` account, his WPs.
A session started in Shana's clone acts only as Shana, and only with Shana present and directing.
* In a Rohit session: never `cd` into or modify Shana's clone, never `gh auth switch` to her account, never do a B work package.
  When the next unfinished WP is Shana's and no A work package can proceed in parallel, stop and print:
  `WAITING FOR SHANA: <WP id>. She should open Claude Code in ~/work/mate/royalty-ledger and say "continue".`
* In a Shana session: at the start, ask "Is this Shana? (yes/no)". Continue only on yes. Then do only B work packages.
* You may skip ahead to a later A work package while waiting for a B one, if its dependencies (section 5) are merged.

**Session start checklist (always first):**
`pwd` · `git config user.name` · `git config user.email` · `gh auth status` (active account). If any does not match the person
for this clone: for `gh`, run `gh auth switch --user <this person's GH user>` (only this person's), then re-check; otherwise stop and tell the user.

**Shared laptop:** both people use the same macOS machine and both `gh` accounts are logged in. The active `gh` account is global,
so: never run a Rohit session and a Shana session at the same time; in every session re-run `gh auth status` immediately before
`git push`, `gh pr create` and `gh pr merge`, and if the active account is not this clone's person, `gh auth switch` back first.
Each clone's remote URL includes its owner's username (`https://<GH user>@github.com/<ME_GH>/royalty-ledger.git`) so pushes
authenticate as the right person.

**Per work package (PR flow)**
1. `git checkout main && git pull --ff-only`, then `git checkout -b <prefix><wp>-<short-name>`.
2. Implement in several small, focused commits with clear imperative messages. Run the tests (section 7). All must pass.
3. Update the WP's row in `docs/PROGRESS.md` in the last commit (owner, branch, PR number, status, date).
4. `git push -u origin <branch>`.
5. PR body in a temp file: **Summary** and **How it was tested** (real command output, trimmed). Then
   `gh pr create --base main --head <branch> --title "<WP id>: <short title>" --body-file <file>`.
6. `gh pr merge <number> --merge --delete-branch` (merge commits, never squash).
7. `git checkout main && git pull --ff-only`. Print: WP id, PR number, what works now, what is next. Continue to the next WP.

**Git rules:** local `git config` only (never `--global`); never `--author`/`GIT_AUTHOR_*` overrides, `push --force`, `--no-verify`,
rewriting pushed history, or deleting remotes. `--amend` only on unpushed commits. Never commit `.env` or `accounts.env`.
No approval-required branch protection.

---------------------------------------------------------------------------------------------------

## 2. The problem and the design

Independent artists share track earnings through opaque spreadsheet splits. The system keeps exact, versioned split contracts and an
append-only payout ledger in PostgreSQL, and ingests/cleans high-volume platform usage events in MongoDB.

**Money flow:** upload usage batch (Mongo) -> clean (void duplicates/bot plays, dispute, purge) -> aggregate per track+platform ->
`usage_summary` (Postgres) -> `CALL close_payout_period(period)` -> `ledger_entry` rows + `payout` rows -> `mark_payout_paid(payout)`.

**Why two databases (technology justification):** money, contracts and ownership need ACID transactions, foreign keys, CHECK
constraints, triggers and row-level security -> PostgreSQL. Usage events are high-volume, semi-structured (each platform sends
different fields), write-once/clean-then-summarise, and naturally processed by aggregation pipelines -> MongoDB. The boundary
between them is a single, small, validated shape: `{ track_id, platform, plays }`.

### PostgreSQL schema (build in WP0; adjust names only if needed, keep the intent)
* `app_user(user_id PK, email UNIQUE, password_hash, role CHECK IN ('admin','artist','auditor'), artist_id FK NULL, created_at)`;
  CHECK: role='artist' iff artist_id is not null.
* `artist(artist_id PK, name, kind CHECK IN ('solo','group'), email UNIQUE NULL, created_at)`.
* `group_member(group_id FK artist, member_id FK artist, share_pct NUMERIC(5,2) CHECK >0 AND <=100, PK(group_id, member_id))`;
  CHECK group_id <> member_id; deferred constraint trigger: shares of a group total exactly 100 at COMMIT; trigger rejecting cycles.
  Groups may contain groups (that is why the split resolver is recursive).
* `platform(code PK, name, rate_per_play NUMERIC(10,6) CHECK > 0)`.
* `track(track_id PK, title, isrc UNIQUE, primary_artist_id FK artist, released_on)`; full-text `search_vector` (generated tsvector) + GIN index.
* `contract(contract_id PK, track_id FK, version INT, status CHECK IN ('draft','active','superseded'), activated_at, UNIQUE(track_id, version))`;
  partial unique index: one `active` contract per track.
* `contract_split(contract_id FK, artist_id FK, share_pct NUMERIC(5,2) CHECK >0 AND <=100, PK(contract_id, artist_id))`;
  trigger: splits editable only while the contract is `draft`.
* `payout_period(period_id PK, label UNIQUE, starts_on, ends_on CHECK ends_on > starts_on, status CHECK IN ('open','closed'), closed_at)`.
* `usage_summary(period_id FK, track_id FK, platform_code FK, plays BIGINT CHECK >= 0, PK(period_id, track_id, platform_code))`;
  trigger: no changes once the period is closed.
* `ledger_entry(entry_id PK, period_id FK, track_id FK, artist_id FK, platform_code FK, amount NUMERIC(14,4) CHECK >= 0, share_path TEXT, created_at)`;
  trigger: UPDATE and DELETE always raise (append-only).
* `payout(payout_id PK, period_id FK, artist_id FK, amount NUMERIC(14,2), status CHECK IN ('pending','paid'), paid_at, UNIQUE(period_id, artist_id))`.
* `audit_log(audit_id PK, table_name, op, row_pk, before JSONB, after JSONB, actor TEXT, at timestamptz)`; generic audit trigger on
  contract, contract_split, group_member, payout, payout_period.

**Logic (02_logic.sql):**
* `resolve_split(track_id)` — recursive CTE: active contract splits, expanded through nested groups, multiplying shares; returns
  `(artist_id, effective_pct, path)`; leaf artists only; total = 100.
* `create_contract_draft(track_id)` (copies current active splits into a new draft version), `activate_contract(contract_id)` (exactly
  100% or raise; supersede the old active one in the same transaction).
* `PROCEDURE close_payout_period(period_id)` — locks the period, refuses if closed or no usage, writes ledger entries
  (plays × rate × effective share), sums into `payout`, marks period closed. One transaction.
* `mark_payout_paid(payout_id)` — `SELECT ... FOR UPDATE`, raise if already paid.
* `search_catalog(q)` — full-text over tracks and artists, ranked.
* All business errors are `RAISE EXCEPTION` with clear human-readable messages (they are shown in the UI).

**Views:** `v_active_split` (track -> resolved split), `v_contract_overview`, `v_artist_statement` (artist, period, track, plays, amount),
`v_period_totals`.

**Roles + RLS (03_roles.sql):** DB roles `rl_admin`, `rl_artist`, `rl_auditor` (NOLOGIN), granted to the app login role.
`rl_auditor`: SELECT only. `rl_artist`: SELECT on own rows only via RLS on `payout`, `ledger_entry` using
`current_setting('app.artist_id')`. `rl_admin`: everything except UPDATE/DELETE on `ledger_entry`/`audit_log`. App roles cannot read `app_user`.

**Seed (04_seed.sql):** 3 platforms, ~6 artists incl. one group containing a nested group, ~8 tracks, contracts with history
(at least one superseded version), 2 periods (one open). Users (password `Password@123`, bcrypt via pgcrypto `$2a$`):
`admin@royalty.test`, `auditor@royalty.test`, `nova@`, `kai@`, `mira@`, `lina@royalty.test` (artists).

### MongoDB (database `royalty_events`)
* `usage_batches`: `{ _id, period_id, platform, source_file, uploaded_by, uploaded_at, row_count, status: 'uploaded'|'cleaned'|'disputed'|'aggregated', notes[] }`.
* `usage_events`: `{ batch_id, period_id, track_id, platform, plays, listener_hash, played_at, device, status: 'valid'|'void', void_reason, raw }`
  (`raw` keeps platform-specific extra fields — the reason for a document store).
* `$jsonSchema` validators on both; indexes: `{period_id, status}`, `{batch_id}`, `{track_id, platform, listener_hash, played_at}` (duplicate detection).
* `mongo/pipelines/usage_ops.js` (importable from Node): `ingest`, `findDuplicates`, `voidDuplicates`, `voidFlagged` (bot heuristics:
  > N plays per listener per hour), `disputeBatch`, `resolveDispute`, `purgeVoided`, `aggregateUsage(period)` -> `[{track_id, platform, plays}]`.

### Rules (never work around them)
* Never weaken a trigger, constraint or RLS policy to make the app pass. Fix the app. Show the database's error text in the UI.
* Business rules that guard money live in SQL; the app calls them, it does not reimplement them. Never write code that edits `ledger_entry`.
* The Mongo -> Postgres shape `{ track_id, platform, plays }` is fixed.

### App architecture
Next.js App Router + TypeScript · `pg` (no ORM) · `mongodb` driver · `bcryptjs` · `jose` (HS256 JWT, httpOnly sameSite=lax cookie,
secret `AUTH_SECRET`) · `zod` · Vitest · Tailwind. From Next.js 16 the request guard file is `proxy.ts` (formerly `middleware.ts`); use whichever the installed version expects.
* `lib/db.ts`: one `pg.Pool` from `DATABASE_URL`; `withDb(session, fn)`: `BEGIN` -> `SET LOCAL ROLE rl_<role>` (whitelist, never input)
  -> `set_config('app.user_id', $1, true)` (+ `app.artist_id` for artists) -> `fn(client)` -> `COMMIT`/`ROLLBACK` -> release.
  Parameterised queries only. Login is the one exception (reads `app_user` as the owner role).
* Error mapping: `P0001` -> 409 (message as `error`), `23505` -> 409, `23514` -> 400, `23503` -> 409, `42501` -> 403;
  zod failure -> 400; no session -> 401; wrong role -> 403.
* All config from `.env` (`DATABASE_URL`, `MONGODB_URI`, `AUTH_SECRET`); `.env.example` committed, `.env` git-ignored.

---------------------------------------------------------------------------------------------------

## 3. Working style
* Work autonomously through this session's person's WPs. No permission needed for routine steps.
* **Stop and ask only when:** the session-start check fails; a GitHub login needs a browser; a test fails after three honest attempts;
  a change would weaken a database rule; something destroys data outside the dev databases; the next WP belongs to the other person.
* Install missing CLI tools with `brew install` (git, gh, node, postgresql@16 client, mongosh). Ask before installing Docker Desktop.
* Keep code simple and readable with short comments on database-facing parts.
* Screenshots of new screens: `docs/screenshots/<wp>-<screen>.png` via Playwright headless Chromium.

## 4. Viva readiness (rubric: originality, contribution, modification, viva = 4 marks)
* After each WP, add the WP to `docs/VIVA_TOPICS_<rohit|shana>.md`: the files touched and 3–5 questions an examiner could ask, with
  pointers to where the answer is in the code (not written-out answers).
* In a Shana session, explain each trigger/query/route briefly before writing it, and suggest one small live modification she can try.

---------------------------------------------------------------------------------------------------

## 5. Work packages (A = Rohit, B = Shana). Dependencies in parentheses.

**WP-Z (A): bootstrap**
* Check/install tools. Create `~/work/accounts.env` from the user's answers (ask once for the two GitHub usernames if unknown).
* `mkdir -p ~/work/me/royalty-ledger ~/work/mate`; `git init -b main` in Rohit's clone; set local name/email; `.gitignore`
  (node_modules, .next, .env, coverage, *.log); `README.md` stub; commit `Initialise repository`.
* `gh auth switch --user <ME_GH>`; `gh config set git_protocol https`; `gh auth setup-git`;
  `gh repo create <ME_GH>/royalty-ledger --private --source . --remote origin --push`; then
  `git remote set-url origin https://<ME_GH>@github.com/<ME_GH>/royalty-ledger.git` and confirm with `git remote -v` and a `git fetch`.
* Only Rohit's account may be logged in at this point; that is expected. Shana logs in with `gh auth login` (HTTPS, browser) at the
  start of her first session; her clone uses `https://<MATE_GH>@github.com/<ME_GH>/royalty-ledger.git`.
* `gh api -X PUT repos/<ME_GH>/royalty-ledger/collaborators/<MATE_GH> -f permission=push`.
* Create `docs/PROGRESS.md` with every WP listed. Tell the user: Shana must accept the invite and run her first session (see the prompt
  she uses) — that session clones into `~/work/mate/royalty-ledger` and sets her own identity there.

**WP0 (A): database foundation** (WP-Z)
* `docker-compose.yml` (postgres:16, mongo:7, named volumes, healthchecks), `.env.example`.
* `sql/init/01_schema.sql`, `02_logic.sql`, `03_roles.sql`, `04_seed.sql` per section 2. `sql/demo/ddl_demo.sql` (CREATE, ALTER add
  column + constraint, CREATE INDEX, DROP on a scratch table). `scripts/db_reset.sh`, `scripts/test_db.sh`.
* `sql/tests/test_logic.sql`: at least 15 test groups (each rule above: 99% group, cycle, draft-only edits, 90% activation, one active
  contract, append-only ledger, closed-period immutability, double close, double pay, RLS isolation, resolve_split totals, …).
* `docs/DESIGN.md`: ER diagram as Mermaid + exported `docs/er-diagram.png`, relational schema, justification. [DDL 4, schema 3, ER 2, advanced SQL 6]

**WP0b (A): MongoDB foundation** (WP0)
* `mongo/init/01_init.js` (collections, validators, indexes), `mongo/pipelines/usage_ops.js`, `mongo/seed/seed_events.js`
  (period 1: ~5k events incl. duplicates and a bot pattern), `mongo/tests/usage_ops.test.js` (Vitest against local Mongo).
* `docs/API_CONTRACT.md`: every route, method, role, request/response, errors. [NoSQL creation 4, justification 1]

**WP1 (A): Next.js scaffold + auth** (WP0b) — `lib/db.ts`, `lib/mongo.ts`, `lib/session.ts` (`requireRole`), `/api/auth/login|logout|me`,
request guard, `/login`, role-aware layout/nav. Tests: login ok/fail, 401, 403 per role. [Next.js, integration, auth]

**WP2 (B): usage ingestion API — Mongo R/U/D** (WP1) — periods list/create/get, `usage/import` (CSV/JSON, zod, whole batch rejected
with row numbers on any invalid row), batches list, duplicates, void-duplicates, void-flagged, purge (`DELETE`), dispute, resolve. [NoSQL RUD 7]

**WP3 (A): catalogue API** (WP1) — artists, group members (`PUT` replaces the set in one transaction), tracks, `GET /api/search`.

**WP4 (A): contracts API** (WP3) — draft, `PUT splits`, activate, delete draft, effective split, history.

**WP5 (B): aggregate, close, ledger, payouts** (WP2, WP4) — aggregate (refuse if closed/disputed; validate ids; replace
`usage_summary` in one transaction), close, ledger, payouts, pay (409 on second pay; concurrent-pay test).

**WP6 (A): admin UI — catalogue and contracts** (WP4) — `/admin/artists` (live 100% indicator, DB errors verbatim), `/admin/tracks`,
`/admin/tracks/[id]` (versions, split editor, activate, effective split with path), search box.

**WP7 (B): admin UI — usage and payouts** (WP5) — `/admin/periods`, `/admin/periods/[id]` (upload, batches, duplicates preview,
void/purge/dispute, aggregate preview, close, ledger, payouts with Pay).

**WP8 (B): artist and auditor views** (WP5) — `/me`, `/audit` (filters, before/after JSON). Test artist A cannot see artist B.

**WP9 (B): end-to-end scenario + API test sweep** (WP6–WP8) — every route has one success and one failure test.

**WP10a (A) / WP10b (B): report slices in `docs/REPORT.md`** — A: objectives, requirements, ER, schema, data dictionary (generated from
`information_schema`), catalogue/contracts/auth/RLS, architecture. B: Mongo, usage, payouts, audit, important queries
(`sql/demo/queries.sql` with real output: joins, GROUP BY/HAVING, nested, correlated, recursive), testing results, screenshots, conclusion.

**WP11 (A): final verification** — fresh clone into a temp folder, follow README only, fix gaps; `docs/DEMO.md` (10-minute demo order
matching the evaluation list); run the rubric checklist and fix gaps.

---------------------------------------------------------------------------------------------------

## 6. Rubric checklist (50 marks)
| Row | Marks | Shown in |
|---|---|---|
| ER diagram | 2 | `docs/er-diagram.png`, DESIGN |
| Relational schema, keys, constraints | 3 | `01_schema.sql`, REPORT |
| SQL DDL with constraints | 4 | `01_schema.sql`, `sql/demo/ddl_demo.sql` |
| NoSQL creation | 4 | `mongo/init/01_init.js` |
| Technology justification | 1 | DESIGN |
| DML | 4 | app + `sql/demo/` |
| Nested/correlated/recursive/join | 4 | `sql/demo/queries.sql` |
| Procedure/function, trigger, CTE | 6 | `02_logic.sql` |
| NoSQL read/update/delete | 7 | WP2 + WP7 UI |
| Next.js interface | 3 | WP6–WP8 |
| Backend/API + DB integration | 2 | `withDb`, env config |
| Auth, 2+ roles, DB-level RBAC | 4 | WP1, `03_roles.sql`, RLS |
| Documentation, Git/GitHub | 2 | REPORT, README, history |
| Originality, contribution, modification, viva | 4 | each person, live |

## 7. Commands
`docker compose up -d` · `scripts/db_reset.sh` · `scripts/test_db.sh` · `mongosh "$MONGODB_URI" mongo/seed/seed_events.js` ·
`npm run dev` · `npm test`
