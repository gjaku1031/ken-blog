#!/usr/bin/env bash
set -euo pipefail

# 전용 v2 실험 DB의 단계 간 격리. 부모의 lease 통지 뒤에만 실행.
[[ "${1:-}" == --confirmed-exclusive-v2-lease ]] || {
  echo 'Usage: recreate_db.sh --confirmed-exclusive-v2-lease {operations|branching}' >&2
  exit 2
}
phase=${2:-}
case "$phase" in operations|branching) ;; *) echo 'phase: operations|branching' >&2; exit 2;; esac
root=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
work=/tmp/vowser-eval-v2
[[ -f "$work/credentials.env" ]] || { echo 'Missing v2 credential file' >&2; exit 1; }
if [[ -f "$root/environment.json" && ! -f "$root/environment-before-$phase.json" ]]; then
  cp "$root/environment.json" "$root/environment-before-$phase.json"
fi
for kind in mysql neo4j; do
  name="vowser-eval-v2-$kind"
  if docker inspect "$name" >/dev/null 2>&1; then
    label=$(docker inspect --format '{{index .Config.Labels "vowser.eval"}}' "$name")
    [[ "$label" == 2026-09-29 ]] || { echo "Unexpected label on $name" >&2; exit 1; }
    docker rm -f "$name" >/dev/null
  fi
done
python3 - "$work" <<'PY'
from pathlib import Path
import sys
work = Path(sys.argv[1]).resolve()
assert work == Path('/tmp/vowser-eval-v2')
for suffix in ('mysql', 'neo4j/data', 'neo4j/logs'):
    target = work / suffix
    if target.is_symlink():
        raise RuntimeError(f'unexpected symlink: {target}')
PY
docker run --rm --name vowser-eval-v2-reset-helper \
  --label vowser.eval=2026-09-29 --network none --cpus=0.5 --memory=512m \
  --user 0:0 --entrypoint sh \
  --mount type=bind,src="$work",dst=/v2 \
  mysql:8.4.11 -c 'rm -rf -- /v2/mysql /v2/neo4j/data /v2/neo4j/logs'
bash "$root/setup.sh"
bash "$root/db-control.sh" stop neo4j
bash "$root/db-control.sh" ready mysql
bash "$root/run-client.sh" python -m operations.wait_db --backend mysql
bash "$root/db-control.sh" stop mysql
bash "$root/db-control.sh" start neo4j
bash "$root/db-control.sh" ready neo4j
bash "$root/run-client.sh" python -m operations.wait_db --backend neo4j
bash "$root/db-control.sh" stop neo4j
python3 "$root/capture_environment.py"
cp "$root/environment.json" "$root/environment-$phase.json"
echo 'Dedicated v2 DB stores recreated; credentials and worker image preserved.'
