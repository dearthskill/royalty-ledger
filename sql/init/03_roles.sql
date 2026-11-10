-- =====================================================================
-- Database-level role-based access control.
-- The app connects with one login and, per request, runs (lib/db.ts withDb):
--     BEGIN;
--     SET LOCAL ROLE rl_artist;                                -- or rl_admin / rl_auditor
--     SELECT set_config('app.user_id',   '<user_id>',   true); -- audit actor
--     SELECT set_config('app.artist_id', '<artist_id>', true); -- artists only (row-level security)
--     ... queries ...
--     COMMIT;
-- =====================================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rl_admin')   THEN CREATE ROLE rl_admin   NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rl_artist')  THEN CREATE ROLE rl_artist  NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rl_auditor') THEN CREATE ROLE rl_auditor NOLOGIN; END IF;
END $$;

-- The app's login role (the one running these scripts) may switch into the three roles.
GRANT rl_admin, rl_artist, rl_auditor TO CURRENT_USER;

GRANT USAGE ON SCHEMA public TO rl_admin, rl_artist, rl_auditor;

-- ----- admin: day-to-day work, but history (ledger, audit) is never edited -----
GRANT SELECT, INSERT, UPDATE, DELETE ON
    artist, group_member, platform, track, contract, contract_split,
    payout_period, usage_summary, payout
TO rl_admin;
GRANT SELECT, INSERT ON ledger_entry, audit_log TO rl_admin;
GRANT SELECT ON v_active_split, v_contract_overview, v_artist_statement, v_period_totals TO rl_admin;

-- ----- auditor: read everything, write nothing -----
GRANT SELECT ON
    artist, group_member, platform, track, contract, contract_split,
    payout_period, usage_summary, ledger_entry, payout, audit_log,
    v_active_split, v_contract_overview, v_artist_statement, v_period_totals
TO rl_auditor;

-- ----- artist: catalogue names plus their own money (rows filtered by RLS) -----
GRANT SELECT ON artist, track, platform, payout_period TO rl_artist;
GRANT SELECT ON ledger_entry, payout, v_artist_statement TO rl_artist;

-- No app role is granted anything on app_user: only the login step (owner role) reads it.

-- ----- row-level security on the money tables -----
ALTER TABLE ledger_entry ENABLE ROW LEVEL SECURITY;
ALTER TABLE payout       ENABLE ROW LEVEL SECURITY;

CREATE POLICY ledger_admin   ON ledger_entry FOR ALL    TO rl_admin   USING (true) WITH CHECK (true);
CREATE POLICY ledger_auditor ON ledger_entry FOR SELECT TO rl_auditor USING (true);
CREATE POLICY ledger_artist  ON ledger_entry FOR SELECT TO rl_artist
    USING (artist_id = NULLIF(current_setting('app.artist_id', true), '')::INT);

CREATE POLICY payout_admin   ON payout FOR ALL    TO rl_admin   USING (true) WITH CHECK (true);
CREATE POLICY payout_auditor ON payout FOR SELECT TO rl_auditor USING (true);
CREATE POLICY payout_artist  ON payout FOR SELECT TO rl_artist
    USING (artist_id = NULLIF(current_setting('app.artist_id', true), '')::INT);
