# Transparent Royalty Split & Payout Ledger

A Next.js application for independent music royalties. PostgreSQL holds contracts, splits, the
append-only payout ledger and the audit trail; MongoDB holds high-volume, platform-specific usage
events that are cleaned and aggregated before each payout. DBMS Level 3 mini project, PES University.

* Project report: [`docs/REPORT.md`](docs/REPORT.md)
* Design, ER diagram, database justification: [`docs/DESIGN.md`](docs/DESIGN.md)
* API and the PostgreSQL/MongoDB interface: [`docs/API_CONTRACT.md`](docs/API_CONTRACT.md)
* Who builds what, Git workflow: [`docs/WORK_SPLIT.md`](docs/WORK_SPLIT.md)

## Prerequisites
Node.js 20+, Docker (with Compose), Git. Optional: `mongosh` and `psql` for seeding and running tests from the shell.

## Setup
```bash
git clone <repo-url> && cd royalty-ledger
cp .env.example .env            # then edit the passwords and AUTH_SECRET
                                # (if port 5432 is taken locally, set POSTGRES_PORT=5433 and use it in DATABASE_URL)
docker compose up -d            # PostgreSQL 16 + MongoDB 7; sql/init and mongo/init run on first start
mongosh "$MONGODB_URI" mongo/seed/seed_events.js    # 5000 demo usage events for period 2026-09
```
PostgreSQL is seeded with demo users, artists (including a group nested inside a group), 8 tracks,
contracts with version history, a closed August 2026 period (ledger + payouts) and an open September 2026 period. Demo password for every seeded login: `Password@123`
(`admin@royalty.test`, `auditor@royalty.test`, `nova@royalty.test`, ...).

Rebuild everything from scratch: `scripts/db_reset.sh`.

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
`scripts/test_db.sh` builds a scratch database from `sql/init/`, runs 20 groups of checks (`sql/tests/test_logic.sql`) covering
the split triggers, contracts, period close, immutability, payouts, audit trail, search and role-based
access, then drops the scratch database. DDL demo: `psql "$DATABASE_URL" -f sql/demo/ddl_demo.sql`.

## Repository layout
```
sql/init/        schema, logic (triggers, procedure, views), roles, seed
sql/tests/       database test suite
sql/demo/        DDL demo and important queries for the viva
mongo/init/      collections, validators, indexes
mongo/pipelines/ aggregation + void/dispute/purge operations
mongo/seed/      demo usage events
mongo/tests/     Vitest tests for the pipelines
app/             Next.js pages and API route handlers
lib/             db (withDb), mongo, session, http helpers
tests/           Vitest API tests and setup
docs/            design, API contract, work split, screenshots
scripts/         db_reset.sh, test_db.sh
```
