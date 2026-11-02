-- =====================================================================
-- Database logic tests. Run on a FRESH database that has sql/init/*.sql applied:
--     scripts/test_db.sh
-- Any failed assertion raises an exception and stops the run (ON_ERROR_STOP).
-- =====================================================================
\set ON_ERROR_STOP on
\set QUIET on

-- helper: assert that a statement fails with an error containing a fragment
CREATE FUNCTION pg_temp.expect_error(p_sql TEXT, p_fragment TEXT) RETURNS VOID
LANGUAGE plpgsql AS $$
BEGIN
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

\echo T1  recursive split resolution (nested groups)
SELECT pg_temp.assert_eq('Nova on track 1', (SELECT effective_pct FROM resolve_split(1) WHERE artist_id = 1), 40);
SELECT pg_temp.assert_eq('Kai on track 1',  (SELECT effective_pct FROM resolve_split(1) WHERE artist_id = 2), 24);
SELECT pg_temp.assert_eq('Lina on track 1', (SELECT effective_pct FROM resolve_split(1) WHERE artist_id = 4), 16);
SELECT pg_temp.assert_eq('Mira on track 1', (SELECT effective_pct FROM resolve_split(1) WHERE artist_id = 3), 20);
SELECT pg_temp.assert_eq('track 1 total',   (SELECT SUM(effective_pct) FROM resolve_split(1)), 100);

\echo T2  contract that does not total 100 cannot activate, and rollback keeps old contract active
SELECT create_contract_draft(2, 1);                      -- contract 4, v2 of track 2
INSERT INTO contract_split VALUES (4, 1, 90);
SELECT pg_temp.expect_error('SELECT activate_contract(4)', 'must be exactly 100');
SELECT pg_temp.assert_eq('old contract still active',
       (SELECT COUNT(*) FROM contract WHERE track_id = 2 AND status = 'active' AND contract_id = 2), 1);
DELETE FROM contract WHERE contract_id = 4;              -- drafts may be deleted

\echo T3  active contract is frozen
SELECT pg_temp.expect_error('UPDATE contract_split SET share_pct = 50 WHERE contract_id = 1 AND artist_id = 3', 'frozen');
SELECT pg_temp.expect_error('INSERT INTO contract_split VALUES (1, 4, 5)', 'frozen');
SELECT pg_temp.expect_error('DELETE FROM contract WHERE contract_id = 1', 'Only draft contracts');

\echo T4  only one active contract per track (unique partial index)
SELECT create_contract_draft(3, 1);                      -- contract 5
INSERT INTO contract_split VALUES (5, 2, 100);
SELECT pg_temp.expect_error('UPDATE contract SET status = ''active'', activated_at = now() WHERE contract_id = 5',
                            'uq_one_active_contract_per_track');
DELETE FROM contract WHERE contract_id = 5;

\echo T5  group membership: cycles rejected, shares must total 100
SELECT pg_temp.expect_error('INSERT INTO group_member VALUES (6, 5, 10)', 'cycle');
SELECT pg_temp.expect_error('SET CONSTRAINTS ALL IMMEDIATE; INSERT INTO group_member VALUES (6, 3, 10)', 'must be exactly 100');
SELECT pg_temp.expect_error('INSERT INTO group_member VALUES (1, 2, 50)', 'is not a group');

\echo T6  declarative constraints
SELECT pg_temp.expect_error('INSERT INTO track (isrc, title) VALUES (''bad'', ''x'')', 'check constraint');
SELECT pg_temp.expect_error('INSERT INTO app_user (email, password_hash, display_name, role) VALUES (''nope'', ''x'', ''x'', ''admin'')', 'check constraint');
SELECT pg_temp.expect_error('INSERT INTO payout_period (period_start, period_end) VALUES (''2026-09-15'', ''2026-10-15'')', 'exclusion');
SELECT pg_temp.expect_error('INSERT INTO platform (code, display_name, rate_per_play) VALUES (''Bad Code'', ''x'', 0.1)', 'check constraint');

\echo T7  closing a period: no usage -> rejected
SELECT pg_temp.expect_error('CALL close_payout_period(1, 1)', 'no usage loaded');

\echo T8  closing a period end to end
INSERT INTO usage_summary (period_id, track_id, platform_id, plays) VALUES
    (1, 1, 1, 1000000),   -- Midnight Static  spotify      -> 4000
    (1, 1, 2,  500000),   -- Midnight Static  youtube      -> 1000
    (1, 2, 3,  200000),   -- Paper Lanterns   apple_music  -> 1400
    (1, 3, 4,  400000),   -- Neon Monsoon     radio        ->  600
    (1, 3, 1,  100000);   -- Neon Monsoon     spotify      ->  400
CALL close_payout_period(1, 1);
SELECT pg_temp.assert_eq('ledger total',  (SELECT SUM(amount) FROM ledger_entry WHERE period_id = 1), 7400);
SELECT pg_temp.assert_eq('payout total',  (SELECT SUM(total_amount) FROM payout WHERE period_id = 1), 7400);
SELECT pg_temp.assert_eq('Nova payout',   (SELECT total_amount FROM payout WHERE period_id = 1 AND artist_id = 1), 3400);
SELECT pg_temp.assert_eq('Kai payout',    (SELECT total_amount FROM payout WHERE period_id = 1 AND artist_id = 2), 1700);
SELECT pg_temp.assert_eq('Mira payout',   (SELECT total_amount FROM payout WHERE period_id = 1 AND artist_id = 3), 1000);
SELECT pg_temp.assert_eq('Lina payout',   (SELECT total_amount FROM payout WHERE period_id = 1 AND artist_id = 4), 1300);
SELECT pg_temp.assert_eq('period closed', (SELECT COUNT(*) FROM payout_period WHERE period_id = 1 AND status = 'closed'), 1);

\echo T9  closed period / ledger are immutable, no double close
SELECT pg_temp.expect_error('CALL close_payout_period(1, 1)', 'already closed');
SELECT pg_temp.expect_error('INSERT INTO usage_summary VALUES (1, 2, 1, 5)', 'closed period');
SELECT pg_temp.expect_error('UPDATE usage_summary SET plays = 1 WHERE period_id = 1', 'closed period');
SELECT pg_temp.expect_error('UPDATE ledger_entry SET amount = 0', 'append-only');
SELECT pg_temp.expect_error('DELETE FROM ledger_entry', 'append-only');
SELECT pg_temp.expect_error('UPDATE payout_period SET period_end = ''2026-10-05'' WHERE period_id = 1', 'closed');

\echo T10 closing fails when a track has no active contract (and rolls back completely)
INSERT INTO track (isrc, title) VALUES ('INABC2600099', 'Orphan Track');
INSERT INTO payout_period (period_start, period_end) VALUES ('2026-10-01', '2026-10-31');
INSERT INTO usage_summary
    SELECT p.period_id, t.track_id, 1, 1000
    FROM payout_period p, track t
    WHERE p.period_start = '2026-10-01' AND t.title = 'Orphan Track';
SELECT pg_temp.expect_error(
    $x$DO $y$ DECLARE v INT; BEGIN
         SELECT period_id INTO v FROM payout_period WHERE period_start = '2026-10-01';
         CALL close_payout_period(v, 1);
       END $y$$x$,
    'no active contract');
SELECT pg_temp.assert_eq('nothing written for the failed period',
       (SELECT COUNT(*) FROM ledger_entry le JOIN payout_period p USING (period_id) WHERE p.period_start = '2026-10-01'), 0);
SELECT pg_temp.assert_eq('failed period still open',
       (SELECT COUNT(*) FROM payout_period WHERE period_start = '2026-10-01' AND status = 'open'), 1);

\echo T11 payouts: pay once, never twice, amounts frozen
SELECT mark_payout_paid((SELECT payout_id FROM payout WHERE period_id = 1 AND artist_id = 1));
SELECT pg_temp.expect_error(
    'SELECT mark_payout_paid((SELECT payout_id FROM payout WHERE period_id = 1 AND artist_id = 1))', 'already paid');
SELECT pg_temp.expect_error('UPDATE payout SET total_amount = 1 WHERE artist_id = 2', 'Only the status');
SELECT pg_temp.expect_error('DELETE FROM payout', 'cannot be deleted');
SELECT pg_temp.expect_error('INSERT INTO payout (period_id, artist_id, total_amount) VALUES (1, 1, 5)', 'duplicate key');

\echo T12 audit trail
SELECT pg_temp.assert_eq('contract activation audited',
       (SELECT COUNT(*) FROM audit_log WHERE table_name = 'contract' AND action = 'UPDATE' AND new_data ->> 'status' = 'active'), 3);
SELECT pg_temp.assert_eq('period close audited',
       (SELECT COUNT(*) FROM audit_log WHERE table_name = 'payout_period' AND action = 'UPDATE' AND new_data ->> 'status' = 'closed'), 1);
SELECT pg_temp.assert_eq('payout paid audited',
       (SELECT COUNT(*) FROM audit_log WHERE table_name = 'payout' AND action = 'UPDATE' AND new_data ->> 'status' = 'paid'), 1);

\echo T13 full-text search
SELECT pg_temp.assert_eq('search finds track', (SELECT COUNT(*) FROM search_catalog('midnight') WHERE kind = 'track'), 1);
SELECT pg_temp.assert_eq('search finds artist', (SELECT COUNT(*) FROM search_catalog('owls') WHERE kind = 'artist'), 1);

\echo T14 role-based access: artist sees only own money, cannot write
BEGIN;
SET LOCAL ROLE rl_artist;
SET LOCAL app.artist_id = '3';
SELECT pg_temp.assert_eq('Mira sees own ledger rows', (SELECT COUNT(*) FROM ledger_entry), 2);
SELECT pg_temp.assert_eq('Mira sees own payout only', (SELECT COUNT(*) FROM payout), 1);
SELECT pg_temp.assert_eq('statement view obeys RLS', (SELECT COUNT(*) FROM v_artist_statement WHERE artist_id <> 3), 0);
DO $$
BEGIN
    BEGIN
        INSERT INTO platform (code, display_name, rate_per_play) VALUES ('x', 'x', 1);
        RAISE EXCEPTION 'artist was able to insert';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
        PERFORM 1 FROM app_user LIMIT 1;
        RAISE EXCEPTION 'artist was able to read app_user';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
END $$;
ROLLBACK;

\echo T15 role-based access: auditor reads everything, writes nothing
BEGIN;
SET LOCAL ROLE rl_auditor;
SELECT pg_temp.assert_eq('auditor sees all ledger rows', (SELECT COUNT(*) FROM ledger_entry), 13);
DO $$
BEGIN
    BEGIN
        UPDATE track SET title = 'x';
        RAISE EXCEPTION 'auditor was able to update';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
END $$;
ROLLBACK;

\echo ALL TESTS PASSED
