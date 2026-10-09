#!/usr/bin/env bash
set -euo pipefail

# 부모의 DB lease 후 장시간 사후 진단을 터미널/도구 세션과 분리해 관리.
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
results="$root/branching-diagnostic/results"
mkdir -p "$results"
state="$results/managed.state"
exec 9>"$results/managed.lock"
flock -x 9

is_live() {
  local pid=$1 ticks=$2 current
  [[ -r "/proc/$pid/stat" ]] || return 1
  current=$(awk '{print $22}' "/proc/$pid/stat")
  [[ "$current" == "$ticks" ]] && kill -0 "$pid" 2>/dev/null
}

read_state() {
  [[ -f "$state" ]] || return 1
  read -r state_pid state_group state_ticks state_log < "$state"
  [[ "$state_pid" =~ ^[0-9]+$ && "$state_ticks" =~ ^[0-9]+$ ]] || return 1
}

action=${1:-}
case "$action" in
  start)
    requested_group=${2:-}
    case "$requested_group" in main|stress) ;; *) echo 'Usage: managed.sh start {main|stress}' >&2; exit 2 ;; esac
    if read_state && is_live "$state_pid" "$state_ticks"; then
      echo "diagnostic already active: pid=$state_pid group=$state_group log=$state_log" >&2
      exit 1
    fi
    if [[ -f "$state" ]]; then
      mv "$state" "$results/managed-closed-$(date -u +%Y%m%dT%H%M%S)-${state_pid:-unknown}.state"
    fi
    stamp=$(date -u +%Y%m%dT%H%M%S)
    log="$results/managed-$requested_group-$stamp.log"
    setsid bash "$root/branching-diagnostic/run.sh" "$requested_group" --authorized-after-parent-lease \
      </dev/null >"$log" 2>&1 9>&- &
    pid=$!
    ticks=$(awk '{print $22}' "/proc/$pid/stat" 2>/dev/null || echo 0)
    printf '%s %s %s %s\n' "$pid" "$requested_group" "$ticks" "$log" > "$state"
    echo "started pid=$pid group=$requested_group log=$log state=$state"
    ;;
  status)
    if ! read_state; then
      echo 'no managed diagnostic recorded'
      exit 0
    fi
    if is_live "$state_pid" "$state_ticks"; then
      echo "running pid=$state_pid group=$state_group log=$state_log"
    else
      echo "exited pid=$state_pid group=$state_group log=$state_log"
    fi
    status="$results/$state_group-status.json"
    [[ ! -f "$status" ]] || echo "result_status=$status"
    ;;
  stop)
    requested_group=${2:-}
    if ! read_state || [[ "$requested_group" != "$state_group" ]]; then
      echo 'No matching managed diagnostic; use managed.sh status first' >&2
      exit 1
    fi
    if is_live "$state_pid" "$state_ticks"; then
      kill -TERM -- "-$state_pid"
      for _ in $(seq 1 20); do
        is_live "$state_pid" "$state_ticks" || break
        sleep 1
      done
      if is_live "$state_pid" "$state_ticks"; then
        kill -KILL -- "-$state_pid"
      fi
      # 진단 전용 worker만 종료. 다른 실험의 worker 이름은 사용하지 않는다.
      docker rm -f vowser-eval-v2-br3diag >/dev/null 2>&1 || true
      bash "$root/shared/db-control.sh" stop mysql
      bash "$root/shared/db-control.sh" stop neo4j
    fi
    echo "stopped/observed pid=$state_pid group=$state_group log=$state_log"
    ;;
  *)
    echo 'Usage: managed.sh {start GROUP|status|stop GROUP}' >&2
    exit 2
    ;;
esac
