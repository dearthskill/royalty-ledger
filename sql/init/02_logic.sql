-- =====================================================================
-- Business logic: functions, triggers, stored procedure, views
-- =====================================================================

-- ---------------------------------------------------------------------
-- Recursive split resolution.
-- Expands group artists through group_member (any depth up to 8) and returns
-- the solo beneficiaries with their effective percentage of the track.
-- Returns NO ROWS if the result does not total 100% (caller treats as error).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION resolve_split(p_contract_id INT)
RETURNS TABLE (artist_id INT, effective_pct NUMERIC)
LANGUAGE plpgsql STABLE AS $$
BEGIN
    RETURN QUERY
    WITH RECURSIVE expand(a_id, pct, depth) AS (
        SELECT cs.artist_id, cs.share_pct::NUMERIC, 0
        FROM   contract_split cs
        WHERE  cs.contract_id = p_contract_id
      UNION ALL
        SELECT gm.member_id, e.pct * gm.share_pct / 100, e.depth + 1
        FROM   expand e
        JOIN   artist a       ON a.artist_id = e.a_id AND a.kind = 'group'
        JOIN   group_member gm ON gm.group_id = e.a_id
        WHERE  e.depth < 8
    ),
    leaf AS (
        SELECT e.a_id, SUM(e.pct) AS pct
        FROM   expand e
        JOIN   artist a ON a.artist_id = e.a_id AND a.kind = 'solo'
        GROUP  BY e.a_id
    ),
    total AS (SELECT SUM(pct) AS s FROM leaf)
    SELECT l.a_id, l.pct
    FROM   leaf l, total t
    WHERE  abs(t.s - 100) < 0.0001;
END $$;

-- ---------------------------------------------------------------------
-- Generic audit trigger: TG_ARGV lists the primary-key column(s).
-- The acting user comes from the session setting app.user_id (set by the app
-- with SET LOCAL), falling back to the database role.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_audit() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
    v_row jsonb;
    v_pk  TEXT := '';
    v_col TEXT;
BEGIN
    v_row := to_jsonb(CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END);
    FOREACH v_col IN ARRAY TG_ARGV LOOP
        v_pk := v_pk || CASE WHEN v_pk = '' THEN '' ELSE '/' END || COALESCE(v_row ->> v_col, '');
    END LOOP;
    INSERT INTO audit_log (table_name, row_pk, action, old_data, new_data, changed_by)
    VALUES (TG_TABLE_NAME, v_pk, TG_OP,
            CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END,
            CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END,
            COALESCE(NULLIF(current_setting('app.user_id', true), ''), current_user));
    RETURN NULL;
END $$;

CREATE TRIGGER trg_audit_track          AFTER INSERT OR UPDATE OR DELETE ON track          FOR EACH ROW EXECUTE FUNCTION fn_audit('track_id');
CREATE TRIGGER trg_audit_contract       AFTER INSERT OR UPDATE OR DELETE ON contract       FOR EACH ROW EXECUTE FUNCTION fn_audit('contract_id');
CREATE TRIGGER trg_audit_contract_split AFTER INSERT OR UPDATE OR DELETE ON contract_split FOR EACH ROW EXECUTE FUNCTION fn_audit('contract_id', 'artist_id');
CREATE TRIGGER trg_audit_group_member   AFTER INSERT OR UPDATE OR DELETE ON group_member   FOR EACH ROW EXECUTE FUNCTION fn_audit('group_id', 'member_id');
CREATE TRIGGER trg_audit_payout_period  AFTER INSERT OR UPDATE OR DELETE ON payout_period  FOR EACH ROW EXECUTE FUNCTION fn_audit('period_id');
CREATE TRIGGER trg_audit_payout         AFTER INSERT OR UPDATE OR DELETE ON payout         FOR EACH ROW EXECUTE FUNCTION fn_audit('payout_id');

-- ---------------------------------------------------------------------
-- Contracts: a contract can only become active if its shares total exactly
-- 100%, and only a draft can be activated. Superseded contracts are final.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_contract_status_guard() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE v_total NUMERIC;
BEGIN
    IF OLD.status = 'superseded' THEN
        RAISE EXCEPTION 'Contract % is superseded and cannot be changed', OLD.contract_id;
    END IF;
    IF NEW.status = 'draft' AND OLD.status <> 'draft' THEN
        RAISE EXCEPTION 'Contract % cannot return to draft', OLD.contract_id;
    END IF;
    IF NEW.status = 'active' AND OLD.status = 'draft' THEN
        SELECT COALESCE(SUM(share_pct), 0) INTO v_total
        FROM contract_split WHERE contract_id = NEW.contract_id;
        IF v_total <> 100 THEN
            RAISE EXCEPTION 'Splits for contract % total % percent, must be exactly 100', NEW.contract_id, v_total;
        END IF;
    END IF;
    IF OLD.status <> 'draft' AND (NEW.track_id <> OLD.track_id OR NEW.version <> OLD.version) THEN
        RAISE EXCEPTION 'Track and version of a non-draft contract are immutable';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER trg_contract_status_guard
    BEFORE UPDATE ON contract FOR EACH ROW EXECUTE FUNCTION fn_contract_status_guard();

