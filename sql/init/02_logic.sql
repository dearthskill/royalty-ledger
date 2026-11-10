-- =====================================================================
-- Business logic: triggers, functions, the period-close procedure, views.
-- Every business error is RAISE EXCEPTION with a readable message (SQLSTATE
-- P0001); the app shows that text to the user unchanged.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Split resolution (recursive CTE)
-- Expands a contract's splits through nested groups, multiplying shares on
-- the way down, and returns one row per path that ends at a solo artist.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION resolve_contract_split(p_contract_id INT)
RETURNS TABLE (artist_id INT, effective_pct NUMERIC, path TEXT)
LANGUAGE sql STABLE AS $$
    WITH RECURSIVE expand(a_id, pct, path, depth) AS (
        SELECT cs.artist_id, cs.share_pct::NUMERIC,
               a.name || ' ' || trim_scale(cs.share_pct) || '%', 0
        FROM   contract_split cs
        JOIN   artist a ON a.artist_id = cs.artist_id
        WHERE  cs.contract_id = p_contract_id
      UNION ALL
        SELECT gm.member_id, e.pct * gm.share_pct / 100,
               e.path || ' > ' || m.name || ' ' || trim_scale(gm.share_pct) || '%', e.depth + 1
        FROM   expand e
        JOIN   group_member gm ON gm.group_id = e.a_id
        JOIN   artist m        ON m.artist_id = gm.member_id
        WHERE  e.depth < 16                       -- cycles are blocked by a trigger; this is a safety net
    )
    SELECT e.a_id, e.pct, e.path
    FROM   expand e
    JOIN   artist a ON a.artist_id = e.a_id AND a.kind = 'solo'
    ORDER  BY e.pct DESC, e.path;
$$;

-- The effective split of a track under its ACTIVE contract. Raises if there is
-- no active contract or the leaves do not add up to 100 (e.g. an empty group).
CREATE OR REPLACE FUNCTION resolve_split(p_track_id INT)
RETURNS TABLE (artist_id INT, effective_pct NUMERIC, path TEXT)
LANGUAGE plpgsql STABLE AS $$
DECLARE
    v_contract INT;
    v_total    NUMERIC;
BEGIN
    SELECT c.contract_id INTO v_contract
    FROM   contract c WHERE c.track_id = p_track_id AND c.status = 'active';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Track % has no active contract', p_track_id;
    END IF;

    SELECT COALESCE(SUM(r.effective_pct), 0) INTO v_total FROM resolve_contract_split(v_contract) r;
    IF abs(v_total - 100) > 0.0001 THEN
        RAISE EXCEPTION 'Split of track % resolves to % percent, not 100 (does every group have members?)',
                        p_track_id, round(v_total, 4);
    END IF;

    RETURN QUERY SELECT r.artist_id, r.effective_pct, r.path FROM resolve_contract_split(v_contract) r;
END $$;

-- ---------------------------------------------------------------------
-- Generic audit trigger. TG_ARGV lists the primary-key column(s).
-- actor = e-mail of app.user_id (set by the app per transaction), else the DB role.
-- SECURITY DEFINER so the insert works whatever app role is active.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_audit() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_row   jsonb := to_jsonb(CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END);
    v_pk    TEXT  := '';
    v_col   TEXT;
    v_actor TEXT;
BEGIN
    FOREACH v_col IN ARRAY TG_ARGV LOOP
        v_pk := v_pk || CASE WHEN v_pk = '' THEN '' ELSE '/' END || COALESCE(v_row ->> v_col, '');
    END LOOP;

    SELECT u.email INTO v_actor
    FROM   app_user u
    WHERE  u.user_id::TEXT = NULLIF(current_setting('app.user_id', true), '');

    INSERT INTO audit_log (table_name, op, row_pk, before, after, actor)
    VALUES (TG_TABLE_NAME, TG_OP, v_pk,
            CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END,
            CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END,
            COALESCE(v_actor, current_user));
    RETURN NULL;
END $$;

