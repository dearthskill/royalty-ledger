# Transparent Royalty Split & Payout Ledger

A Next.js application for independent music royalties. PostgreSQL holds contracts, splits, the
append-only payout ledger and the audit trail; MongoDB holds high-volume, platform-specific usage
events that are cleaned and aggregated before each payout. DBMS Level 3 mini project, PES University.

* Design, ER diagram, database justification: [`docs/DESIGN.md`](docs/DESIGN.md)
* API and the PostgreSQL/MongoDB interface: [`docs/API_CONTRACT.md`](docs/API_CONTRACT.md)
* Who builds what, Git workflow: [`docs/WORK_SPLIT.md`](docs/WORK_SPLIT.md)

## Prerequisites
Node.js 20+, Docker (with Compose), Git. Optional: `mongosh` and `psql` for seeding and running tests from the shell.

## Setup
```bash
git clone <repo-url> && cd royalty-ledger
cp .env.example .env            # then edit the passwords and AUTH_SECRET
docker compose up -d            # PostgreSQL 16 + MongoDB 7; sql/init and mongo/init run on first start
mongosh "$MONGODB_URI" mongo/seed/seed_events.js    # demo usage events (optional)
```
PostgreSQL is seeded with demo users, artists (including nested groups), tracks, contracts and an open
September 2026 period. Demo password for every seeded login: `Password@123`
(`admin@royalty.test`, `auditor@royalty.test`, `nova@royalty.test`, ...).

Rebuild everything from scratch: `scripts/db_reset.sh`.

## Run the application
The Next.js app is added by the team in `app/` (see `docs/WORK_SPLIT.md`):
```bash
npm install
npm run dev                     # http://localhost:3000
```

## Git setup (once per clone)
```bash
git config user.name "YOUR NAME"; git config user.email "YOUR_GITHUB_EMAIL"
bash scripts/setup_git_guards.sh
```

## Tests
```bash
PGHOST=localhost PGPORT=5432 PGUSER=royalty PGPASSWORD=<from .env> scripts/test_db.sh
```
Builds a scratch database from `sql/init/` and runs 15 groups of checks covering the split triggers,
period close, immutability, payouts, audit trail, search and role-based access.

## Repository layout
```
sql/init/        schema, logic (triggers, procedure, views), roles, seed
sql/tests/       database test suite
sql/demo/        important queries for the viva
mongo/init/      collections, validators, indexes
mongo/pipelines/ aggregation + void/dispute/purge operations
mongo/seed/      demo usage events
docs/            design, API contract, work split
scripts/         db_reset.sh, test_db.sh
```
