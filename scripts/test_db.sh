#!/usr/bin/env bash
# Build a scratch database from sql/init and run sql/tests/test_logic.sql against it.
# Usage:  PGHOST=localhost PGPORT=5432 PGUSER=royalty PGPASSWORD=... scripts/test_db.sh
# The connecting user needs CREATEDB and must be allowed to create the
# btree_gist / pgcrypto extensions (a superuser, e.g. the docker-compose user).
set -euo pipefail
cd "$(dirname "$0")/.."

DB="royalty_test_$$"
PSQL="psql -v ON_ERROR_STOP=1 -q"

cleanup() { psql -q -d postgres -c "DROP DATABASE IF EXISTS ${DB}" >/dev/null 2>&1 || true; }
trap cleanup EXIT

psql -q -d postgres -c "CREATE DATABASE ${DB}"
for f in sql/init/*.sql; do
    echo ">> applying $f"
    $PSQL -d "${DB}" -f "$f" >/dev/null
done
$PSQL -o /dev/null -d "${DB}" -f sql/tests/test_logic.sql
