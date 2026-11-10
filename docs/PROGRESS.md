# Progress

One row per work package (WP), matching CLAUDE.md section 5. Updated in the last commit of each WP's branch.
A fresh session continues at the first WP for its person that is not `merged`.
Owner A = Rohit, B = Shana. Status: `todo` -> `in progress` -> `PR open` -> `merged`.

| WP | Title | Owner | Branch | PR | Status | Date |
|---|---|---|---|---|---|---|
| Z | Bootstrap: tools, repo, collaborator invite | A | feat/a-z-bootstrap | #1 | merged | 2026-11-10 |
| 0 | Database foundation (PostgreSQL) | A | feat/a-0-database-foundation | #2 | merged | 2026-11-10 |
| 0b | MongoDB foundation + API contract | A | feat/a-0b-mongo-foundation | #3 | merged | 2026-11-10 |
| 1 | Next.js scaffold + auth | A | | | todo | |
| 2 | Usage ingestion API (MongoDB R/U/D) | B | | | todo | |
| 3 | Catalogue API | A | | | todo | |
| 4 | Contracts API | A | | | todo | |
| 5 | Aggregate, close, ledger, payouts | B | | | todo | |
| 6 | Admin UI: catalogue and contracts | A | | | todo | |
| 7 | Admin UI: usage and payouts | B | | | todo | |
| 8 | Artist and auditor views | B | | | todo | |
| 9 | End-to-end scenario + API test sweep | B | | | todo | |
| 10a | Report slice A (docs/REPORT.md) | A | | | todo | |
| 10b | Report slice B (docs/REPORT.md) | B | | | todo | |
| 11 | Final verification, demo script | A | | | todo | |

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
