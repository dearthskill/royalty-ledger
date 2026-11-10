-- =====================================================================
-- DDL demo for the viva: CREATE, ALTER (add column + constraint),
-- CREATE INDEX, DROP. Uses a scratch table, so it is safe to run on the
-- dev database at any time:
--     psql "$DATABASE_URL" -f sql/demo/ddl_demo.sql
-- =====================================================================
\set ON_ERROR_STOP on
\echo '--- CREATE TABLE with PK, FK, NOT NULL, CHECK, UNIQUE'
CREATE TABLE demo_release_note (
    note_id   INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    track_id  INT          NOT NULL REFERENCES track(track_id) ON DELETE CASCADE,
    note      VARCHAR(500) NOT NULL CHECK (length(trim(note)) > 0),
    posted_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
    UNIQUE (track_id, note)
);
\d demo_release_note

\echo '--- ALTER TABLE: add a column, then a CHECK constraint on it'
ALTER TABLE demo_release_note ADD COLUMN priority SMALLINT NOT NULL DEFAULT 3;
ALTER TABLE demo_release_note ADD CONSTRAINT demo_priority_range CHECK (priority BETWEEN 1 AND 5);

\echo '--- CREATE INDEX (composite B-tree) and show it in the plan'
CREATE INDEX idx_demo_track_priority ON demo_release_note (track_id, priority);
INSERT INTO demo_release_note (track_id, note, priority)
SELECT t.track_id, 'Remaster available for ' || t.title, 2 FROM track t;
ANALYZE demo_release_note;
SET enable_seqscan = off;   -- the table is tiny; force the planner to show the index
EXPLAIN SELECT * FROM demo_release_note WHERE track_id = 1 AND priority = 2;
RESET enable_seqscan;

\echo '--- the new constraint rejects bad data'
DO $$
BEGIN
    INSERT INTO demo_release_note (track_id, note, priority) VALUES (1, 'urgent', 9);
EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'rejected as expected: %', SQLERRM;
END $$;

\echo '--- DROP INDEX, DROP CONSTRAINT, DROP COLUMN, DROP TABLE'
DROP INDEX idx_demo_track_priority;
ALTER TABLE demo_release_note DROP CONSTRAINT demo_priority_range;
ALTER TABLE demo_release_note DROP COLUMN priority;
DROP TABLE demo_release_note;
\echo 'done: scratch table removed'
