#!/usr/bin/env bash
# Rebuild BOTH databases from scratch (destroys all local data) and reseed.
# Needs docker compose, psql, mongosh and a filled-in .env.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a

docker compose down -v
docker compose up -d --wait
# The containers report healthy while their init scripts still run on a temporary local server,
# so wait until the seeded data is reachable over the published ports.
echo "waiting for sql/init to finish..."
until psql -X -q "$DATABASE_URL" -c 'SELECT 1 FROM payout_period LIMIT 1' >/dev/null 2>&1; do sleep 1; done
echo "waiting for mongo/init to finish..."
until mongosh "$MONGODB_URI" --quiet --eval \
    'quit(db.getSiblingDB("royalty_events").getCollectionNames().includes("usage_events") ? 0 : 1)' >/dev/null 2>&1; do sleep 1; done

mongosh "$MONGODB_URI" --quiet mongo/seed/seed_events.js
echo "done."
