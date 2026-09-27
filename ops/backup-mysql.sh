#!/usr/bin/env bash
set -euo pipefail
umask 077

# 새 앱 전용 MySQL 스키마만 대상으로 한다. 기존 운영 app.env를 자동으로 읽지 않는다.
: "${DB_HOST:?DB_HOST is required}"
: "${DB_NAME:?DB_NAME is required}"
: "${DB_USERNAME:?DB_USERNAME is required}"
: "${DB_PASSWORD:?DB_PASSWORD is required}"
: "${BACKUP_DIRECTORY:?BACKUP_DIRECTORY is required}"

[[ "$DB_NAME" =~ ^[A-Za-z0-9_]+$ ]] || { echo "Invalid DB_NAME" >&2; exit 2; }
[[ "$DB_HOST" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "Invalid DB_HOST" >&2; exit 2; }
[[ "${MYSQL_SSL_MODE:-REQUIRED}" =~ ^(REQUIRED|VERIFY_CA|VERIFY_IDENTITY)$ ]] || { echo "Invalid MYSQL_SSL_MODE" >&2; exit 2; }

mkdir -p "$BACKUP_DIRECTORY"
output="$(mktemp "$BACKUP_DIRECTORY/${DB_NAME}-$(date -u +%Y%m%dT%H%M%SZ)-XXXXXX.sql.gz")"
trap 'rm -f "$output"' EXIT

export MYSQL_PWD="$DB_PASSWORD"
mysqldump \
  --host="$DB_HOST" --port="${DB_PORT:-3306}" --user="$DB_USERNAME" \
  --ssl-mode="${MYSQL_SSL_MODE:-REQUIRED}" --single-transaction --quick \
  --set-gtid-purged=OFF --no-tablespaces --hex-blob "$DB_NAME" | gzip -9 > "$output"
(cd "$(dirname "$output")" && sha256sum "$(basename "$output")" > "$(basename "$output").sha256")
trap - EXIT
printf '%s\n' "$output"
