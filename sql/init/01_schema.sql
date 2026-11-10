-- =====================================================================
-- Royalty Split & Payout Ledger : PostgreSQL schema (DDL)
-- Applied by docker-compose on first start (sql/init is mounted into
-- /docker-entrypoint-initdb.d) and by scripts/test_db.sh for tests.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS btree_gist;  -- EXCLUDE constraint: periods may not overlap
CREATE EXTENSION IF NOT EXISTS pgcrypto;    -- bcrypt password hashes for seed users

-- ---------- catalogue: who gets paid ----------
-- An artist is a payee. A 'group' (band, collective) has no money of its own:
-- its share is divided among group_member rows, which may themselves be groups.
CREATE TABLE artist (
    artist_id     INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name          VARCHAR(120) NOT NULL UNIQUE,
    kind          TEXT         NOT NULL DEFAULT 'solo' CHECK (kind IN ('solo', 'group')),
    email         VARCHAR(255) UNIQUE CHECK (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    search_vector tsvector GENERATED ALWAYS AS (to_tsvector('simple', name)) STORED
);

-- ---------- identity ----------
-- role = 'artist' exactly when the login belongs to an artist.
CREATE TABLE app_user (
    user_id       INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email         VARCHAR(255) NOT NULL UNIQUE CHECK (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
    password_hash TEXT         NOT NULL,
    role          TEXT         NOT NULL CHECK (role IN ('admin', 'artist', 'auditor')),
    artist_id     INT UNIQUE REFERENCES artist(artist_id) ON DELETE RESTRICT,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT app_user_artist_role CHECK ((role = 'artist') = (artist_id IS NOT NULL))
);

-- Shares of each group total exactly 100 (deferred trigger in 02_logic.sql);
-- membership may not form a cycle (trigger in 02_logic.sql).
CREATE TABLE group_member (
    group_id  INT          NOT NULL REFERENCES artist(artist_id) ON DELETE CASCADE,
    member_id INT          NOT NULL REFERENCES artist(artist_id) ON DELETE RESTRICT,
    share_pct NUMERIC(5,2) NOT NULL CHECK (share_pct > 0 AND share_pct <= 100),
    PRIMARY KEY (group_id, member_id),
    CONSTRAINT group_member_not_self CHECK (group_id <> member_id)
);

CREATE TABLE platform (
    code          VARCHAR(30)   PRIMARY KEY CHECK (code ~ '^[a-z_]+$'),  -- = usage_events.platform in MongoDB
    name          VARCHAR(60)   NOT NULL,
    rate_per_play NUMERIC(10,6) NOT NULL CHECK (rate_per_play > 0)
);

CREATE TABLE track (
    track_id          INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    title             VARCHAR(200) NOT NULL,
    isrc              CHAR(12)     NOT NULL UNIQUE CHECK (isrc ~ '^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$'),
    primary_artist_id INT          NOT NULL REFERENCES artist(artist_id) ON DELETE RESTRICT,
    released_on       DATE,
    search_vector     tsvector GENERATED ALWAYS AS (to_tsvector('simple', title)) STORED
);

-- ---------- contracts: versioned split agreements ----------
CREATE TABLE contract (
    contract_id  INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    track_id     INT         NOT NULL REFERENCES track(track_id) ON DELETE RESTRICT,
    version      INT         NOT NULL CHECK (version > 0),
    status       TEXT        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'superseded')),
    activated_at TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (track_id, version),
    CONSTRAINT contract_activated_at CHECK ((status = 'draft') = (activated_at IS NULL))
);
-- At most one active contract per track.
CREATE UNIQUE INDEX uq_contract_one_active ON contract (track_id) WHERE status = 'active';
-- At most one open draft per track (keeps versioning linear).
CREATE UNIQUE INDEX uq_contract_one_draft  ON contract (track_id) WHERE status = 'draft';

CREATE TABLE contract_split (
    contract_id INT          NOT NULL REFERENCES contract(contract_id) ON DELETE CASCADE,
    artist_id   INT          NOT NULL REFERENCES artist(artist_id) ON DELETE RESTRICT,
    share_pct   NUMERIC(5,2) NOT NULL CHECK (share_pct > 0 AND share_pct <= 100),
    PRIMARY KEY (contract_id, artist_id)
);

