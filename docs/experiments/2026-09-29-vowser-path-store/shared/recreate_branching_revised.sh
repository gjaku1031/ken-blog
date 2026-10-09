#!/usr/bin/env bash
set -euo pipefail

# 원본 분기 실험 종료·DB 증거 보존·전용 DB lease 반환 후에만 실행.
# 기존 결과와 shared/environment*.json은 변경하지 않는다.
[[ "${1:-}" == --confirmed-exclusive-v2-lease ]] || {
  echo 'Usage: recreate_branching_revised.sh --confirmed-exclusive-v2-lease' >&2
  exit 2
}
root=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
work=/tmp/vowser-eval-v2
revised="$root/environment-branching-revised.json"
[[ ! -e "$revised" ]] || { echo 'Revised environment snapshot already exists' >&2; exit 1; }
[[ -f "$work/credentials.env" && ! -L "$work/credentials.env" ]] || {
  echo 'Expected dedicated v2 credentials are missing' >&2; exit 1;
}
[[ "$(stat -c %a "$work/credentials.env")" == 600 ]] || {
  echo 'Dedicated v2 credentials must have mode 0600' >&2; exit 1;
}
for file in environment.json environment-before-branching.json environment-branching.json; do
  [[ -f "$root/$file" ]] || { echo "Missing preserved $file" >&2; exit 1; }
done
original_hashes=$(sha256sum "$root/environment.json" \
  "$root/environment-before-branching.json" "$root/environment-branching.json")

# 기존 분기 실험이 사용 중이면 데이터 삭제 전에 중단한다.
for name in vowser-eval-v2-br3 vowser-eval-v2-br3diag; do
  if docker inspect "$name" >/dev/null 2>&1 &&
     [[ "$(docker inspect --format '{{.State.Running}}' "$name")" == true ]]; then
    echo "Experiment worker is still running: $name" >&2
    exit 1
  fi
done
for kind in mysql neo4j; do
  name="vowser-eval-v2-$kind"
  docker inspect "$name" >/dev/null 2>&1 || { echo "Missing dedicated DB: $name" >&2; exit 1; }
  label=$(docker inspect --format '{{index .Config.Labels "vowser.eval"}}' "$name")
  role=$(docker inspect --format '{{index .Config.Labels "vowser.eval.role"}}' "$name")
  [[ "$label" == 2026-09-29 && "$role" == "$kind" ]] || {
    echo "Unexpected dedicated DB labels: $name" >&2; exit 1;
  }
  [[ "$(docker inspect --format '{{.State.Running}}' "$name")" == false ]] || {
    echo "Dedicated DB is still running: $name" >&2; exit 1;
  }
done

python3 - "$work" <<'PY'
from pathlib import Path
import sys
work = Path(sys.argv[1]).resolve()
if work != Path('/tmp/vowser-eval-v2'):
    raise RuntimeError('Unexpected dedicated v2 work directory')
for suffix in ('mysql', 'neo4j', 'neo4j/data', 'neo4j/logs'):
    target = work / suffix
    if target.is_symlink():
        raise RuntimeError(f'Unexpected symlink: {target}')
PY

for kind in mysql neo4j; do
  docker rm "vowser-eval-v2-$kind" >/dev/null
done
docker run --rm --name vowser-eval-v2-revised-reset-helper \
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

[[ "$original_hashes" == "$(sha256sum "$root/environment.json" \
  "$root/environment-before-branching.json" "$root/environment-branching.json")" ]] || {
  echo 'Original environment snapshot changed during recreation' >&2; exit 1;
}
python3 "$root/capture_branching_revised.py"
echo 'Fresh dedicated v2 DB stores and separate revised environment snapshot prepared.'