CREATE TRIGGER trg_audit_contract       AFTER INSERT OR UPDATE OR DELETE ON contract       FOR EACH ROW EXECUTE FUNCTION fn_audit('contract_id');
CREATE TRIGGER trg_audit_contract_split AFTER INSERT OR UPDATE OR DELETE ON contract_split FOR EACH ROW EXECUTE FUNCTION fn_audit('contract_id', 'artist_id');
CREATE TRIGGER trg_audit_group_member   AFTER INSERT OR UPDATE OR DELETE ON group_member   FOR EACH ROW EXECUTE FUNCTION fn_audit('group_id', 'member_id');
CREATE TRIGGER trg_audit_payout_period  AFTER INSERT OR UPDATE OR DELETE ON payout_period  FOR EACH ROW EXECUTE FUNCTION fn_audit('period_id');
CREATE TRIGGER trg_audit_payout         AFTER INSERT OR UPDATE OR DELETE ON payout         FOR EACH ROW EXECUTE FUNCTION fn_audit('payout_id');

-- ---------------------------------------------------------------------
-- Groups: members must belong to a group artist, may not form a cycle, and
-- their shares must total exactly 100 (checked at COMMIT, so a whole set
-- can be replaced row by row inside one transaction).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_group_member_guard() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE v_group_name TEXT;
BEGIN
    SELECT name INTO v_group_name FROM artist WHERE artist_id = NEW.group_id AND kind = 'group';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Artist % is not a group, so it cannot have members', NEW.group_id;
    END IF;
    -- walk down from the new member; reaching the group again means a cycle
    IF EXISTS (
        WITH RECURSIVE down(a_id) AS (
            SELECT NEW.member_id
          UNION
            SELECT gm.member_id FROM group_member gm JOIN down d ON gm.group_id = d.a_id
        )
        SELECT 1 FROM down WHERE a_id = NEW.group_id
    ) THEN
        RAISE EXCEPTION 'Adding artist % to group "%" would create a membership cycle', NEW.member_id, v_group_name;
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
        FROM   group_member WHERE group_id = v_group;
        -- a group with no members left is allowed (e.g. while being deleted)
        IF v_cnt > 0 AND v_sum <> 100 THEN
            RAISE EXCEPTION 'Member shares of group % total % percent, must be exactly 100', v_group, trim_scale(v_sum);
        END IF;
    END LOOP;
    RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER trg_group_member_sum
    AFTER INSERT OR UPDATE OR DELETE ON group_member
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION fn_group_member_sum();

-- ---------------------------------------------------------------------
-- Contracts: only drafts change. Activation needs exactly 100%.
-- Superseded contracts are final; drafts are the only ones that can be deleted.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_contract_guard() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE v_total NUMERIC;
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.status <> 'draft' THEN
            RAISE EXCEPTION 'Only draft contracts can be deleted (contract % is %)', OLD.contract_id, OLD.status;
        END IF;
        RETURN OLD;
    END IF;

    IF NEW.track_id <> OLD.track_id OR NEW.version <> OLD.version THEN
        RAISE EXCEPTION 'Track and version of a contract cannot be changed';
    END IF;
    IF OLD.status = 'superseded' THEN
        RAISE EXCEPTION 'Contract % is superseded and cannot be changed', OLD.contract_id;
    END IF;
    IF OLD.status = 'active' AND NEW.status NOT IN ('active', 'superseded') THEN
        RAISE EXCEPTION 'An active contract can only be superseded';
    END IF;
    IF OLD.status = 'draft' AND NEW.status = 'superseded' THEN
        RAISE EXCEPTION 'A draft contract cannot be superseded; delete it instead';
    END IF;
    IF OLD.status = 'draft' AND NEW.status = 'active' THEN
        SELECT COALESCE(SUM(share_pct), 0) INTO v_total FROM contract_split WHERE contract_id = NEW.contract_id;
        IF v_total <> 100 THEN
            RAISE EXCEPTION 'Splits of contract % total % percent, must be exactly 100', NEW.contract_id, trim_scale(v_total);
        END IF;
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER trg_contract_guard
    BEFORE UPDATE OR DELETE ON contract FOR EACH ROW EXECUTE FUNCTION fn_contract_guard();

-- Splits are editable only while their contract is a draft.
CREATE OR REPLACE FUNCTION fn_contract_split_draft_only() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
    v_contract INT;
    v_status   TEXT;
