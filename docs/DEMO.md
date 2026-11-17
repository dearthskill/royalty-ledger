# 10-minute demo

Order follows the evaluation list (CLAUDE.md section 6). Who presents: **R** Rohit, **S** Shana.
Every step was run end to end on a fresh clone on 2026-11-17 (outputs below are from that run).

## Before the viva (5 minutes, not part of the 10)
```bash
cd royalty-ledger
set -a; source .env; set +a
scripts/db_reset.sh                 # fresh PostgreSQL + MongoDB with demo data
npm run build && npm start          # http://localhost:3000
```
Open three browser windows (or one normal + two private): admin, `nova@royalty.test`, `auditor@royalty.test`
(password `Password@123`). Keep a terminal with `psql "$DATABASE_URL"` open.

## The demo

| Min | Who | Show | Rubric row |
|---|---|---|---|
| 0:00 | R | **Problem + design.** `docs/DESIGN.md` ER diagram; why PostgreSQL for money, MongoDB for usage (`raw` differs per platform). | ER 2, justification 1 |
| 1:00 | R | **Schema + DDL.** `sql/init/01_schema.sql`: CHECKs, partial unique indexes, EXCLUDE on periods. Run `psql "$DATABASE_URL" -f sql/demo/ddl_demo.sql` (CREATE, ALTER + constraint, index used in EXPLAIN, constraint rejects bad row, DROP). | schema 3, DDL 4 |
| 2:00 | R | **Nested split (recursive CTE).** Admin → Tracks → *Midnight Static*: effective split `The Night Owls 70% > Owl Beats Collective 50% > Kai 60%` = 21%. Show `resolve_contract_split` in `02_logic.sql`. | procedure/function/trigger/CTE 6 |
| 3:00 | R | **Triggers decide.** Artists → *Owl Beats Collective* → Members: set Kai to 59 → Save → `Member shares of group 6 total 99 percent, must be exactly 100`. Tracks → *Unfinished Demo* → Activate → `Splits of contract 8 total 90 percent, must be exactly 100`. | trigger 6, Next.js 3 |
| 4:00 | S | **MongoDB create + validation.** Periods → 2026-09 → upload a CSV with bad rows → `3 invalid rows`, row numbers listed, nothing stored; then a good file → `Stored batch … with 2 rows`. | NoSQL creation 4, NoSQL CRUD 7 |
| 5:00 | S | **MongoDB read/update/delete.** Dispute the Apple Music batch → *Write usage summary* refused (`…has disputed batches…`) → Resolve. Preview + *Void duplicates* (150), *Void bot plays* (150 from 1 listener-hour), *Purge all voided events* (300 deleted). | NoSQL R/U/D 7 |
| 6:30 | S | **Into PostgreSQL + procedure.** *Write usage summary* (21 rows, `{track_id, platform, plays}`) → *Close period* (`CALL close_payout_period`, 4 payouts) → ledger with share paths → *Pay* one payout. In psql: `SELECT mark_payout_paid(1);` → `Payout 1 is already paid`. | DML 4, procedure 6, API + DB 2 |
| 7:30 | S | **Important queries.** `sql/demo/queries_output.txt`: Q1 join, Q2 GROUP BY/HAVING, Q3 recursive, Q4 correlated, Q5 nested, Q7 reconciliation (0 rows). | queries 4 |
| 8:30 | R | **Roles in the database.** Nova's window: `/me` shows only Nova's lines and payouts; open `/admin/periods` → 403. Auditor window: `/audit` ledger + audit trail (before/after, actor); auditor cannot pay (403). In psql: `BEGIN; SET LOCAL ROLE rl_artist; SELECT set_config('app.artist_id','3',true); SELECT count(*) FROM payout; ROLLBACK;` → only Mira's rows (RLS). | auth + RBAC 4 |
| 9:30 | R+S | **Tests + Git.** `scripts/test_db.sh` (20 groups) and `npm test` (137 tests); GitHub PR list: one PR per work package, each under its owner's account. | docs + Git 2 |

### Expected outputs (from the 2026-11-17 dry run)
```
[Upload bad.csv]  400 -> 3 invalid rows | Row 2: plays: must be >= 1 | Row 3: track_id: track 999 does not exist
                                        | Row 4: played_at: 2026-10-05T12:00:00Z is outside period 2026-09
[Upload good.csv] 201 -> Stored batch … with 2 rows
[Dispute]             -> Batch disputed
[Write usage summary] 409 -> Period 2026-09 has disputed batches (apple_music_2026_09.csv); resolve them first
[Void duplicates]     200 -> Voided 150 duplicate events
[Void bot plays]      200 -> Voided 150 events from 1 listener-hours
[Purge all voided]    200 -> Purged 300 voided events
[Write usage summary] 200 -> Wrote 21 usage_summary rows (4703 plays)
[Close period]        200 -> Period closed: 4 payouts created
pay again                409 Payout 1 is already paid
nova -> /admin/periods   403
auditor pays             403
```
Files for the upload step (save them before the viva):
```
bad.csv
track_id,plays,listener_hash,played_at,device
1,1,lh_a,2026-09-03T10:00:00Z,mobile
2,0,lh_b,2026-09-03T11:00:00Z,mobile
999,1,lh_c,2026-09-03T12:00:00Z,tv
3,1,lh_d,2026-10-05T12:00:00Z,tv

good.csv
track_id,plays,listener_hash,played_at,device,playlist
4,1,lh_new1,2026-09-20T08:00:00Z,mobile,Indie Chill
5,2,lh_new2,2026-09-21T09:30:00Z,car,none
```
To repeat the demo, run `scripts/db_reset.sh` again (closing a period is final by design).

## Rubric checklist (2026-11-17)
| Row | Marks | Evidence | Status |
|---|---|---|---|
| ER diagram | 2 | Mermaid in `docs/DESIGN.md` §4 | **Open:** `docs/er-diagram.png` (used in REPORT §3) still shows the Nov 2 schema; re-export from the Mermaid block |
| Relational schema, keys, constraints | 3 | `01_schema.sql`, REPORT §4–5 (generated data dictionary) | ok |
| SQL DDL with constraints | 4 | `01_schema.sql`, `sql/demo/ddl_demo.sql` | ok |
| NoSQL creation | 4 | `mongo/init/01_init.js` (validators, indexes), import route | ok |
| Technology justification | 1 | DESIGN §3, REPORT §8–9 | ok |
| DML | 4 | app routes, `queries.sql` Q11 | ok |
| Nested / correlated / recursive / join | 4 | `queries.sql` Q1–Q5 + `queries_output.txt` | ok |
| Procedure / function, trigger, CTE | 6 | `02_logic.sql`, tests T1–T20 | ok |
| NoSQL read / update / delete | 7 | `usage_ops.js`, WP2 routes, WP7 screen, `mongo/demo/usage_queries_output.txt` | ok |
| Next.js interface | 3 | `/admin/*`, `/me`, `/audit`; `docs/screenshots/` | ok |
| Backend / API + DB integration | 2 | `withDb`, `.env` config, API contract | ok |
| Auth, 2+ roles, DB-level RBAC | 4 | WP1, `03_roles.sql`, RLS tests | ok |
| Documentation, Git / GitHub | 2 | REPORT, README, 14 PRs, per-person commits | ok |
| Originality, contribution, modification, viva | 4 | `docs/VIVA_TOPICS_rohit.md`, `docs/VIVA_TOPICS_shana.md` | prepare live modifications |