CREATE OR REPLACE FUNCTION fn_contract_delete_guard() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.status <> 'draft' THEN
        RAISE EXCEPTION 'Only draft contracts can be deleted (contract % is %)', OLD.contract_id, OLD.status;
    END IF;
    RETURN OLD;
END $$;

CREATE TRIGGER trg_contract_delete_guard
    BEFORE DELETE ON contract FOR EACH ROW EXECUTE FUNCTION fn_contract_delete_guard();

-- Shares can only be edited while the contract is still a draft.
CREATE OR REPLACE FUNCTION fn_contract_split_frozen() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE v_status contract_status;
BEGIN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
        SELECT status INTO v_status FROM contract WHERE contract_id = OLD.contract_id;
        IF v_status IS NOT NULL AND v_status <> 'draft' THEN
            RAISE EXCEPTION 'Splits of % contract % are frozen', v_status, OLD.contract_id;
        END IF;
    END IF;
    IF TG_OP IN ('INSERT', 'UPDATE') THEN
        SELECT status INTO v_status FROM contract WHERE contract_id = NEW.contract_id;
        IF v_status IS NOT NULL AND v_status <> 'draft' THEN
            RAISE EXCEPTION 'Splits of % contract % are frozen', v_status, NEW.contract_id;
        END IF;
    END IF;
    RETURN COALESCE(NEW, OLD);
END $$;

CREATE TRIGGER trg_contract_split_frozen
    BEFORE INSERT OR UPDATE OR DELETE ON contract_split
    FOR EACH ROW EXECUTE FUNCTION fn_contract_split_frozen();

-- Create the next draft version for a track.
CREATE OR REPLACE FUNCTION create_contract_draft(p_track_id INT, p_created_by INT DEFAULT NULL)
RETURNS INT LANGUAGE plpgsql AS $$
DECLARE v_id INT;
BEGIN
    INSERT INTO contract (track_id, version, created_by)
    SELECT p_track_id, COALESCE(MAX(version), 0) + 1, p_created_by
    FROM contract WHERE track_id = p_track_id
    RETURNING contract_id INTO v_id;
    RETURN v_id;
END $$;

-- Activate a draft: supersedes the current active contract in the same
-- transaction. If the shares do not total 100%, everything rolls back.
CREATE OR REPLACE FUNCTION activate_contract(p_contract_id INT)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_track INT;
BEGIN
    SELECT track_id INTO v_track FROM contract WHERE contract_id = p_contract_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Contract % does not exist', p_contract_id;
    END IF;
    UPDATE contract SET status = 'superseded'
    WHERE track_id = v_track AND status = 'active';
    UPDATE contract SET status = 'active', activated_at = now()
    WHERE contract_id = p_contract_id;
END $$;

-- ---------------------------------------------------------------------
-- Groups: member shares must total 100% (checked at commit, so rows can be
-- inserted one at a time inside a transaction); membership may not form a cycle.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_group_member_guard() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM artist WHERE artist_id = NEW.group_id AND kind = 'group') THEN
        RAISE EXCEPTION 'Artist % is not a group', NEW.group_id;
    END IF;
    IF EXISTS (
        WITH RECURSIVE down(a_id) AS (
            SELECT NEW.member_id
          UNION
            SELECT gm.member_id FROM group_member gm JOIN down d ON gm.group_id = d.a_id
        )
        SELECT 1 FROM down WHERE a_id = NEW.group_id
    ) THEN
        RAISE EXCEPTION 'Adding % to group % would create a membership cycle', NEW.member_id, NEW.group_id;
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER trg_group_member_guard
    BEFORE INSERT OR UPDATE ON group_member FOR EACH ROW EXECUTE FUNCTION fn_group_member_guard();

CREATE OR REPLACE FUNCTION fn_group_member_sum() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
    v_group INT;
    v_sum   NUMERIC;
    v_cnt   INT;