BEGIN
    FOREACH v_contract IN ARRAY ARRAY[
        CASE WHEN TG_OP <> 'INSERT' THEN OLD.contract_id END,
        CASE WHEN TG_OP <> 'DELETE' THEN NEW.contract_id END]
    LOOP
        CONTINUE WHEN v_contract IS NULL;
        SELECT status INTO v_status FROM contract WHERE contract_id = v_contract;
        -- v_status is NULL when the contract row itself is being deleted (cascade from a draft)
        IF v_status IS NOT NULL AND v_status <> 'draft' THEN
            RAISE EXCEPTION 'Contract % is %; splits can only be edited on a draft', v_contract, v_status;
        END IF;
    END LOOP;
    RETURN COALESCE(NEW, OLD);
END $$;

CREATE TRIGGER trg_contract_split_draft_only
    BEFORE INSERT OR UPDATE OR DELETE ON contract_split
    FOR EACH ROW EXECUTE FUNCTION fn_contract_split_draft_only();

-- New draft = next version, pre-filled with the current active splits.
CREATE OR REPLACE FUNCTION create_contract_draft(p_track_id INT)
RETURNS INT LANGUAGE plpgsql AS $$
DECLARE
    v_id     INT;
    v_active INT;
    v_draft  INT;
BEGIN
    PERFORM 1 FROM track WHERE track_id = p_track_id FOR UPDATE;   -- serialise drafts per track
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Track % does not exist', p_track_id;
    END IF;
    SELECT version INTO v_draft FROM contract WHERE track_id = p_track_id AND status = 'draft';
    IF FOUND THEN
        RAISE EXCEPTION 'Track % already has a draft contract (version %)', p_track_id, v_draft;
    END IF;

    INSERT INTO contract (track_id, version)
    SELECT p_track_id, COALESCE(MAX(version), 0) + 1 FROM contract WHERE track_id = p_track_id
    RETURNING contract_id INTO v_id;

    SELECT contract_id INTO v_active FROM contract WHERE track_id = p_track_id AND status = 'active';
    INSERT INTO contract_split (contract_id, artist_id, share_pct)
    SELECT v_id, artist_id, share_pct FROM contract_split WHERE contract_id = v_active;
    RETURN v_id;
END $$;

-- Activate a draft and supersede the old active contract, in one transaction.
CREATE OR REPLACE FUNCTION activate_contract(p_contract_id INT)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
    v_track  INT;
    v_status TEXT;
    v_total  NUMERIC;
BEGIN
    SELECT track_id, status INTO v_track, v_status FROM contract WHERE contract_id = p_contract_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Contract % does not exist', p_contract_id;
    END IF;
    IF v_status <> 'draft' THEN
        RAISE EXCEPTION 'Contract % is %; only a draft can be activated', p_contract_id, v_status;
    END IF;
    SELECT COALESCE(SUM(share_pct), 0) INTO v_total FROM contract_split WHERE contract_id = p_contract_id;
    IF v_total <> 100 THEN
        RAISE EXCEPTION 'Splits of contract % total % percent, must be exactly 100', p_contract_id, trim_scale(v_total);
    END IF;

    UPDATE contract SET status = 'superseded' WHERE track_id = v_track AND status = 'active';
    UPDATE contract SET status = 'active', activated_at = now() WHERE contract_id = p_contract_id;
END $$;

-- ---------------------------------------------------------------------
-- Periods, usage, ledger, payouts: history is never rewritten.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_period_guard() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.status = 'closed' THEN
        RAISE EXCEPTION 'Period % is closed and cannot be changed', OLD.label;
    END IF;
    RETURN COALESCE(NEW, OLD);
END $$;

CREATE TRIGGER trg_period_guard
    BEFORE UPDATE OR DELETE ON payout_period FOR EACH ROW EXECUTE FUNCTION fn_period_guard();

CREATE OR REPLACE FUNCTION fn_usage_period_open() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
    v_status TEXT;
    v_label  TEXT;
BEGIN
    SELECT status, label INTO v_status, v_label FROM payout_period
    WHERE  period_id = CASE WHEN TG_OP = 'DELETE' THEN OLD.period_id ELSE NEW.period_id END;
    IF v_status = 'closed' THEN
        RAISE EXCEPTION 'Usage of closed period % cannot be changed', v_label;
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.period_id <> NEW.period_id THEN
        SELECT status, label INTO v_status, v_label FROM payout_period WHERE period_id = OLD.period_id;
        IF v_status = 'closed' THEN
            RAISE EXCEPTION 'Usage of closed period % cannot be changed', v_label;
        END IF;
    END IF;
    RETURN COALESCE(NEW, OLD);
