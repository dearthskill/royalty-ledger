# Transparent Royalty Split & Payout Ledger

A Next.js application for independent music royalties. PostgreSQL holds contracts, splits, the
append-only payout ledger and the audit trail; MongoDB holds high-volume, platform-specific usage
events that are cleaned and aggregated before each payout. DBMS Level 3 mini project, PES University.

* Project report: [`docs/REPORT.md`](docs/REPORT.md)
* Design, ER diagram, database justification: [`docs/DESIGN.md`](docs/DESIGN.md)
* API and the PostgreSQL/MongoDB interface: [`docs/API_CONTRACT.md`](docs/API_CONTRACT.md)
* Who builds what, Git workflow: [`docs/WORK_SPLIT.md`](docs/WORK_SPLIT.md)
* 10-minute demo and rubric checklist: [`docs/DEMO.md`](docs/DEMO.md)

## Prerequisites
Node.js 20+, Docker (with Compose), Git, and the `psql` and `mongosh` clients (seeding, `scripts/*.sh` and the
Vitest setup use them; macOS: `brew install libpq mongosh`).

## Setup
```bash
git clone <repo-url> && cd royalty-ledger
cp .env.example .env            # then edit the passwords and AUTH_SECRET
                                # (if port 5432 is taken locally, set POSTGRES_PORT=5433 and use it in DATABASE_URL)
set -a; source .env; set +a     # load DATABASE_URL / MONGODB_URI into this shell (needed by the commands below)
scripts/db_reset.sh             # starts PostgreSQL 16 + MongoDB 7 (docker compose), runs sql/init and mongo/init,
                                # loads 5000 demo usage events for period 2026-09
```
`scripts/db_reset.sh` deletes the local database volumes first, so run it again whenever you want a clean demo state.
PostgreSQL is seeded with demo users, artists (including a group nested inside a group), 8 tracks,
contracts with version history, a closed August 2026 period (ledger + payouts) and an open September 2026 period. Demo password for every seeded login: `Password@123`
(`admin@royalty.test`, `auditor@royalty.test`, `nova@royalty.test`, ...).

## Run the application
```bash
npm install
npm run dev                     # http://localhost:3000  (or: npm run build && npm start)
```
Log in as `admin@royalty.test`, `auditor@royalty.test` or an artist (`nova@`, `kai@`, `mira@`, `lina@royalty.test`),
password `Password@123`. Screenshots for the docs: `node scripts/screenshot.mjs <name> <path> [email]`
(needs `npx playwright install chromium` once).

## Git setup (once per clone)
```bash
git config user.name "YOUR NAME"; git config user.email "YOUR_GITHUB_EMAIL"
bash scripts/setup_git_guards.sh
```

## Tests
```bash
scripts/test_db.sh              # uses DATABASE_URL from .env
npm test                        # Vitest: API + MongoDB tests on scratch databases (dropped afterwards)
```
Both use scratch databases, never your dev data. `scripts/test_db.sh` builds a scratch database from `sql/init/`, runs 20 groups of checks (`sql/tests/test_logic.sql`) covering
the split triggers, contracts, period close, immutability, payouts, audit trail, search and role-based
access, then drops the scratch database. DDL demo: `psql "$DATABASE_URL" -f sql/demo/ddl_demo.sql`.

## Repository layout
```
sql/init/        schema, logic (triggers, procedure, views), roles, seed
sql/tests/       database test suite
sql/demo/        DDL demo, important queries and their real output
mongo/init/      collections, validators, indexes
mongo/pipelines/ aggregation + void/dispute/purge operations
mongo/seed/      demo usage events
mongo/tests/     Vitest tests for the pipelines
mongo/demo/      MongoDB read/update/delete demo and its real output
app/             Next.js pages and API route handlers
lib/             db (withDb), mongo, session, http helpers
tests/           Vitest API tests and setup
docs/            report, design, API contract, demo, work split, viva notes, screenshots
scripts/         db_reset.sh, test_db.sh, run_queries.sh, run_mongo_queries.sh, data_dictionary.sh, screenshot.mjs
```
