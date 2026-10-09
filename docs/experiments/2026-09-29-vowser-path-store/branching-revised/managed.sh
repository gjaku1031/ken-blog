#!/usr/bin/env bash
set -euo pipefail

# 한 그룹/attempt만 관리: 호스트 도구 세션의 종료와 DB 실험 수명을 분리.
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
results="$root/branching-revised/results"
mkdir -p "$results"
state="$results/managed.state"
exec 9>"$results/managed.lock"
flock -x 9

live_state() {
  local file=$1 current
  [[ -f "$file" ]] || return 1
  read -r pid group ticks log < "$file"
  [[ "$pid" =~ ^[0-9]+$ && "$ticks" =~ ^[0-9]+$ ]] || return 1
  [[ -r "/proc/$pid/stat" ]] || return 1
  current=$(awk '{print $22}' "/proc/$pid/stat")
  [[ "$current" == "$ticks" ]] && kill -0 "$pid" 2>/dev/null
}

action=${1:-}
case "$action" in
  start)
    requested_group=${2:-}
    attempt=${3:-}
    case "$requested_group" in
      smoke-base|smoke-stress) [[ -z "$attempt" ]] || { echo 'Smoke has no attempt ID' >&2; exit 2; } ;;
      main|stress) [[ "$attempt" =~ ^[A-Za-z0-9_-]+$ ]] || { echo 'Attempt ID required' >&2; exit 2; } ;;
      *) echo 'Usage: managed.sh start {smoke-base|smoke-stress|main|stress} [ATTEMPT]' >&2; exit 2 ;;
    esac
    [[ -f "$results/freeze.json" ]] || { echo 'Freeze missing' >&2; exit 1; }
    if live_state "$state"; then
      echo "revised cohort already active: pid=$pid group=$group log=$log" >&2
      exit 1
    fi
    if [[ -f "$state" ]]; then
      mv "$state" "$results/managed-closed-$(date -u +%Y%m%dT%H%M%S)-${pid:-unknown}.state"
    fi
    group=$requested_group
    if [[ "$group" == main || "$group" == stress ]]; then
      args=(--attempt "$attempt")
      [[ ! -e "$results/run-$group-$attempt.json" ]] || { echo 'Attempt status exists' >&2; exit 1; }
    else
      args=()
    fi
    log="$results/managed-$group-${attempt:-once}-$(date -u +%Y%m%dT%H%M%S).log"
    setsid bash "$root/branching-revised/run.sh" "$group" "${args[@]}" \
      </dev/null >"$log" 2>&1 9>&- &
    pid=$!
    ticks=$(awk '{print $22}' "/proc/$pid/stat" 2>/dev/null || echo 0)
    printf '%s %s %s %s\n' "$pid" "$group" "$ticks" "$log" > "$state"
    echo "started pid=$pid group=$group attempt=${attempt:-none} log=$log state=$state"
    ;;
  status)
    if live_state "$state"; then
      echo "running pid=$pid group=$group log=$log"
    elif [[ -f "$state" ]]; then
      read -r pid group ticks log < "$state"
      echo "exited pid=$pid group=$group log=$log"
    else
      echo 'no revised cohort run recorded'
    fi
    ;;
  stop)
    requested_group=${2:-}
    if ! live_state "$state" || [[ "$requested_group" != "$group" ]]; then
      echo 'No matching active revised cohort run' >&2
      exit 1
    fi
    kill -TERM -- "-$pid"
    for _ in $(seq 1 20); do
      live_state "$state" || break
      sleep 1
    done
    if live_state "$state"; then kill -KILL -- "-$pid"; fi
    docker rm -f vowser-eval-v2-br3-revised >/dev/null 2>&1 || true
    bash "$root/shared/db-control.sh" stop mysql
    bash "$root/shared/db-control.sh" stop neo4j
    echo "stopped pid=$pid group=$group log=$log"
    ;;
  *)
    echo 'Usage: managed.sh {start GROUP [ATTEMPT]|status|stop GROUP}' >&2
    exit 2
    ;;
esac
