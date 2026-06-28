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

# Force-reseed control: set FORCE_RESEED=1 in Render env to re-apply the seed
# on next boot, even if the marker exists. Clear it after the next deploy.
seed_needed=0
seed_sha=""
if [ -f "$SEED_PATH" ]; then
  seed_sha=$(sha256sum "$SEED_PATH" | awk '{print $1}')
fi

if [ "${FORCE_RESEED:-}" = "1" ]; then
  seed_needed=1
  reason="FORCE_RESEED=1"
elif [ ! -f "$DB_PATH" ]; then
  seed_needed=1
  reason="no DB file"
else
  size=$(wc -c < "$DB_PATH")
  if [ "$size" -lt "$MIN_BYTES" ]; then
    seed_needed=1
    reason="DB is only $size bytes (< $MIN_BYTES)"
  elif [ -f "$MARKER" ]; then
    marker_sha=$(cat "$MARKER" 2>/dev/null || echo "")
    if [ -n "$seed_sha" ] && [ -n "$marker_sha" ] && [ "$seed_sha" != "$marker_sha" ]; then
      # Seed bundle has changed since we last applied it. Don't auto-overwrite
      # — production data may have diverged. Operator opts in via FORCE_RESEED.
      reason="seed bundle changed (marker=$marker_sha, seed=$seed_sha) — NOT auto-reseeding. Set FORCE_RESEED=1 in Render env to apply."
    else
      reason="marker matches current seed (or no checksum recorded)"
    fi
  else
    reason="DB has $size bytes and no marker — assuming real data, leaving untouched"
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
    # Record the seed's checksum so future boots can detect a new bundle.
    printf '%s' "$seed_sha" > "$MARKER"
  else
    echo "[boot] seed needed ($reason) but no seed bundle in image — server will init an empty DB"
  fi
else
  echo "[boot] skipping seed: $reason"
fi

exec node /app/dist/index.cjs
