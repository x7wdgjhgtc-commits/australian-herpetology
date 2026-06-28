#!/bin/sh
# One-time DB seeder. If the mounted disk is empty (no data.db, or it's a
# brand-new zero-byte file), restore from the snapshot baked into the image.
# Once /var/data/data.db exists and has content, we never touch it again.

set -e

DB_PATH="${DB_PATH:-/var/data/data.db}"
SEED_PATH="/app/seed/data.db.gz"
DB_DIR="$(dirname "$DB_PATH")"

mkdir -p "$DB_DIR"

if [ ! -s "$DB_PATH" ]; then
  if [ -f "$SEED_PATH" ]; then
    echo "[boot] $DB_PATH is empty or missing — restoring from $SEED_PATH"
    gunzip -c "$SEED_PATH" > "$DB_PATH"
    echo "[boot] restored $(wc -c < "$DB_PATH") bytes to $DB_PATH"
  else
    echo "[boot] no DB and no seed — starting with empty disk (will be initialized by server)"
  fi
else
  echo "[boot] $DB_PATH exists ($(wc -c < "$DB_PATH") bytes) — skipping seed"
fi

exec node /app/dist/index.cjs
