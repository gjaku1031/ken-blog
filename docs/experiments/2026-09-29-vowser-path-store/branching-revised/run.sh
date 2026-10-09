#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
action=${1:-}
shift || true
case "$action" in
  inputs)
    exec env PYTHONPATH="$root" python3 "$root/branching-revised/inputs.py"
    ;;
  freeze|verify)
    exec env PYTHONPATH="$root" python3 "$root/branching-revised/manifest.py" "$action"
    ;;
  smoke-base|smoke-stress|main|stress)
    cd "$root"
    exec env PYTHONPATH="$root" python3 "$root/branching-revised/orchestrate.py" "$action" "$@"
    ;;
  *)
    echo 'Usage: run.sh {inputs|freeze|verify|smoke-base|smoke-stress|main --attempt ID|stress --attempt ID}' >&2
    exit 2
    ;;
esac
