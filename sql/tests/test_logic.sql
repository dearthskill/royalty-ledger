-- =====================================================================
-- Database logic tests. Run on a FRESH database with sql/init/*.sql applied:
--     scripts/test_db.sh
-- Any failed assertion raises an exception and stops the run (ON_ERROR_STOP).
-- Seed facts used below are listed at the top of sql/init/04_seed.sql.
-- =====================================================================
\set ON_ERROR_STOP on
\set QUIET on

-- expect_error: the statement must fail with an error containing p_fragment.
-- Deferred constraints are made immediate so commit-time checks fire inside the call.
CREATE FUNCTION pg_temp.expect_error(p_sql TEXT, p_fragment TEXT) RETURNS VOID
LANGUAGE plpgsql AS $$
BEGIN
    SET CONSTRAINTS ALL IMMEDIATE;
    EXECUTE p_sql;
    RAISE EXCEPTION 'EXPECTED ERROR containing "%" but statement succeeded: %', p_fragment, p_sql;
EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'EXPECTED ERROR%' THEN RAISE; END IF;
    IF position(p_fragment IN SQLERRM) = 0 THEN
        RAISE EXCEPTION 'Wrong error for [%]: got "%", wanted fragment "%"', p_sql, SQLERRM, p_fragment;
    END IF;
END $$;

CREATE FUNCTION pg_temp.assert_eq(p_label TEXT, p_actual NUMERIC, p_expected NUMERIC) RETURNS VOID
LANGUAGE plpgsql AS $$
BEGIN
    IF p_actual IS DISTINCT FROM p_expected THEN
        RAISE EXCEPTION 'ASSERT FAILED [%]: got %, expected %', p_label, p_actual, p_expected;
    END IF;
END $$;

CREATE FUNCTION pg_temp.assert_text(p_label TEXT, p_actual TEXT, p_expected TEXT) RETURNS VOID
LANGUAGE plpgsql AS $$
BEGIN
    IF p_actual IS DISTINCT FROM p_expected THEN
        RAISE EXCEPTION 'ASSERT FAILED [%]: got "%", expected "%"', p_label, p_actual, p_expected;
    END IF;
END $$;

\echo T1  resolve_split: nested groups, effective shares, paths, total 100
SELECT pg_temp.assert_eq('Nova on track 1', (SELECT effective_pct FROM resolve_split(1) WHERE artist_id = 1), 35);
SELECT pg_temp.assert_eq('Kai on track 1',  (SELECT effective_pct FROM resolve_split(1) WHERE artist_id = 2), 21);
SELECT pg_temp.assert_eq('Lina on track 1', (SELECT effective_pct FROM resolve_split(1) WHERE artist_id = 4), 14);
SELECT pg_temp.assert_eq('Mira on track 1', (SELECT effective_pct FROM resolve_split(1) WHERE artist_id = 3), 30);
SELECT pg_temp.assert_eq('track 1 total',   (SELECT SUM(effective_pct) FROM resolve_split(1)), 100);
SELECT pg_temp.assert_eq('only solo leaves', (SELECT COUNT(*) FROM resolve_split(1) r JOIN artist a USING (artist_id) WHERE a.kind <> 'solo'), 0);
SELECT pg_temp.assert_text('Kai path', (SELECT path FROM resolve_split(1) WHERE artist_id = 2),
                           'The Night Owls 70% > Owl Beats Collective 50% > Kai 60%');
SELECT pg_temp.expect_error('SELECT * FROM resolve_split(8)', 'has no active contract');

\echo T2  group shares must total exactly 100 (deferred to COMMIT)
SELECT pg_temp.expect_error('UPDATE group_member SET share_pct = 49 WHERE group_id = 5 AND member_id = 1', 'must be exactly 100');
SELECT pg_temp.expect_error('INSERT INTO group_member VALUES (6, 3, 10)', 'must be exactly 100');
-- replacing the whole set row by row inside one transaction is fine
BEGIN;
DELETE FROM group_member WHERE group_id = 6;
INSERT INTO group_member VALUES (6, 2, 50);
INSERT INTO group_member VALUES (6, 4, 50);
COMMIT;
SELECT pg_temp.assert_eq('Kai now 17.5 on track 1', (SELECT effective_pct FROM resolve_split(1) WHERE artist_id = 2), 17.5);
BEGIN;
UPDATE group_member SET share_pct = 60 WHERE group_id = 6 AND member_id = 2;
UPDATE group_member SET share_pct = 40 WHERE group_id = 6 AND member_id = 4;
COMMIT;

\echo T3  group membership: no cycles, members only for groups, not self
SELECT pg_temp.expect_error('INSERT INTO group_member VALUES (6, 5, 10)', 'cycle');
SELECT pg_temp.expect_error('INSERT INTO group_member VALUES (1, 2, 50)', 'is not a group');
SELECT pg_temp.expect_error('INSERT INTO group_member VALUES (5, 5, 10)', 'cycle');                -- trigger runs before the CHECK
SELECT pg_temp.expect_error('INSERT INTO group_member VALUES (5, 2, 0)', 'check constraint');

\echo T4  splits are editable only on a draft
-- contract 9 = track 1 v2 (active), contract 1 = track 1 v1 (superseded), contract 8 = track 8 draft (90%)
SELECT pg_temp.expect_error('UPDATE contract_split SET share_pct = 50 WHERE contract_id = 9 AND artist_id = 3', 'only be edited on a draft');
SELECT pg_temp.expect_error('INSERT INTO contract_split VALUES (9, 4, 5)', 'only be edited on a draft');
SELECT pg_temp.expect_error('DELETE FROM contract_split WHERE contract_id = 1', 'only be edited on a draft');
UPDATE contract_split SET share_pct = 65 WHERE contract_id = 8 AND artist_id = 3;                               -- draft: fine
UPDATE contract_split SET share_pct = 60 WHERE contract_id = 8 AND artist_id = 3;

\echo T5  a draft totalling 90% cannot be activated
SELECT pg_temp.expect_error('SELECT activate_contract(8)', 'must be exactly 100');
SELECT pg_temp.expect_error('UPDATE contract SET status = ''active'', activated_at = now() WHERE contract_id = 8', 'must be exactly 100');
SELECT pg_temp.assert_eq('track 8 still has no active contract',
       (SELECT COUNT(*) FROM contract WHERE track_id = 8 AND status = 'active'), 0);

\echo T6  one active contract and one draft per track
SELECT pg_temp.expect_error('SELECT create_contract_draft(8)', 'already has a draft');
SELECT create_contract_draft(2) AS c_t2 \gset
SELECT pg_temp.expect_error(format('UPDATE contract SET status = ''active'', activated_at = now() WHERE contract_id = %s', :c_t2),
                            'uq_contract_one_active');
SELECT pg_temp.expect_error('INSERT INTO contract (track_id, version) VALUES (2, 99)', 'uq_contract_one_draft');

\echo T7  create_contract_draft copies the active splits; activate supersedes in one step
SELECT pg_temp.assert_eq('draft copied Nova 100',
       (SELECT share_pct FROM contract_split WHERE contract_id = :c_t2 AND artist_id = 1), 100);
SELECT pg_temp.assert_eq('draft version', (SELECT version FROM contract WHERE contract_id = :c_t2), 2);
UPDATE contract_split SET share_pct = 60 WHERE contract_id = :c_t2 AND artist_id = 1;
INSERT INTO contract_split VALUES (:c_t2, 3, 40);
SELECT activate_contract(:c_t2);
SELECT pg_temp.assert_text('old contract superseded', (SELECT status FROM contract WHERE contract_id = 2), 'superseded');
SELECT pg_temp.assert_text('new contract active',     (SELECT status FROM contract WHERE contract_id = :c_t2), 'active');
SELECT pg_temp.expect_error(format('SELECT activate_contract(%s)', :c_t2), 'only a draft can be activated');
SELECT pg_temp.expect_error('UPDATE contract SET status = ''active'' WHERE contract_id = 2', 'superseded and cannot be changed');

\echo T8  only drafts can be deleted; deleting a draft removes its splits
SELECT pg_temp.expect_error(format('DELETE FROM contract WHERE contract_id = %s', :c_t2), 'Only draft contracts');
SELECT create_contract_draft(3) AS c_t3 \gset
SELECT pg_temp.assert_eq('draft has copied splits', (SELECT COUNT(*) FROM contract_split WHERE contract_id = :c_t3), 2);
DELETE FROM contract WHERE contract_id = :c_t3;
SELECT pg_temp.assert_eq('draft splits gone', (SELECT COUNT(*) FROM contract_split WHERE contract_id = :c_t3), 0);

\echo T9  declarative constraints (CHECK, UNIQUE, EXCLUDE)
SELECT pg_temp.expect_error('INSERT INTO track (title, isrc, primary_artist_id) VALUES (''x'', ''bad'', 1)', 'check constraint');
SELECT pg_temp.expect_error('INSERT INTO track (title, isrc, primary_artist_id) VALUES (''x'', ''INABC2600001'', 1)', 'duplicate key');
SELECT pg_temp.expect_error('INSERT INTO payout_period (label, starts_on, ends_on) VALUES (''x'', ''2026-09-15'', ''2026-10-15'')', 'period_no_overlap');
SELECT pg_temp.expect_error('INSERT INTO payout_period (label, starts_on, ends_on) VALUES (''x'', ''2026-12-10'', ''2026-12-01'')', 'period_dates');
SELECT pg_temp.expect_error('INSERT INTO platform (code, name, rate_per_play) VALUES (''Bad Code'', ''x'', 0.1)', 'check constraint');
SELECT pg_temp.expect_error('INSERT INTO platform (code, name, rate_per_play) VALUES (''radio'', ''Radio'', 0)', 'check constraint');
SELECT pg_temp.expect_error('INSERT INTO app_user (email, password_hash, role) VALUES (''x@y.test'', ''x'', ''artist'')', 'app_user_artist_role');
SELECT pg_temp.expect_error('INSERT INTO app_user (email, password_hash, role, artist_id) VALUES (''x@y.test'', ''x'', ''admin'', 2)', 'app_user_artist_role');
SELECT pg_temp.expect_error('INSERT INTO app_user (email, password_hash, role) VALUES (''nope'', ''x'', ''admin'')', 'check constraint');

\echo T10 ledger is append-only
SELECT pg_temp.expect_error('UPDATE ledger_entry SET amount = 0', 'append-only');
SELECT pg_temp.expect_error('DELETE FROM ledger_entry', 'append-only');

\echo T11 a closed period and its usage are immutable
SELECT pg_temp.expect_error('INSERT INTO usage_summary VALUES (2, 4, ''spotify'', 5)', 'closed period');
SELECT pg_temp.expect_error('UPDATE usage_summary SET plays = 1 WHERE period_id = 2', 'closed period');
SELECT pg_temp.expect_error('DELETE FROM usage_summary WHERE period_id = 2', 'closed period');
SELECT pg_temp.expect_error('UPDATE payout_period SET ends_on = ''2026-08-30'' WHERE period_id = 2', 'is closed');
SELECT pg_temp.expect_error('DELETE FROM payout_period WHERE period_id = 2', 'is closed');

\echo T12 closing: double close and empty period are rejected
SELECT pg_temp.expect_error('CALL close_payout_period(2)', 'already closed');
SELECT pg_temp.expect_error('CALL close_payout_period(1)', 'no usage loaded');
SELECT pg_temp.expect_error('CALL close_payout_period(999)', 'does not exist');

\echo T13 closing fails for a track without an active contract and writes nothing
INSERT INTO usage_summary VALUES (1, 8, 'spotify', 1000);
SELECT pg_temp.expect_error('CALL close_payout_period(1)', 'no active contract for Unfinished Demo');
SELECT pg_temp.assert_eq('no ledger rows written', (SELECT COUNT(*) FROM ledger_entry WHERE period_id = 1), 0);
SELECT pg_temp.assert_eq('no payouts written',     (SELECT COUNT(*) FROM payout WHERE period_id = 1), 0);
SELECT pg_temp.assert_text('period still open', (SELECT status FROM payout_period WHERE period_id = 1), 'open');
DELETE FROM usage_summary WHERE period_id = 1;

\echo T14 closing a period end to end (ledger = plays x rate x effective share)
INSERT INTO usage_summary (period_id, track_id, platform_code, plays) VALUES
    (1, 1, 'spotify',     1000000),   -- 4000: Nova 1400, Kai 840, Lina 560, Mira 1200
    (1, 2, 'apple_music',  100000),   --  700: Nova 420, Mira 280 (track 2 v2 from T7)
    (1, 3, 'youtube',      500000);   -- 1000: Kai 500, Lina 500
CALL close_payout_period(1);
SELECT pg_temp.assert_eq('ledger rows',   (SELECT COUNT(*) FROM ledger_entry WHERE period_id = 1), 8);
SELECT pg_temp.assert_eq('ledger total',  (SELECT SUM(amount) FROM ledger_entry WHERE period_id = 1), 5700);
SELECT pg_temp.assert_eq('payout total',  (SELECT SUM(amount) FROM payout WHERE period_id = 1), 5700);
SELECT pg_temp.assert_eq('Nova payout',   (SELECT amount FROM payout WHERE period_id = 1 AND artist_id = 1), 1820);
SELECT pg_temp.assert_eq('Kai payout',    (SELECT amount FROM payout WHERE period_id = 1 AND artist_id = 2), 1340);
SELECT pg_temp.assert_eq('Mira payout',   (SELECT amount FROM payout WHERE period_id = 1 AND artist_id = 3), 1480);
SELECT pg_temp.assert_eq('Lina payout',   (SELECT amount FROM payout WHERE period_id = 1 AND artist_id = 4), 1060);
SELECT pg_temp.assert_eq('no group is paid', (SELECT COUNT(*) FROM payout p JOIN artist a USING (artist_id) WHERE a.kind = 'group'), 0);
SELECT pg_temp.assert_text('period closed', (SELECT status FROM payout_period WHERE period_id = 1), 'closed');
SELECT pg_temp.assert_text('ledger uses track 1 v2', (SELECT DISTINCT c.version::TEXT FROM ledger_entry le JOIN contract c USING (contract_id) WHERE le.period_id = 1 AND le.track_id = 1), '2');
SELECT pg_temp.assert_text('August ledger kept v1',  (SELECT DISTINCT c.version::TEXT FROM ledger_entry le JOIN contract c USING (contract_id) WHERE le.period_id = 2 AND le.track_id = 1), '1');

\echo T15 payouts: pay once, never twice; amounts frozen; never deleted
SELECT mark_payout_paid((SELECT payout_id FROM payout WHERE period_id = 1 AND artist_id = 2));
SELECT pg_temp.expect_error('SELECT mark_payout_paid((SELECT payout_id FROM payout WHERE period_id = 1 AND artist_id = 2))', 'already paid');
SELECT pg_temp.expect_error('SELECT mark_payout_paid(999)', 'does not exist');
SELECT pg_temp.expect_error('UPDATE payout SET amount = 1 WHERE period_id = 1 AND artist_id = 3', 'Only the status');
SELECT pg_temp.expect_error('UPDATE payout SET status = ''pending'', paid_at = NULL WHERE period_id = 1 AND artist_id = 2', 'already paid');
SELECT pg_temp.expect_error('DELETE FROM payout', 'cannot be deleted');
SELECT pg_temp.expect_error('INSERT INTO payout (period_id, artist_id, amount) VALUES (1, 1, 5)', 'duplicate key');

\echo T16 RLS: an artist sees only their own ledger rows and payouts
BEGIN;
SET LOCAL ROLE rl_artist;
SELECT set_config('app.artist_id', '3', true);
SELECT pg_temp.assert_eq('Mira ledger rows (Aug 1 + Sep 2)', (SELECT COUNT(*) FROM ledger_entry), 3);
SELECT pg_temp.assert_eq('Mira payouts', (SELECT COUNT(*) FROM payout), 2);
SELECT pg_temp.assert_eq('statement view obeys RLS', (SELECT COUNT(*) FROM v_artist_statement WHERE artist_id <> 3), 0);
SELECT pg_temp.expect_error('SELECT 1 FROM app_user', 'permission denied');
SELECT pg_temp.expect_error('INSERT INTO platform VALUES (''x'', ''x'', 1)', 'permission denied');
SELECT pg_temp.expect_error('SELECT 1 FROM usage_summary', 'permission denied');
ROLLBACK;
BEGIN;
SET LOCAL ROLE rl_artist;                                -- no app.artist_id at all -> nothing visible
SELECT pg_temp.assert_eq('artist without id sees nothing', (SELECT COUNT(*) FROM payout), 0);
ROLLBACK;

\echo T17 auditor reads everything and writes nothing; admin cannot edit history
BEGIN;
SET LOCAL ROLE rl_auditor;
SELECT pg_temp.assert_eq('auditor sees all ledger rows', (SELECT COUNT(*) FROM ledger_entry), 15);
SELECT pg_temp.assert_eq('auditor sees audit log', (SELECT (COUNT(*) > 0)::INT FROM audit_log), 1);
SELECT pg_temp.expect_error('UPDATE track SET title = ''x''', 'permission denied');
SELECT pg_temp.expect_error('SELECT mark_payout_paid(3)', 'permission denied');
SELECT pg_temp.expect_error('SELECT 1 FROM app_user', 'permission denied');
ROLLBACK;
BEGIN;
SET LOCAL ROLE rl_admin;
SELECT pg_temp.assert_eq('admin sees all payouts', (SELECT COUNT(*) FROM payout), 8);
SELECT pg_temp.expect_error('UPDATE ledger_entry SET amount = 0', 'permission denied');
SELECT pg_temp.expect_error('DELETE FROM audit_log', 'permission denied');
SELECT pg_temp.expect_error('SELECT 1 FROM app_user', 'permission denied');
ROLLBACK;

\echo T18 audit trail records before/after and the acting user
SELECT pg_temp.assert_eq('activations audited',
       (SELECT COUNT(*) FROM audit_log WHERE table_name = 'contract' AND op = 'UPDATE' AND after ->> 'status' = 'active'), 9);
SELECT pg_temp.assert_eq('period closes audited',
       (SELECT COUNT(*) FROM audit_log WHERE table_name = 'payout_period' AND op = 'UPDATE' AND after ->> 'status' = 'closed'), 2);
SELECT user_id AS admin_id FROM app_user WHERE email = 'admin@royalty.test' \gset
BEGIN;
SET LOCAL ROLE rl_admin;                                 -- as the app does it (lib/db.ts withDb)
SELECT set_config('app.user_id', :'admin_id', true);
SELECT mark_payout_paid((SELECT payout_id FROM payout WHERE period_id = 1 AND artist_id = 4));
COMMIT;
SELECT pg_temp.assert_text('actor is the app user',
       (SELECT actor FROM audit_log WHERE table_name = 'payout' AND op = 'UPDATE' ORDER BY audit_id DESC LIMIT 1), 'admin@royalty.test');
SELECT pg_temp.assert_text('before/after captured',
       (SELECT (before ->> 'status') || '->' || (after ->> 'status') FROM audit_log
        WHERE table_name = 'payout' AND op = 'UPDATE' ORDER BY audit_id DESC LIMIT 1), 'pending->paid');

\echo T19 full-text search over tracks and artists
SELECT pg_temp.assert_eq('prefix finds track',  (SELECT COUNT(*) FROM search_catalog('midni') WHERE kind = 'track'), 1);
SELECT pg_temp.assert_eq('finds artist',        (SELECT COUNT(*) FROM search_catalog('night owls') WHERE kind = 'artist'), 1);
SELECT pg_temp.assert_eq('multi-word is AND',   (SELECT COUNT(*) FROM search_catalog('owl light')), 1);
SELECT pg_temp.assert_eq('punctuation is safe', (SELECT COUNT(*) FROM search_catalog(''')&|!:*')), 0);
SELECT pg_temp.assert_eq('empty query',         (SELECT COUNT(*) FROM search_catalog('')), 0);

\echo T20 views
SELECT pg_temp.assert_eq('v_active_split totals 100 per track',
       (SELECT COUNT(*) FROM (SELECT track_id FROM v_active_split GROUP BY track_id HAVING SUM(effective_pct) <> 100) x), 0);
SELECT pg_temp.assert_eq('v_contract_overview shows the 90% draft',
       (SELECT total_share_pct FROM v_contract_overview WHERE contract_id = 8), 90);
SELECT pg_temp.assert_eq('v_period_totals Sept payout', (SELECT payout_total FROM v_period_totals WHERE period_id = 1), 5700);

\echo ALL TESTS PASSED
