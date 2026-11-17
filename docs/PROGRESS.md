# Progress

One row per work package (WP), matching CLAUDE.md section 5. Updated in the last commit of each WP's branch.
A fresh session continues at the first WP for its person that is not `merged`.
Owner A = Rohit, B = Shana. Status: `todo` -> `in progress` -> `PR open` -> `merged`.

| WP | Title | Owner | Branch | PR | Status | Date |
|---|---|---|---|---|---|---|
| Z | Bootstrap: tools, repo, collaborator invite | A | feat/a-z-bootstrap | #1 | merged | 2026-11-10 |
| 0 | Database foundation (PostgreSQL) | A | feat/a-0-database-foundation | #2 | merged | 2026-11-10 |
| 0b | MongoDB foundation + API contract | A | feat/a-0b-mongo-foundation | #3 | merged | 2026-11-10 |
| 1 | Next.js scaffold + auth | A | feat/a-1-nextjs-auth | #4 | merged | 2026-11-10 |
| 2 | Usage ingestion API (MongoDB R/U/D) | B | feat/b-2-usage-ingestion-api | #9 | merged | 2026-11-17 |
| 3 | Catalogue API | A | feat/a-3-catalogue-api | #5 | merged | 2026-11-10 |
| 4 | Contracts API | A | feat/a-4-contracts-api | #6 | merged | 2026-11-10 |
| 5 | Aggregate, close, ledger, payouts | B | feat/b-5-aggregate-close-payouts | #10 | merged | 2026-11-17 |
| 6 | Admin UI: catalogue and contracts | A | feat/a-6-admin-catalogue-ui | #7 | merged | 2026-11-10 |
| 7 | Admin UI: usage and payouts | B | feat/b-7-admin-usage-payouts-ui | #11 | merged | 2026-11-17 |
| 8 | Artist and auditor views | B | feat/b-8-artist-auditor-views | #12 | merged | 2026-11-17 |
| 9 | End-to-end scenario + API test sweep | B | feat/b-9-e2e-and-test-sweep | #13 | merged | 2026-11-17 |
| 10a | Report slice A (docs/REPORT.md) | A | feat/a-10a-report-slice | #8 | merged | 2026-11-10 |
| 10b | Report slice B (docs/REPORT.md) | B | feat/b-10b-report-slice | #14 | merged | 2026-11-17 |
| 11 | Final verification, demo script | A | feat/a-11-final-verification | #15 | merged | 2026-11-17 |

## Notes
* WP-Z: the repository already existed with a first "Add project foundation" commit (Nov 2), so it was kept rather than
  re-created. Rohit's clone keeps its working SSH remote (`git@github-me:dearthskill/royalty-ledger.git`, key `~/.ssh/id_me`),
  which pins pushes to Rohit's account regardless of the active `gh` account and avoids changing global git config.
  Shana (`shanasusanvarghese-coder`) was re-invited with write access on 2026-11-10 (the Nov 2 invite had expired);
  she must accept it before her first session.
* WP0: the Nov 2 SQL was rewritten to match the CLAUDE.md schema (platform keyed by code, period labels, share paths,
  `app_user.artist_id`), keeping its trigger logic. Docker host ports are configurable (`POSTGRES_PORT`, `MONGO_PORT`)
  because a local Homebrew PostgreSQL already uses 5432 on Rohit's laptop. **Open item:** `docs/er-diagram.png` still shows
  the old schema; re-export it from the Mermaid block in `docs/DESIGN.md` (e.g. `npx @mermaid-js/mermaid-cli`).
* WP2: API tests now also get a scratch MongoDB database per run (`tests/setup/global-db.ts`, needs `mongosh`).
  `mongo/pipelines/usage_ops.d.ts` types the CommonJS pipeline for the TypeScript routes.
* WP5: API test files share one scratch PostgreSQL database, so tests that count rows scope them to seeded
  periods (`payouts.test.ts` closes its own periods 2026-10..12; the ledger is append-only and cannot be cleaned up).
* WP7: added `GET /api/platforms` (read-only, all roles) for the upload form; noted in `docs/API_CONTRACT.md`.
  Import errors now list unknown track ids together with the other row errors.
* WP9: `tests/api/sweep.test.ts` scans `app/api` and fails when a route handler has no success/failure entry, so every
  new route must be added there. Suite: 137 tests (9 files), also passes with `--sequence.shuffle.files`.
* WP10b: real query output is generated, not hand-written: `scripts/run_queries.sh` -> `sql/demo/queries_output.txt`,
  `scripts/run_mongo_queries.sh` -> `mongo/demo/usage_queries_output.txt` (both on scratch databases).
* WP10a: written ahead of B's work packages (it covers only A's slice, all merged). Sections 9-15 of `docs/REPORT.md` are
  placeholders for WP10b. Re-run `scripts/data_dictionary.sh` into section 5 if the schema changes.
* WP11: fresh clone from GitHub, README followed step by step on separate ports (5434/27018). Found and fixed:
  the seed command needed `.env` loaded into the shell (it silently hit another MongoDB), `db_reset.sh` could seed
  before the init scripts finished, `psql`/`mongosh` were listed as optional though tests need them, layout list was
  out of date. Full UI money flow run on the clone (`docs/DEMO.md`). `docs/er-diagram.png` re-exported on 2026-11-17 (see ER refresh note).
* ER refresh (2026-11-17): `docs/er-diagram.png` re-exported from `docs/DESIGN.md` with `scripts/render_er.sh` (ELK layout).
  The old PNG showed the Nov 2 schema (platform_id, artist.stage_name/user_id, period_start/end, audit_log action/old_data).
  Mermaid fixes: contract -> contract_split is zero-or-more (a track's first draft starts with no splits; 100% is checked
  only at activation); added created_at columns and constraint notes.
