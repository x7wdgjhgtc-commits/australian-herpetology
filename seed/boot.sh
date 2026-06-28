#!/bin/sh
# DB seeder for fresh persistent disks. Restores from the baked snapshot when
# either (a) the DB file is missing/empty, or (b) the file exists but holds
# fewer than MIN_BYTES (better-sqlite3 creates a 4096-byte empty file the
# moment the server opens it, so a previous boot that opened the DB and then
# failed/restarted will leave a useless ~4KB stub that our "-s" check would
# wrongly treat as populated). A marker file on the persistent disk records
# successful seed application so we never overwrite real data.

set -e

DB_PATH="${DB_PATH:-/var/data/data.db}"
SEED_PATH="/app/seed/data.db.gz"
DB_DIR="$(dirname "$DB_PATH")"
MARKER="$DB_DIR/.seeded"
# Anything smaller than this is treated as "unpopulated". The seed is ~86MB;
# 1MB is a generous floor that's still far below any real production state.
MIN_BYTES=1048576

mkdir -p "$DB_DIR"

seed_needed=0
if [ ! -f "$DB_PATH" ]; then
  seed_needed=1
  reason="no DB file"
elif [ -f "$MARKER" ]; then
  seed_needed=0
  reason="marker present"
else
  size=$(wc -c < "$DB_PATH")
  if [ "$size" -lt "$MIN_BYTES" ]; then
    seed_needed=1
    reason="DB is only $size bytes (< $MIN_BYTES)"
  else
    reason="DB has $size bytes and no marker, but is large enough — assuming real data"
  fi
fi

if [ "$seed_needed" = "1" ]; then
  if [ -f "$SEED_PATH" ]; then
    echo "[boot] seeding ($reason): restoring $DB_PATH from $SEED_PATH"
    # Remove any WAL/SHM sidecars so SQLite doesn't try to replay a stale log
    # against the freshly restored DB.
    rm -f "${DB_PATH}-wal" "${DB_PATH}-shm" "${DB_PATH}-journal"
    gunzip -c "$SEED_PATH" > "$DB_PATH"
    echo "[boot] restored $(wc -c < "$DB_PATH") bytes to $DB_PATH"
    touch "$MARKER"
  else
    echo "[boot] seed needed ($reason) but no seed bundle in image — server will init an empty DB"
  fi
else
  echo "[boot] skipping seed: $reason"
fi

exec node /app/dist/index.cjs
