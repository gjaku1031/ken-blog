#!/usr/bin/env bash
set -euo pipefail

# Vowser 2026-09-29 실험 전용. 기존 컨테이너나 다른 실험 DB는 변경하지 않음.
work=/tmp/vowser-eval-v2
mkdir -p "$work/mysql" "$work/neo4j/data" "$work/neo4j/logs"
python3 - "$work" <<'PY'
from pathlib import Path
import secrets
import sys

work = Path(sys.argv[1])
credential = work / "credentials.env"
if not credential.exists():
    credential.write_text(f"EVAL_DB_PASSWORD={secrets.token_urlsafe(32)}\n")
credential.chmod(0o600)
key, password = credential.read_text().strip().split("=", 1)
assert key == "EVAL_DB_PASSWORD" and password
mysql_env = work / "mysql.env"
neo4j_env = work / "neo4j.env"
mysql_env.write_text(f"MYSQL_ROOT_PASSWORD={password}\nMYSQL_DATABASE=vowser_eval_v2\n")
neo4j_env.write_text(f"NEO4J_AUTH=neo4j/{password}\n")
mysql_env.chmod(0o600)
neo4j_env.chmod(0o600)
PY

if ! docker inspect vowser-eval-v2-mysql >/dev/null 2>&1; then
  docker run -d --name vowser-eval-v2-mysql --label vowser.eval=2026-09-29 \
    --label vowser.eval.role=mysql --cpus=1 --memory=3g --memory-swap=3g \
    --pids-limit=256 --publish 127.0.0.1:19506:3306 \
    --env-file "$work/mysql.env" \
    --mount type=bind,src="$work/mysql",dst=/var/lib/mysql \
    mysql:8.4.11 --innodb-buffer-pool-size=1G --max-connections=50 >/dev/null
elif [[ "$(docker inspect --format '{{.State.Running}}' vowser-eval-v2-mysql)" != true ]]; then
  docker start vowser-eval-v2-mysql >/dev/null
fi

if ! docker inspect vowser-eval-v2-neo4j >/dev/null 2>&1; then
  docker run -d --name vowser-eval-v2-neo4j --label vowser.eval=2026-09-29 \
    --label vowser.eval.role=neo4j --cpus=1 --memory=3g --memory-swap=3g \
    --pids-limit=256 --publish 127.0.0.1:19587:7687 \
    --env-file "$work/neo4j.env" \
    --env NEO4J_server_memory_heap_initial__size=1G \
    --env NEO4J_server_memory_heap_max__size=1G \
    --env NEO4J_server_memory_pagecache_size=768M \
    --mount type=bind,src="$work/neo4j/data",dst=/data \
    --mount type=bind,src="$work/neo4j/logs",dst=/logs \
    neo4j:5.26.19-community >/dev/null
elif [[ "$(docker inspect --format '{{.State.Running}}' vowser-eval-v2-neo4j)" != true ]]; then
  docker start vowser-eval-v2-neo4j >/dev/null
fi

printf 'MySQL: 127.0.0.1:19506/vowser_eval_v2\nNeo4j Bolt: bolt://127.0.0.1:19587\nCredential file: %s/credentials.env (0600)\n' "$work"
