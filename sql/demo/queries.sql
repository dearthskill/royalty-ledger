-- =====================================================================
-- Important queries (for the viva / documentation). The seed already has a
-- closed period (period 2, '2026-08'), so these return rows on a fresh database.
-- Each query is labelled with the concept it demonstrates.
-- =====================================================================

-- Q1  JOIN (4 tables): earnings statement lines for one artist
SELECT pp.label, t.title, p.name AS platform, le.plays, le.effective_pct, le.amount, le.share_path
FROM   ledger_entry le
JOIN   payout_period pp ON pp.period_id = le.period_id
JOIN   track t          ON t.track_id   = le.track_id
JOIN   platform p       ON p.code       = le.platform_code
WHERE  le.artist_id = 2
ORDER  BY pp.starts_on, t.title, p.name;

-- Q2  GROUP BY + HAVING + aggregates: artists who earned more than 100 in a period
SELECT a.name, SUM(le.amount) AS earned, COUNT(DISTINCT le.track_id) AS tracks
FROM   ledger_entry le
JOIN   artist a ON a.artist_id = le.artist_id
WHERE  le.period_id = 2
GROUP  BY a.name
HAVING SUM(le.amount) > 100
ORDER  BY earned DESC;

-- Q3  RECURSIVE CTE: expand a nested group into its solo payees with effective share
WITH RECURSIVE expand(artist_id, pct, depth, path) AS (
    SELECT cs.artist_id, cs.share_pct::NUMERIC, 0, a.name::TEXT
    FROM   contract_split cs JOIN artist a ON a.artist_id = cs.artist_id
    WHERE  cs.contract_id = 9
  UNION ALL
    SELECT gm.member_id, e.pct * gm.share_pct / 100, e.depth + 1, e.path || ' > ' || m.name
    FROM   expand e
    JOIN   artist g        ON g.artist_id = e.artist_id AND g.kind = 'group'
    JOIN   group_member gm ON gm.group_id = e.artist_id
    JOIN   artist m        ON m.artist_id = gm.member_id
)
SELECT e.path, e.depth, ROUND(e.pct, 2) AS effective_pct
FROM   expand e JOIN artist a ON a.artist_id = e.artist_id AND a.kind = 'solo'
ORDER  BY e.pct DESC;

-- Q4  Correlated subquery: each artist's top-earning track in a period
SELECT a.name, t.title, x.earned
FROM  (SELECT le.artist_id, le.track_id, SUM(le.amount) AS earned
       FROM   ledger_entry le WHERE le.period_id = 2
       GROUP  BY le.artist_id, le.track_id) x
JOIN  artist a ON a.artist_id = x.artist_id
JOIN  track  t ON t.track_id  = x.track_id
WHERE x.earned = (SELECT MAX(y.earned)
                  FROM  (SELECT SUM(l2.amount) AS earned
                         FROM   ledger_entry l2
                         WHERE  l2.period_id = 2 AND l2.artist_id = x.artist_id
                         GROUP  BY l2.track_id) y)
ORDER BY a.name;

-- Q5  Nested subquery (IN / NOT EXISTS): tracks with plays but no active contract
SELECT t.track_id, t.title
FROM   track t
WHERE  t.track_id IN (SELECT track_id FROM usage_summary)
  AND  NOT EXISTS (SELECT 1 FROM contract c WHERE c.track_id = t.track_id AND c.status = 'active');

-- Q6  Window function: each artist's share of the period's total payout
SELECT a.name, p.amount,
       ROUND(100 * p.amount / SUM(p.amount) OVER (PARTITION BY p.period_id), 2) AS pct_of_period,
       RANK() OVER (PARTITION BY p.period_id ORDER BY p.amount DESC) AS rnk
FROM   payout p JOIN artist a ON a.artist_id = p.artist_id
WHERE  p.period_id = 2;

-- Q7  Reconciliation: ledger must equal plays x rate for every CLOSED period (should return 0 rows)
SELECT us.period_id,
       SUM(us.plays * pl.rate_per_play)                              AS expected,
       (SELECT SUM(amount) FROM ledger_entry le WHERE le.period_id = us.period_id) AS booked
FROM   usage_summary us JOIN platform pl ON pl.code = us.platform_code
WHERE  us.period_id IN (SELECT period_id FROM payout_period WHERE status = 'closed')
GROUP  BY us.period_id
HAVING ABS(SUM(us.plays * pl.rate_per_play)
           - (SELECT SUM(amount) FROM ledger_entry le WHERE le.period_id = us.period_id)) > 0.01;

-- Q8  Audit history of one contract
SELECT audit_id, at, op, actor, before ->> 'status' AS old_status, after ->> 'status' AS new_status
FROM   audit_log
WHERE  table_name = 'contract' AND row_pk = '1'
ORDER  BY audit_id;

-- Q9  Full-text search + views
SELECT * FROM search_catalog('night owls');
SELECT * FROM v_active_split ORDER BY track_id, effective_pct DESC;
SELECT * FROM v_period_totals;

-- Q10 Index use check (shows the ledger lookup uses idx_ledger_artist_period)
EXPLAIN SELECT * FROM ledger_entry WHERE artist_id = 2 AND period_id = 2;

-- Concurrency demo (run in two psql sessions):
--   session A:  BEGIN; SELECT mark_payout_paid(2);          -- holds the row lock
--   session B:  SELECT mark_payout_paid(2);                  -- blocks...
--   session A:  COMMIT;                                      -- B now fails: "already paid"

-- Q11 DML: INSERT / UPDATE / DELETE with RETURNING (a scratch artist, removed again)
INSERT INTO artist (name, kind, email) VALUES ('Demo Artist', 'solo', 'demo@royalty.test')
RETURNING artist_id, name, kind, email;
UPDATE artist SET name = 'Demo Artist (renamed)' WHERE email = 'demo@royalty.test'
RETURNING artist_id, name;
DELETE FROM artist WHERE email = 'demo@royalty.test'
RETURNING artist_id, name;

-- Q12 Rules enforced by the database: each statement below is refused (errors are expected).
\set ON_ERROR_STOP off
UPDATE ledger_entry SET amount = 0 WHERE entry_id = 1;                         -- append-only ledger
INSERT INTO usage_summary VALUES (2, 4, 'spotify', 10);                         -- period 2026-08 is closed
SELECT mark_payout_paid(1);                                                     -- already paid
UPDATE contract_split SET share_pct = 50 WHERE contract_id = 9 AND artist_id = 3; -- active contract: splits frozen
UPDATE group_member SET share_pct = 59 WHERE group_id = 6 AND member_id = 2;     -- shares no longer total 100 (checked at COMMIT)
INSERT INTO payout_period (label, starts_on, ends_on) VALUES ('overlap', '2026-08-15', '2026-09-15'); -- overlaps 2026-08
\set ON_ERROR_STOP on