BEGIN
    FOR v_group IN
        SELECT DISTINCT g FROM (VALUES
            (CASE WHEN TG_OP <> 'INSERT' THEN OLD.group_id END),
            (CASE WHEN TG_OP <> 'DELETE' THEN NEW.group_id END)
        ) x(g) WHERE g IS NOT NULL
    LOOP
        SELECT COALESCE(SUM(share_pct), 0), COUNT(*) INTO v_sum, v_cnt
        FROM group_member WHERE group_id = v_group;
        IF v_cnt > 0 AND v_sum <> 100 THEN
            RAISE EXCEPTION 'Member shares of group % total % percent, must be exactly 100', v_group, v_sum;
        END IF;
    END LOOP;
    RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER trg_group_member_sum
    AFTER INSERT OR UPDATE OR DELETE ON group_member
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION fn_group_member_sum();

-- ---------------------------------------------------------------------
-- Period / usage / ledger / payout integrity
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_period_guard() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.status = 'closed' THEN
        RAISE EXCEPTION 'Period % is closed and cannot be changed', OLD.period_id;
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER trg_period_guard
    BEFORE UPDATE ON payout_period FOR EACH ROW EXECUTE FUNCTION fn_period_guard();

CREATE OR REPLACE FUNCTION fn_usage_period_open() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE v_status period_status;
BEGIN
    SELECT status INTO v_status FROM payout_period
    WHERE period_id = COALESCE(NEW.period_id, OLD.period_id);
    IF v_status = 'closed' THEN
        RAISE EXCEPTION 'Usage of a closed period cannot be modified';
    END IF;
    RETURN COALESCE(NEW, OLD);
END $$;

CREATE TRIGGER trg_usage_period_open
    BEFORE INSERT OR UPDATE OR DELETE ON usage_summary
    FOR EACH ROW EXECUTE FUNCTION fn_usage_period_open();

CREATE OR REPLACE FUNCTION fn_ledger_immutable() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'ledger_entry is append-only (% rejected)', TG_OP;
END $$;

CREATE TRIGGER trg_ledger_immutable
    BEFORE UPDATE OR DELETE ON ledger_entry FOR EACH ROW EXECUTE FUNCTION fn_ledger_immutable();

-- Only status / paid_at of a payout may change; amounts are frozen.
CREATE OR REPLACE FUNCTION fn_payout_guard() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Payouts cannot be deleted';
    END IF;
    IF NEW.period_id <> OLD.period_id OR NEW.artist_id <> OLD.artist_id
       OR NEW.total_amount <> OLD.total_amount THEN
        RAISE EXCEPTION 'Only the status of a payout can change';
    END IF;
    IF OLD.status = 'paid' THEN
        RAISE EXCEPTION 'Payout % is already paid', OLD.payout_id;
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER trg_payout_guard
    BEFORE UPDATE OR DELETE ON payout FOR EACH ROW EXECUTE FUNCTION fn_payout_guard();

-- Mark a payout paid. The row lock makes concurrent attempts safe:
-- the second caller waits, then sees status = 'paid' and is rejected.
CREATE OR REPLACE FUNCTION mark_payout_paid(p_payout_id INT)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_status payout_status;
BEGIN
    SELECT status INTO v_status FROM payout WHERE payout_id = p_payout_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Payout % does not exist', p_payout_id;
    END IF;
    IF v_status = 'paid' THEN
        RAISE EXCEPTION 'Payout % is already paid', p_payout_id;
    END IF;
    UPDATE payout SET status = 'paid', paid_at = now() WHERE payout_id = p_payout_id;
END $$;

-- ---------------------------------------------------------------------
-- Stored procedure: close a payout period.
--   usage_summary x platform rate x resolved splits  ->  ledger_entry
--   ledger_entry grouped by artist                   ->  payout
-- Runs as one transaction under a lock on the period row; any failure
-- (no contract, split not totalling 100%, already closed) rolls it all back.
-- ---------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE close_payout_period(p_period_id INT, p_closed_by INT DEFAULT NULL)
LANGUAGE plpgsql AS $$
DECLARE
    v_status   period_status;
    v_missing  INT;
    v_expected INT;
    v_got      INT;
