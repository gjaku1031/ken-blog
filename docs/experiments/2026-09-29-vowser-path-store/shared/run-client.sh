#!/usr/bin/env bash
set -euo pipefail

# 모든 실험에서 동일한 1 CPU/1 GiB Python 클라이언트 예산 사용.
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
credential=/tmp/vowser-eval-v2/credentials.env
test -f "$credential"
name_args=()
if [[ -n "${EVAL_CLIENT_NAME:-}" ]]; then
  [[ "$EVAL_CLIENT_NAME" =~ ^[a-z0-9][a-z0-9_-]*$ ]] || { echo 'Invalid EVAL_CLIENT_NAME' >&2; exit 2; }
  name_args=(--name "vowser-eval-v2-${EVAL_CLIENT_NAME}")
fi
docker run --rm "${name_args[@]}" --label vowser.eval=2026-09-29 \
  --label vowser.eval.role=client --network host --cpus=1 --memory=1g --memory-swap=1g \
  --pids-limit=256 --user "$(id -u):$(id -g)" \
  --mount type=bind,src="$root",dst=/work \
  --mount type=bind,src="$credential",dst=/run/secrets/credentials.env,readonly \
  --env PYTHONPATH=/work \
  --env EVAL_CREDENTIALS_PATH=/run/secrets/credentials.env \
  --env OMP_NUM_THREADS=1 --env OPENBLAS_NUM_THREADS=1 --env MKL_NUM_THREADS=1 \
  --workdir /work vowser-eval-v2-client:py312 "$@"
