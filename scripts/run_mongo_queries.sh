#!/usr/bin/env bash
# Build a scratch MongoDB database (mongo/init + mongo/seed), run mongo/demo/usage_queries.js on it and save
# the output to mongo/demo/usage_queries_output.txt. The scratch database is always dropped; dev data is untouched.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -z "${MONGODB_URI:-}" ]; then set -a; source .env; set +a; fi
DB="royalty_events_demo_$$"
cleanup() { mongosh "$MONGODB_URI" --quiet --eval "db.getSiblingDB('${DB}').dropDatabase()" >/dev/null 2>&1 || true; }
trap cleanup EXIT

mongosh "$MONGODB_URI" --quiet --eval "var dbName = '${DB}'" mongo/init/01_init.js >/dev/null
mongosh "$MONGODB_URI" --quiet --eval "var dbName = '${DB}'" mongo/seed/seed_events.js >/dev/null
mongosh "$MONGODB_URI" --quiet --eval "var dbName = '${DB}'" mongo/demo/usage_queries.js > mongo/demo/usage_queries_output.txt
echo "saved mongo/demo/usage_queries_output.txt ($(wc -l < mongo/demo/usage_queries_output.txt) lines)"
