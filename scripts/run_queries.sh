#!/usr/bin/env bash
# Run sql/demo/queries.sql against a fresh scratch database (sql/init only, i.e. the seed data)
# and save the echoed queries with their real output to sql/demo/queries_output.txt.
# The scratch database is always dropped.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -z "${DATABASE_URL:-}" ]; then set -a; source .env; set +a; fi

BASE="${DATABASE_URL%/*}"
DB="royalty_queries_$$"
export PGOPTIONS="-c client_min_messages=warning"

cleanup() { psql -X -q "$BASE/postgres" -c "DROP DATABASE IF EXISTS ${DB}" >/dev/null 2>&1 || true; }
trap cleanup EXIT

psql -X -q "$BASE/postgres" -c "CREATE DATABASE ${DB}"
for f in sql/init/*.sql; do psql -X -q -v ON_ERROR_STOP=1 "$BASE/$DB" -f "$f" >/dev/null; done
psql -X -v ON_ERROR_STOP=1 --echo-queries -P pager=off "$BASE/$DB" -f sql/demo/queries.sql > sql/demo/queries_output.txt 2>&1
echo "saved sql/demo/queries_output.txt ($(wc -l < sql/demo/queries_output.txt) lines)"
