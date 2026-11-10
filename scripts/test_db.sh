#!/usr/bin/env bash
# Build a scratch database from sql/init and run sql/tests/test_logic.sql against it.
# Uses DATABASE_URL from .env (the docker-compose superuser, which may CREATE DATABASE
# and create the btree_gist / pgcrypto extensions). The scratch database is always dropped.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -z "${DATABASE_URL:-}" ]; then set -a; source .env; set +a; fi

BASE="${DATABASE_URL%/*}"            # postgresql://user:pass@host:port
DB="royalty_test_$$"
export PGOPTIONS="-c client_min_messages=warning"
PSQL="psql -X -v ON_ERROR_STOP=1 -q"

cleanup() { psql -X -q "$BASE/postgres" -c "DROP DATABASE IF EXISTS ${DB}" >/dev/null 2>&1 || true; }
trap cleanup EXIT

psql -X -q "$BASE/postgres" -c "CREATE DATABASE ${DB}"
for f in sql/init/*.sql; do
    echo ">> applying $f"
    $PSQL "$BASE/$DB" -f "$f" >/dev/null
done
$PSQL -o /dev/null "$BASE/$DB" -f sql/tests/test_logic.sql
