#!/usr/bin/env bash
set -euo pipefail

# 한 블록만 실행한다. 전체 순서(Neo→SQL, SQL→Neo, Neo→SQL)는 실행자가 통제.
action=${1:-}
backend=${2:-}
scale=${3:-}
mix=${4:-90:10}
round=${5:-0}
distribution=${6:-uniform}
case "$action" in prepare|smoke|round) ;; *) echo 'action: prepare|smoke|round' >&2; exit 2;; esac
case "$backend" in mysql) other=neo4j;; neo4j) other=mysql;; *) echo 'backend: mysql|neo4j' >&2; exit 2;; esac
case "$scale" in 1000|10000|30000) ;; *) echo 'scale: 1000|10000|30000' >&2; exit 2;; esac
case "$mix" in 90:10|50:50) ;; *) echo 'mix: 90:10|50:50' >&2; exit 2;; esac
case "$round" in 0|1|2) ;; *) echo 'round: 0|1|2' >&2; exit 2;; esac
case "$distribution" in uniform|skew) ;; *) echo 'distribution: uniform|skew' >&2; exit 2;; esac

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
case_dir="$root/operations/runs"
mkdir -p "$case_dir"
stem="$action-$distribution-$scale-${mix/:/_}-$backend-r$round"
log="$case_dir/$stem.log"

# 같은 대상도 매 블록 재시작. Bolt TCP 후 인증 질의까지 준비를 확인.
bash "$root/shared/db-control.sh" stop "$other"
bash "$root/shared/db-control.sh" stop "$backend"
bash "$root/shared/db-control.sh" start "$backend"
bash "$root/shared/db-control.sh" ready "$backend" | tee -a "$log"
bash "$root/shared/run-client.sh" python -m operations.wait_db --backend "$backend" | tee -a "$log"
if [[ "$action" == round ]]; then
  python3 "$root/operations/host_state.py" --backend "$backend" \
    --output "$case_dir/$stem-host-before.json"
fi

case "$action" in
  prepare)
    limit=660
    args=(prepare --backend "$backend" --scale "$scale" --distribution "$distribution")
    ;;
  smoke)
    limit=240
    args=(smoke --backend "$backend" --scale "$scale" --distribution "$distribution")
    ;;
  round)
    limit=240
    args=(round --backend "$backend" --scale "$scale" --mix "$mix" \
      --round "$round" --distribution "$distribution")
    ;;
esac
set +e
timeout --signal=TERM --kill-after=10s "${limit}s" \
  bash "$root/shared/run-client.sh" python -m operations.runner "${args[@]}" \
  2>&1 | tee -a "$log"
status=${PIPESTATUS[0]}
set -e
if [[ "$action" == round ]]; then
  python3 "$root/operations/host_state.py" --backend "$backend" \
    --output "$case_dir/$stem-host-after.json"
fi
printf '%s exit_code=%s\n' "$stem" "$status" | tee -a "$log"
printf '%s\n' "$status" > "$case_dir/$stem.exit"
exit "$status"
