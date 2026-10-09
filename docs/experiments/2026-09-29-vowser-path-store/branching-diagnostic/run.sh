#!/usr/bin/env bash
set -euo pipefail

# 부모가 원래 20셀 종료와 DB lease를 명시한 뒤에만 실행.
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
group=${1:-}
case "$group" in main|stress) ;; *) echo 'Usage: run.sh {main|stress} --authorized-after-parent-lease' >&2; exit 2 ;; esac
[[ "${2:-}" == --authorized-after-parent-lease && $# -eq 2 ]] || {
  echo 'Explicit parent DB lease required' >&2
  exit 2
}
cd "$root"
export PYTHONPATH="$root"
python3 branching-diagnostic/manifest.py verify
exec python3 branching-diagnostic/host.py "$group" --authorized-after-parent-lease
