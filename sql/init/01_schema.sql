-- =====================================================================
-- Royalty Split & Payout Ledger : PostgreSQL schema (DDL)
-- Applied automatically by docker-compose (sql/init is mounted into
-- /docker-entrypoint-initdb.d) or manually via scripts/db_init.sh
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS btree_gist;  -- needed for the no-overlap period constraint
CREATE EXTENSION IF NOT EXISTS pgcrypto;    -- password hashing for seed users

-- ---------- enumerated types ----------
CREATE TYPE user_role       AS ENUM ('admin', 'artist', 'auditor');
CREATE TYPE artist_kind     AS ENUM ('solo', 'group');
CREATE TYPE contract_status AS ENUM ('draft', 'active', 'superseded');
CREATE TYPE period_status   AS ENUM ('open', 'closed');
CREATE TYPE payout_status   AS ENUM ('pending', 'paid', 'failed');

-- ---------- identity ----------
CREATE TABLE app_user (
    user_id       SERIAL PRIMARY KEY,
    email         VARCHAR(255) NOT NULL UNIQUE
                  CHECK (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
    password_hash TEXT         NOT NULL,
    display_name  VARCHAR(100) NOT NULL,
    role          user_role    NOT NULL,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- An artist is a payee. A 'group' artist (band, producer collective) has no
-- money of its own: its share is divided among group_member rows, which may
-- themselves be groups (nested splits, resolved with a recursive CTE).
CREATE TABLE artist (
    artist_id  SERIAL PRIMARY KEY,
    user_id    INT UNIQUE REFERENCES app_user(user_id) ON DELETE SET NULL,
    stage_name VARCHAR(120) NOT NULL UNIQUE,
    kind       artist_kind  NOT NULL DEFAULT 'solo',
    created_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE group_member (
    group_id  INT          NOT NULL REFERENCES artist(artist_id) ON DELETE CASCADE,
    member_id INT          NOT NULL REFERENCES artist(artist_id) ON DELETE RESTRICT,
    share_pct NUMERIC(5,2) NOT NULL CHECK (share_pct > 0 AND share_pct <= 100),
    PRIMARY KEY (group_id, member_id),
    CHECK (group_id <> member_id)
);

-- ---------- catalogue ----------
CREATE TABLE track (
    track_id     SERIAL PRIMARY KEY,
    isrc         CHAR(12)     NOT NULL UNIQUE
                 CHECK (isrc ~ '^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$'),
    title        VARCHAR(200) NOT NULL,
    release_date DATE,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- A contract is one versioned set of split shares for a track.
-- Only one contract per track can be 'active' (partial unique index below).
CREATE TABLE contract (
    contract_id  SERIAL PRIMARY KEY,
    track_id     INT             NOT NULL REFERENCES track(track_id) ON DELETE RESTRICT,
    version      INT             NOT NULL CHECK (version > 0),
    status       contract_status NOT NULL DEFAULT 'draft',
    created_by   INT REFERENCES app_user(user_id) ON DELETE SET NULL,
    activated_at TIMESTAMPTZ,
    created_at   TIMESTAMPTZ     NOT NULL DEFAULT now(),
    UNIQUE (track_id, version),
    CHECK ((status = 'draft') = (activated_at IS NULL))
);
CREATE UNIQUE INDEX uq_one_active_contract_per_track
    ON contract (track_id) WHERE status = 'active';

CREATE TABLE contract_split (
    contract_id INT          NOT NULL REFERENCES contract(contract_id) ON DELETE CASCADE,
    artist_id   INT          NOT NULL REFERENCES artist(artist_id) ON DELETE RESTRICT,
    share_pct   NUMERIC(5,2) NOT NULL CHECK (share_pct > 0 AND share_pct <= 100),
    PRIMARY KEY (contract_id, artist_id)
);

CREATE TABLE platform (
    platform_id   SERIAL PRIMARY KEY,
    code          VARCHAR(30)   NOT NULL UNIQUE CHECK (code ~ '^[a-z_]+$'),  -- matches usage_events.platform in MongoDB
    display_name  VARCHAR(60)   NOT NULL,
    rate_per_play NUMERIC(10,6) NOT NULL CHECK (rate_per_play > 0)
);

-- ---------- payout cycle ----------
CREATE TABLE payout_period (
    period_id    SERIAL PRIMARY KEY,
    period_start DATE          NOT NULL,
    period_end   DATE          NOT NULL,
    status       period_status NOT NULL DEFAULT 'open',
    closed_at    TIMESTAMPTZ,
    closed_by    INT REFERENCES app_user(user_id) ON DELETE SET NULL,
    CHECK (period_end >= period_start),
    CHECK ((status = 'closed') = (closed_at IS NOT NULL)),
    EXCLUDE USING gist (daterange(period_start, period_end, '[]') WITH &&)
);

-- Interface table: rows are loaded from the MongoDB aggregation pipeline
-- (mongo/pipelines/aggregate_usage.js) before a period is closed.
CREATE TABLE usage_summary (
    period_id   INT    NOT NULL REFERENCES payout_period(period_id) ON DELETE CASCADE,
    track_id    INT    NOT NULL REFERENCES track(track_id)          ON DELETE RESTRICT,
    platform_id INT    NOT NULL REFERENCES platform(platform_id)    ON DELETE RESTRICT,
    plays       BIGINT NOT NULL CHECK (plays >= 0),
    loaded_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (period_id, track_id, platform_id)
);

-- Append-only ledger: one row per (period, track, platform, beneficiary).
CREATE TABLE ledger_entry (
    entry_id      BIGSERIAL PRIMARY KEY,
    period_id     INT           NOT NULL REFERENCES payout_period(period_id) ON DELETE RESTRICT,
    track_id      INT           NOT NULL REFERENCES track(track_id)          ON DELETE RESTRICT,
    contract_id   INT           NOT NULL REFERENCES contract(contract_id)    ON DELETE RESTRICT,
    platform_id   INT           NOT NULL REFERENCES platform(platform_id)    ON DELETE RESTRICT,
    artist_id     INT           NOT NULL REFERENCES artist(artist_id)        ON DELETE RESTRICT,
    plays         BIGINT        NOT NULL CHECK (plays >= 0),
    rate_per_play NUMERIC(10,6) NOT NULL CHECK (rate_per_play > 0),
    effective_pct NUMERIC(9,6)  NOT NULL CHECK (effective_pct > 0 AND effective_pct <= 100),
    amount        NUMERIC(14,4) NOT NULL CHECK (amount >= 0),
    created_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
    UNIQUE (period_id, track_id, platform_id, artist_id)
);

-- UNIQUE (period_id, artist_id) is what prevents paying anyone twice for a period.
CREATE TABLE payout (
    payout_id    SERIAL PRIMARY KEY,
    period_id    INT           NOT NULL REFERENCES payout_period(period_id) ON DELETE RESTRICT,
    artist_id    INT           NOT NULL REFERENCES artist(artist_id)        ON DELETE RESTRICT,
    total_amount NUMERIC(14,4) NOT NULL CHECK (total_amount >= 0),
    status       payout_status NOT NULL DEFAULT 'pending',
    paid_at      TIMESTAMPTZ,
    UNIQUE (period_id, artist_id),
    CHECK ((status = 'paid') = (paid_at IS NOT NULL))
);

CREATE TABLE audit_log (
    audit_id   BIGSERIAL PRIMARY KEY,
    table_name TEXT        NOT NULL,
    row_pk     TEXT        NOT NULL,
    action     TEXT        NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
    old_data   JSONB,
    new_data   JSONB,
    changed_by TEXT        NOT NULL,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- indexes ----------
CREATE INDEX idx_ledger_artist_period ON ledger_entry (artist_id, period_id);
CREATE INDEX idx_ledger_period_track  ON ledger_entry (period_id, track_id);
CREATE INDEX idx_usage_track          ON usage_summary (track_id);
CREATE INDEX idx_contract_split_artist ON contract_split (artist_id);
CREATE INDEX idx_group_member_member  ON group_member (member_id);
CREATE INDEX idx_audit_table_row      ON audit_log (table_name, row_pk, changed_at DESC);
-- full-text search over the catalogue
CREATE INDEX idx_track_title_fts  ON track  USING GIN (to_tsvector('simple', title));
CREATE INDEX idx_artist_name_fts  ON artist USING GIN (to_tsvector('simple', stage_name));
