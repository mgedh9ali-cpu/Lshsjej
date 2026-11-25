#!/usr/bin/env bash
set -euo pipefail
umask 077

: "${SCHOOL_BACKUP_DIR:?Set SCHOOL_BACKUP_DIR to the deploy/backups directory}"
: "${SCHOOL_BACKUP_AGE_RECIPIENT:?Set SCHOOL_BACKUP_AGE_RECIPIENT to the public age key}"
: "${SCHOOL_BACKUP_REMOTE:?Set SCHOOL_BACKUP_REMOTE to an rclone remote path}"

root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"
target="school-$(date -u +'%Y-%m-%dT%H%M%SZ')"
exec 9>"$SCHOOL_BACKUP_DIR/.backup.lock"
flock -n 9
compose=(docker compose --env-file .env -f deploy/compose.yaml)
plain="$SCHOOL_BACKUP_DIR/$target.sqlite"
sealed="$plain.age"
trap 'rm -f -- "$plain" "$sealed.tmp"' EXIT
"${compose[@]}" exec -T school node scripts/backup.mjs "/app/backups/$target.sqlite"
age --recipient "$SCHOOL_BACKUP_AGE_RECIPIENT" --output "$sealed.tmp" "$plain"
mv -- "$sealed.tmp" "$sealed"
rclone copyto "$sealed" "${SCHOOL_BACKUP_REMOTE%/}/$target.sqlite.age"