END $$;

CREATE TRIGGER trg_usage_period_open
    BEFORE INSERT OR UPDATE OR DELETE ON usage_summary
    FOR EACH ROW EXECUTE FUNCTION fn_usage_period_open();

CREATE OR REPLACE FUNCTION fn_ledger_append_only() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'ledger_entry is append-only: % is not allowed', TG_OP;
END $$;

CREATE TRIGGER trg_ledger_append_only
    BEFORE UPDATE OR DELETE ON ledger_entry FOR EACH ROW EXECUTE FUNCTION fn_ledger_append_only();

-- Payouts are never deleted; only pending -> paid may change.
CREATE OR REPLACE FUNCTION fn_payout_guard() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Payouts cannot be deleted';
    END IF;
    IF OLD.status = 'paid' THEN
        RAISE EXCEPTION 'Payout % is already paid', OLD.payout_id;
    END IF;
    IF NEW.period_id <> OLD.period_id OR NEW.artist_id <> OLD.artist_id OR NEW.amount <> OLD.amount THEN
        RAISE EXCEPTION 'Only the status of a payout can change';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER trg_payout_guard
    BEFORE UPDATE OR DELETE ON payout FOR EACH ROW EXECUTE FUNCTION fn_payout_guard();

-- Pay once. FOR UPDATE makes a concurrent second call wait, then see 'paid' and fail.
CREATE OR REPLACE FUNCTION mark_payout_paid(p_payout_id INT)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_status TEXT;
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
-- Stored procedure: close a payout period (one transaction).
--   usage_summary x platform rate x resolved split -> ledger_entry
--   ledger_entry summed per artist                  -> payout
-- Any error (already closed, no usage, missing contract, bad split) rolls everything back.
-- ---------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE close_payout_period(p_period_id INT)
LANGUAGE plpgsql AS $$
DECLARE
    v_status  TEXT;
    v_label   TEXT;
    v_missing TEXT;
BEGIN
    SELECT status, label INTO v_status, v_label FROM payout_period WHERE period_id = p_period_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Period % does not exist', p_period_id;
    END IF;
    IF v_status <> 'open' THEN
        RAISE EXCEPTION 'Period % is already closed', v_label;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM usage_summary WHERE period_id = p_period_id) THEN
        RAISE EXCEPTION 'Period % has no usage loaded; aggregate usage first', v_label;
    END IF;

    SELECT string_agg(DISTINCT t.title, ', ') INTO v_missing
    FROM   usage_summary us JOIN track t ON t.track_id = us.track_id
    WHERE  us.period_id = p_period_id
      AND  NOT EXISTS (SELECT 1 FROM contract c WHERE c.track_id = us.track_id AND c.status = 'active');
    IF v_missing IS NOT NULL THEN
        RAISE EXCEPTION 'Cannot close period %: no active contract for %', v_label, v_missing;
    END IF;

    INSERT INTO ledger_entry (period_id, track_id, contract_id, artist_id, platform_code,
                              plays, effective_pct, amount, share_path)
    SELECT us.period_id, us.track_id, c.contract_id, rs.artist_id, us.platform_code,
           us.plays, round(rs.effective_pct, 6),
           round(us.plays * pl.rate_per_play * rs.effective_pct / 100, 4),
           rs.path
    FROM   usage_summary us
    JOIN   platform pl ON pl.code = us.platform_code
    JOIN   contract c  ON c.track_id = us.track_id AND c.status = 'active'
    CROSS  JOIN LATERAL resolve_split(us.track_id) rs
    WHERE  us.period_id = p_period_id;

    INSERT INTO payout (period_id, artist_id, amount)
    SELECT period_id, artist_id, round(SUM(amount), 2)
    FROM   ledger_entry
    WHERE  period_id = p_period_id
    GROUP  BY period_id, artist_id;

    UPDATE payout_period SET status = 'closed', closed_at = now() WHERE period_id = p_period_id;
