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
