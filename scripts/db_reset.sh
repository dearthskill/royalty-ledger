#!/usr/bin/env bash
# Rebuild BOTH databases from scratch (destroys all local data) and reseed.
# Needs docker compose and a filled-in .env. Optional: mongosh on your PATH for the Mongo seed.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a

docker compose down -v
docker compose up -d
echo "waiting for PostgreSQL..."
until docker compose exec -T postgres pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1; do sleep 1; done
sleep 3   # let the init scripts (sql/init, mongo/init) finish

if command -v mongosh >/dev/null 2>&1; then
    mongosh "$MONGODB_URI" --quiet mongo/seed/seed_events.js
else
    echo "mongosh not found - skipping Mongo demo data (run mongo/seed/seed_events.js later)"
fi
echo "done."
