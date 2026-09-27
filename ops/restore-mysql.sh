#!/usr/bin/env bash
set -euo pipefail

# 비어 있는 새 앱 전용 스키마로만 복원한다. 기존 운영 DB에 자동 적용하지 않는다.
: "${DB_HOST:?DB_HOST is required}"
: "${DB_NAME:?DB_NAME is required}"
: "${DB_USERNAME:?DB_USERNAME is required}"
: "${DB_PASSWORD:?DB_PASSWORD is required}"
: "${RESTORE_FILE:?RESTORE_FILE is required}"
: "${RESTORE_TARGET_SCHEMA:?RESTORE_TARGET_SCHEMA must equal DB_NAME}"

[[ "$DB_NAME" =~ ^[A-Za-z0-9_]+$ ]] || { echo "Invalid DB_NAME" >&2; exit 2; }
[[ "$DB_HOST" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "Invalid DB_HOST" >&2; exit 2; }
[[ "${MYSQL_SSL_MODE:-REQUIRED}" =~ ^(REQUIRED|VERIFY_CA|VERIFY_IDENTITY)$ ]] || { echo "Invalid MYSQL_SSL_MODE" >&2; exit 2; }
[[ "$RESTORE_TARGET_SCHEMA" == "$DB_NAME" ]] || { echo "Restore schema mismatch" >&2; exit 2; }
[[ -f "$RESTORE_FILE" ]] || { echo "Backup file not found" >&2; exit 2; }

if [[ -f "$RESTORE_FILE.sha256" ]]; then
  (cd "$(dirname "$RESTORE_FILE")" && sha256sum --check "$(basename "$RESTORE_FILE").sha256")
fi
export MYSQL_PWD="$DB_PASSWORD"
mysql_args=(--host="$DB_HOST" --port="${DB_PORT:-3306}" --user="$DB_USERNAME" --ssl-mode="${MYSQL_SSL_MODE:-REQUIRED}")
table_count="$(mysql "${mysql_args[@]}" --batch --skip-column-names -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = '$DB_NAME'")"
[[ "$table_count" == "0" ]] || { echo "Target schema is not empty" >&2; exit 2; }
gzip -dc -- "$RESTORE_FILE" | mysql "${mysql_args[@]}" "$DB_NAME"
printf 'Restored into empty schema %s\n' "$DB_NAME"
