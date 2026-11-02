# Work split (two members, feature slices)

Requirement 2: each member must contribute to BOTH database and application development.
So the split is by feature slice, and each member builds their slice end to end
(SQL + MongoDB where relevant + API routes + UI). Commits must be under your own GitHub account.

## Member A: catalogue, contracts and access
* Database: group_member rules, `resolve_split` (recursive CTE), contract triggers, `create_contract_draft` / `activate_contract`, `v_active_split`, `v_contract_overview`, `search_catalog`, roles and row-level security.
* App: login/logout, session handling, role guard, artists / groups / tracks / contracts screens, effective-split view, catalogue search.
* Tests: T1-T5, T13-T15 in `sql/tests/test_logic.sql` plus API tests for these routes.

## Member B: usage, payouts and audit
* Database: `usage_summary`, `close_payout_period`, ledger/period/payout guard triggers, `mark_payout_paid`, audit trigger, `v_artist_statement`, `v_period_summary`.
* MongoDB: collections, validators, indexes, aggregation pipeline, void / dispute / purge flows, seed data.
* App: usage import, batch cleaning screen, aggregate and close-period flow, payouts, artist statements, auditor ledger/audit view.
* Tests: T6-T12 in `sql/tests/test_logic.sql` plus Mongo/API tests.

The SQL and Mongo foundation files in this repo were drafted together in the first commit;
from here each member owns the files listed above and edits them on their own branch.

## Shared (review each other's work)
* `docs/` (documentation, screenshots, testing results), README, CLAUDE.md.
* The interface in `docs/API_CONTRACT.md` (changes need both approvals).

## Git workflow
The full procedure (branches, commits under each person's own identity, PRs, merges, the two GitHub accounts) is in
`CLAUDE.md` section 1. In short: `main` changes only through merged PRs; each work package is done on its own branch
by its owner under the owner's name/email and GitHub account; progress is tracked in `docs/PROGRESS.md`; never commit `.env`.

## Suggested order
1. Both: clone, `cp .env.example .env`, `docker compose up -d`, `scripts/test_db.sh` passes.
2. A: Next.js app scaffold + auth + role guard (B waits for this only for UI; B can start with API handlers and Mongo).
3. In parallel: A builds contracts/groups; B builds usage import + aggregation.
4. B: period close and payouts (needs A's contracts to exist, but the seed data covers this).
5. Both: dashboards, validation messages, tests, documentation, screenshots.