-- ---------- payout cycle ----------
CREATE TABLE payout_period (
    period_id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    label     VARCHAR(40) NOT NULL UNIQUE,
    starts_on DATE        NOT NULL,
    ends_on   DATE        NOT NULL,
    status    TEXT        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
    closed_at TIMESTAMPTZ,
    CONSTRAINT period_dates      CHECK (ends_on > starts_on),
    CONSTRAINT period_closed_at  CHECK ((status = 'closed') = (closed_at IS NOT NULL)),
    CONSTRAINT period_no_overlap EXCLUDE USING gist (daterange(starts_on, ends_on, '[]') WITH &&)
);

-- Interface table: filled from the MongoDB aggregation { track_id, platform, plays }.
CREATE TABLE usage_summary (
    period_id     INT         NOT NULL REFERENCES payout_period(period_id) ON DELETE RESTRICT,
    track_id      INT         NOT NULL REFERENCES track(track_id)          ON DELETE RESTRICT,
    platform_code VARCHAR(30) NOT NULL REFERENCES platform(code)           ON DELETE RESTRICT,
    plays         BIGINT      NOT NULL CHECK (plays >= 0),
    PRIMARY KEY (period_id, track_id, platform_code)
);

-- Append-only ledger: one row per (period, track, platform, payee, share path).
-- share_path shows how the share was reached, e.g. 'The Night Owls 80% > Nova 50%'.
CREATE TABLE ledger_entry (
    entry_id      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    period_id     INT           NOT NULL REFERENCES payout_period(period_id) ON DELETE RESTRICT,
    track_id      INT           NOT NULL REFERENCES track(track_id)          ON DELETE RESTRICT,
    contract_id   INT           NOT NULL REFERENCES contract(contract_id)    ON DELETE RESTRICT,
    artist_id     INT           NOT NULL REFERENCES artist(artist_id)        ON DELETE RESTRICT,
    platform_code VARCHAR(30)   NOT NULL REFERENCES platform(code)           ON DELETE RESTRICT,
    plays         BIGINT        NOT NULL CHECK (plays >= 0),
    effective_pct NUMERIC(9,6)  NOT NULL CHECK (effective_pct > 0 AND effective_pct <= 100),
    amount        NUMERIC(14,4) NOT NULL CHECK (amount >= 0),
    share_path    TEXT          NOT NULL,
    created_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
    UNIQUE (period_id, track_id, platform_code, artist_id, share_path)
);

-- UNIQUE (period_id, artist_id): at most one payout per artist per period.
CREATE TABLE payout (
    payout_id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    period_id INT           NOT NULL REFERENCES payout_period(period_id) ON DELETE RESTRICT,
    artist_id INT           NOT NULL REFERENCES artist(artist_id)        ON DELETE RESTRICT,
    amount    NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
    status    TEXT          NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid')),
    paid_at   TIMESTAMPTZ,
    UNIQUE (period_id, artist_id),
    CONSTRAINT payout_paid_at CHECK ((status = 'paid') = (paid_at IS NOT NULL))
);

CREATE TABLE audit_log (
    audit_id   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    table_name TEXT        NOT NULL,
    op         TEXT        NOT NULL CHECK (op IN ('INSERT', 'UPDATE', 'DELETE')),
    row_pk     TEXT        NOT NULL,
    before     JSONB,
    after      JSONB,
    actor      TEXT        NOT NULL,
    at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- indexes ----------
CREATE INDEX idx_ledger_artist_period  ON ledger_entry (artist_id, period_id);
CREATE INDEX idx_ledger_period_track   ON ledger_entry (period_id, track_id);
CREATE INDEX idx_payout_artist         ON payout (artist_id);
CREATE INDEX idx_usage_track           ON usage_summary (track_id);
CREATE INDEX idx_contract_split_artist ON contract_split (artist_id);
CREATE INDEX idx_group_member_member   ON group_member (member_id);
CREATE INDEX idx_track_primary_artist  ON track (primary_artist_id);
CREATE INDEX idx_audit_table_row       ON audit_log (table_name, row_pk, at DESC);
CREATE INDEX idx_track_search          ON track  USING GIN (search_vector);
CREATE INDEX idx_artist_search         ON artist USING GIN (search_vector);