END $$;

-- ---------------------------------------------------------------------
-- Full-text catalogue search (prefix match on every word, ranked).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION search_catalog(p_query TEXT)
RETURNS TABLE (kind TEXT, id INT, label TEXT, rank REAL)
LANGUAGE plpgsql STABLE AS $$
DECLARE v_tsq tsquery;
BEGIN
    -- 'night ow' -> 'night:* & ow:*'  (punctuation stripped, so user input cannot break the query)
    SELECT to_tsquery('simple', string_agg(w || ':*', ' & ')) INTO v_tsq
    FROM   regexp_split_to_table(trim(regexp_replace(lower(COALESCE(p_query, '')), '[^[:alnum:]]+', ' ', 'g')), ' ') w
    WHERE  w <> '';
    IF v_tsq IS NULL THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT * FROM (
        SELECT 'track'::TEXT, t.track_id, t.title::TEXT, ts_rank(t.search_vector, v_tsq)
        FROM   track t WHERE t.search_vector @@ v_tsq
        UNION ALL
        SELECT 'artist'::TEXT, a.artist_id, a.name::TEXT, ts_rank(a.search_vector, v_tsq)
        FROM   artist a WHERE a.search_vector @@ v_tsq
    ) r(kind, id, label, rank)
    ORDER  BY r.rank DESC, r.label;
END $$;

-- ---------------------------------------------------------------------
-- Views. security_invoker = true makes RLS on the base tables apply to whoever
-- queries the view (an artist sees only their own statement lines).
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW v_active_split WITH (security_invoker = true) AS
SELECT c.track_id, t.title, c.contract_id, c.version,
       rs.artist_id, a.name AS artist_name, round(rs.effective_pct, 4) AS effective_pct, rs.path AS share_path
FROM   contract c
JOIN   track t ON t.track_id = c.track_id
CROSS  JOIN LATERAL resolve_contract_split(c.contract_id) rs
JOIN   artist a ON a.artist_id = rs.artist_id
WHERE  c.status = 'active';

CREATE OR REPLACE VIEW v_contract_overview WITH (security_invoker = true) AS
SELECT t.track_id, t.title, c.contract_id, c.version, c.status, c.activated_at, c.created_at,
       COALESCE(SUM(cs.share_pct), 0) AS total_share_pct,
       COUNT(cs.artist_id)            AS payee_count
FROM   contract c
JOIN   track t ON t.track_id = c.track_id
LEFT   JOIN contract_split cs ON cs.contract_id = c.contract_id
GROUP  BY t.track_id, t.title, c.contract_id, c.version, c.status, c.activated_at, c.created_at;

CREATE OR REPLACE VIEW v_artist_statement WITH (security_invoker = true) AS
SELECT le.artist_id, a.name AS artist_name, le.period_id, pp.label AS period_label,
       le.track_id, t.title, le.platform_code, le.plays, le.effective_pct, le.amount, le.share_path
FROM   ledger_entry le
JOIN   artist a         ON a.artist_id  = le.artist_id
JOIN   payout_period pp ON pp.period_id = le.period_id
JOIN   track t          ON t.track_id   = le.track_id;

CREATE OR REPLACE VIEW v_period_totals WITH (security_invoker = true) AS
SELECT pp.period_id, pp.label, pp.starts_on, pp.ends_on, pp.status, pp.closed_at,
       (SELECT COUNT(DISTINCT us.track_id) FROM usage_summary us WHERE us.period_id = pp.period_id) AS tracks_with_usage,
       (SELECT COALESCE(SUM(us.plays), 0)  FROM usage_summary us WHERE us.period_id = pp.period_id) AS total_plays,
       (SELECT COALESCE(SUM(le.amount), 0) FROM ledger_entry le  WHERE le.period_id = pp.period_id) AS ledger_total,
       (SELECT COALESCE(SUM(po.amount), 0) FROM payout po        WHERE po.period_id = pp.period_id) AS payout_total,
       (SELECT COUNT(*) FROM payout po WHERE po.period_id = pp.period_id AND po.status = 'paid')     AS payouts_paid,
       (SELECT COUNT(*) FROM payout po WHERE po.period_id = pp.period_id)                           AS payouts_total
FROM   payout_period pp;