BEGIN
    SELECT status INTO v_status FROM payout_period WHERE period_id = p_period_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Period % does not exist', p_period_id;
    END IF;
    IF v_status <> 'open' THEN
        RAISE EXCEPTION 'Period % is already closed', p_period_id;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM usage_summary WHERE period_id = p_period_id) THEN
        RAISE EXCEPTION 'Period % has no usage loaded', p_period_id;
    END IF;

    SELECT COUNT(DISTINCT us.track_id) INTO v_missing
    FROM usage_summary us
    WHERE us.period_id = p_period_id
      AND NOT EXISTS (SELECT 1 FROM contract c WHERE c.track_id = us.track_id AND c.status = 'active');
    IF v_missing > 0 THEN
        RAISE EXCEPTION '% track(s) have usage but no active contract', v_missing;
    END IF;

    INSERT INTO ledger_entry
           (period_id, track_id, contract_id, platform_id, artist_id,
            plays, rate_per_play, effective_pct, amount)
    SELECT us.period_id, us.track_id, c.contract_id, us.platform_id, rs.artist_id,
           us.plays, pl.rate_per_play,
           ROUND(rs.effective_pct, 6),
           ROUND(us.plays * pl.rate_per_play * rs.effective_pct / 100, 4)
    FROM   usage_summary us
    JOIN   platform pl ON pl.platform_id = us.platform_id
    JOIN   contract c  ON c.track_id = us.track_id AND c.status = 'active'
    CROSS  JOIN LATERAL resolve_split(c.contract_id) rs
    WHERE  us.period_id = p_period_id;

    SELECT COUNT(DISTINCT track_id) INTO v_expected FROM usage_summary WHERE period_id = p_period_id;
    SELECT COUNT(DISTINCT track_id) INTO v_got      FROM ledger_entry  WHERE period_id = p_period_id;
    IF v_got <> v_expected THEN
        RAISE EXCEPTION 'A contract''s splits do not resolve to 100 percent for % of % track(s)',
                        v_expected - v_got, v_expected;
    END IF;

    INSERT INTO payout (period_id, artist_id, total_amount)
    SELECT period_id, artist_id, SUM(amount)
    FROM   ledger_entry
    WHERE  period_id = p_period_id
    GROUP  BY period_id, artist_id;

    UPDATE payout_period
    SET    status = 'closed', closed_at = now(), closed_by = p_closed_by
    WHERE  period_id = p_period_id;
END $$;

-- ---------------------------------------------------------------------
-- Views
-- ---------------------------------------------------------------------
-- Who actually gets what share of each track under its active contract.
CREATE OR REPLACE VIEW v_active_split AS
SELECT c.track_id, t.title, c.contract_id, rs.artist_id, a.stage_name,
       ROUND(rs.effective_pct, 4) AS effective_pct
FROM   contract c
JOIN   track t ON t.track_id = c.track_id
CROSS  JOIN LATERAL resolve_split(c.contract_id) rs
JOIN   artist a ON a.artist_id = rs.artist_id
WHERE  c.status = 'active';

CREATE OR REPLACE VIEW v_contract_overview AS
SELECT t.track_id, t.title, c.contract_id, c.version, c.status,
       COALESCE(SUM(cs.share_pct), 0) AS total_share_pct,
       COUNT(cs.artist_id)            AS payee_count
FROM   contract c
JOIN   track t ON t.track_id = c.track_id
LEFT   JOIN contract_split cs ON cs.contract_id = c.contract_id
GROUP  BY t.track_id, t.title, c.contract_id, c.version, c.status;

-- Earnings statement lines. security_invoker makes row-level security on
-- ledger_entry apply to whoever queries the view (an artist sees only their rows).
CREATE OR REPLACE VIEW v_artist_statement WITH (security_invoker = true) AS
SELECT le.artist_id, le.period_id, pp.period_start, pp.period_end,
       t.track_id, t.title, p.code AS platform, le.plays,
       le.rate_per_play, le.effective_pct, le.amount
FROM   ledger_entry le
JOIN   payout_period pp ON pp.period_id = le.period_id
JOIN   track t          ON t.track_id   = le.track_id
JOIN   platform p       ON p.platform_id = le.platform_id;

CREATE OR REPLACE VIEW v_period_summary AS
SELECT pp.period_id, pp.period_start, pp.period_end, pp.status,
       COUNT(DISTINCT us.track_id)  AS tracks_with_usage,
       COALESCE(SUM(us.plays), 0)   AS total_plays,
       (SELECT COALESCE(SUM(po.total_amount), 0) FROM payout po
         WHERE po.period_id = pp.period_id) AS total_payable
FROM   payout_period pp
LEFT   JOIN usage_summary us ON us.period_id = pp.period_id
GROUP  BY pp.period_id, pp.period_start, pp.period_end, pp.status;

-- Full-text catalogue search.
CREATE OR REPLACE FUNCTION search_catalog(p_query TEXT)
RETURNS TABLE (kind TEXT, id INT, label TEXT, rank REAL)
LANGUAGE sql STABLE AS $$
    SELECT 'track', t.track_id, t.title,
           ts_rank(to_tsvector('simple', t.title), websearch_to_tsquery('simple', p_query))
    FROM   track t
    WHERE  to_tsvector('simple', t.title) @@ websearch_to_tsquery('simple', p_query)
    UNION ALL
    SELECT 'artist', a.artist_id, a.stage_name,
           ts_rank(to_tsvector('simple', a.stage_name), websearch_to_tsquery('simple', p_query))
    FROM   artist a
    WHERE  to_tsvector('simple', a.stage_name) @@ websearch_to_tsquery('simple', p_query)
    ORDER  BY 4 DESC;
$$;
