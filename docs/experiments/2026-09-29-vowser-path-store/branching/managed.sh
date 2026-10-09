#!/usr/bin/env bash
set -euo pipefail

# 호스트 도구 세션과 분리한 실행. PID와 로그는 전용 results에 남긴다.
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
results="$root/branching/results"
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
  read -r pid group ticks log < "$state"
  [[ "$pid" =~ ^[0-9]+$ && "$ticks" =~ ^[0-9]+$ ]] || return 1
}

action=${1:-}
case "$action" in
  start)
    requested=${2:-}
    case "$requested" in
      smoke|smoke-stress|measure|measure-stress) ;;
      *) echo 'Usage: managed.sh start {smoke|smoke-stress|measure|measure-stress}' >&2; exit 2 ;;
    esac
    if read_state && is_live "$pid" "$ticks"; then
      echo "branching run already active: pid=$pid group=$group log=$log" >&2
      exit 1
    fi
    if [[ -f "$state" ]]; then
      mv "$state" "$results/managed-closed-$(date -u +%Y%m%dT%H%M%S)-${pid:-unknown}.state"
    fi
    group=$requested
    stamp=$(date -u +%Y%m%dT%H%M%S)
    log="$results/managed-$group-$stamp.log"
    setsid bash "$root/branching/run.sh" "$group" </dev/null >"$log" 2>&1 9>&- &
    pid=$!
    ticks=$(awk '{print $22}' "/proc/$pid/stat" 2>/dev/null || echo 0)
    printf '%s %s %s %s\n' "$pid" "$group" "$ticks" "$log" > "$state"
    echo "started pid=$pid group=$group log=$log state=$state"
    ;;
  status)
    if ! read_state; then
      echo 'no managed branching run recorded'
      exit 0
    fi
    if is_live "$pid" "$ticks"; then
      echo "running pid=$pid group=$group log=$log"
    else
      echo "exited pid=$pid group=$group log=$log"
    fi
    case "$group" in
      smoke) status="$results/smoke-v2-n720-s50-b4/host-status.json" ;;
      smoke-stress) status="$results/smoke-stress-n360-d100-s50-b4/host-status.json" ;;
      measure) status="$results/run-status.json" ;;
      measure-stress) status="$results/stress-run-status.json" ;;
    esac
    [[ ! -f "$status" ]] || echo "result_status=$status"
    ;;
  stop)
    requested=${2:-}
    if ! read_state || [[ "$requested" != "$group" ]]; then
      echo 'No matching managed run; use managed.sh status first' >&2
      exit 1
    fi
    if is_live "$pid" "$ticks"; then
      kill -TERM -- "-$pid"
      for _ in $(seq 1 20); do
        is_live "$pid" "$ticks" || break
        sleep 1
      done
      if is_live "$pid" "$ticks"; then
        kill -KILL -- "-$pid"
      fi
      # 강제 종료에서도 이 실험의 worker와 DB를 남기지 않는다.
      docker rm -f vowser-eval-v2-br3 >/dev/null 2>&1 || true
      bash "$root/shared/db-control.sh" stop mysql
      bash "$root/shared/db-control.sh" stop neo4j
    fi
    echo "stopped/observed pid=$pid group=$group log=$log"
    ;;
  *)
    echo 'Usage: managed.sh {start GROUP|status|stop GROUP}' >&2
    exit 2
    ;;
esac
