#!/usr/bin/env bash
set -euo pipefail

# 실험 1→2→3 순차 DB lease 후에만 measure/measure-stress 실행.
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
command=${1:-}
case "$command" in
  model|smoke|smoke-stress|measure|measure-stress) ;;
  *) echo 'Usage: branching/run.sh {model|smoke|smoke-stress|measure|measure-stress} [--total N --share S --cap B --depth D]' >&2; exit 2 ;;
esac
shift
python3 "$root/branching/host_preflight.py"
cd "$root"
case "$command" in
  smoke) exec env PYTHONPATH="$root" python3 -m branching.orchestrate smoke ;;
  smoke-stress) exec env PYTHONPATH="$root" python3 -m branching.orchestrate smoke-stress ;;
  measure) exec env PYTHONPATH="$root" python3 -m branching.orchestrate main ;;
  measure-stress) exec env PYTHONPATH="$root" python3 -m branching.orchestrate stress ;;
  *) exec bash "$root/shared/run-client.sh" python -m branching.bench "$command" "$@" ;;
esac
