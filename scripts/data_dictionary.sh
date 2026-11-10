#!/usr/bin/env bash
# Prints the data dictionary of the public schema as Markdown, generated from
# information_schema (columns, types, nullability, defaults) and pg_constraint (keys, checks).
# Usage: scripts/data_dictionary.sh > /tmp/dd.md      (uses DATABASE_URL from .env)
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -z "${DATABASE_URL:-}" ]; then set -a; source .env; set +a; fi

psql -X -q -A -t "$DATABASE_URL" <<'SQL'
WITH cols AS (
    SELECT c.table_name, c.column_name, c.ordinal_position,
           CASE WHEN c.data_type = 'character varying' THEN 'varchar(' || c.character_maximum_length || ')'
                WHEN c.data_type = 'character'         THEN 'char(' || c.character_maximum_length || ')'
                WHEN c.data_type = 'numeric'           THEN 'numeric(' || c.numeric_precision || ',' || c.numeric_scale || ')'
                WHEN c.data_type = 'timestamp with time zone' THEN 'timestamptz'
                ELSE c.data_type END AS type,
           c.is_nullable = 'NO' AS not_null,
           CASE WHEN c.is_identity = 'YES' THEN 'identity'
                WHEN c.is_generated = 'ALWAYS' THEN 'generated'
                ELSE regexp_replace(COALESCE(c.column_default, ''), '::[a-z ]+', '', 'g') END AS dflt
    FROM   information_schema.columns c
    JOIN   information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE  c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
),
keys AS (   -- PK / FK / UNIQUE per column
    SELECT rel.relname AS table_name, att.attname AS column_name,
           string_agg(CASE con.contype
                        WHEN 'p' THEN 'PK'
                        WHEN 'u' THEN 'UNIQUE' || CASE WHEN array_length(con.conkey, 1) > 1 THEN ' (composite)' ELSE '' END
                        WHEN 'f' THEN 'FK -> ' || frel.relname
                      END, ', ' ORDER BY con.contype) AS keys
    FROM   pg_constraint con
    JOIN   pg_class rel ON rel.oid = con.conrelid
    JOIN   pg_namespace n ON n.oid = rel.relnamespace AND n.nspname = 'public'
    JOIN   pg_attribute att ON att.attrelid = rel.oid AND att.attnum = ANY (con.conkey)
    LEFT   JOIN pg_class frel ON frel.oid = con.confrelid
    WHERE  con.contype IN ('p', 'u', 'f')
    GROUP  BY rel.relname, att.attname
),
checks AS (  -- table-level CHECK and EXCLUDE constraints
    SELECT rel.relname AS table_name,
           string_agg('`' || replace(pg_get_constraintdef(con.oid), '|', '\|') || '`', '<br>' ORDER BY con.conname) AS defs
    FROM   pg_constraint con
    JOIN   pg_class rel ON rel.oid = con.conrelid
    JOIN   pg_namespace n ON n.oid = rel.relnamespace AND n.nspname = 'public'
    WHERE  con.contype IN ('c', 'x')
    GROUP  BY rel.relname
)
SELECT out FROM (
    SELECT t.table_name, 0 AS ord, 0 AS pos,
           E'\n#### ' || t.table_name || E'\n\n| Column | Type | Null | Default | Keys |\n|---|---|---|---|---|' AS out
    FROM   (SELECT DISTINCT table_name FROM cols) t
    UNION ALL
    SELECT c.table_name, 1, c.ordinal_position,
           '| ' || c.column_name || ' | ' || c.type || ' | ' || CASE WHEN c.not_null THEN 'NOT NULL' ELSE 'null' END ||
           ' | ' || COALESCE(NULLIF(c.dflt, ''), '') || ' | ' || COALESCE(k.keys, '') || ' |'
    FROM   cols c LEFT JOIN keys k USING (table_name, column_name)
    UNION ALL
    SELECT ch.table_name, 2, 0, E'\nChecks: ' || ch.defs
    FROM   checks ch
) x
ORDER BY table_name, ord, pos;
SQL
