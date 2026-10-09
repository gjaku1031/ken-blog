#!/usr/bin/env bash
set -euo pipefail

# 최초 60분 실행이 끝난 뒤에만 사용. 별도 PID/로그와 60분 watchdog 보존.
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
results="$root/branching/results"
mkdir -p "$results"
state="$results/continuation-managed.state"
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
    [[ "$requested_group" == main || "$requested_group" == stress ]] || {
      echo 'Usage: continue_managed.sh start {main|stress} ATTEMPT' >&2; exit 2; }
    [[ "$attempt" =~ ^[A-Za-z0-9_-]+$ ]] || {
      echo 'ATTEMPT must be ASCII letters/digits/-/_' >&2; exit 2; }
    if live_state "$results/managed.state"; then
      echo "original run active: pid=$pid group=$group" >&2
      exit 1
    fi
    if live_state "$state"; then
      echo "continuation already active: pid=$pid group=$group log=$log" >&2
      exit 1
    fi
    if [[ -f "$state" ]]; then
      mv "$state" "$results/continuation-managed-closed-$(date -u +%Y%m%dT%H%M%S)-${pid:-unknown}.state"
    fi
    group=$requested_group
    [[ ! -e "$results/continuation-$group-$attempt.json" ]] || {
      echo "attempt status already exists: continuation-$group-$attempt.json" >&2; exit 1; }
    log="$results/continuation-managed-$group-$attempt-$(date -u +%Y%m%dT%H%M%S).log"
    setsid env PYTHONPATH="$root" python3 -m branching.continue_run "$group" --attempt "$attempt" \
      </dev/null >"$log" 2>&1 9>&- &
    pid=$!
    ticks=$(awk '{print $22}' "/proc/$pid/stat" 2>/dev/null || echo 0)
    printf '%s %s %s %s\n' "$pid" "$group" "$ticks" "$log" > "$state"
    echo "started pid=$pid group=$group attempt=$attempt log=$log state=$state"
    ;;
  status)
    if live_state "$state"; then
      echo "running pid=$pid group=$group log=$log"
    elif [[ -f "$state" ]]; then
      read -r pid group ticks log < "$state"
      echo "exited pid=$pid group=$group log=$log"
    else
      echo 'no continuation run recorded'
    fi
    ;;
  stop)
    requested_group=${2:-}
    if ! live_state "$state" || [[ "$requested_group" != "$group" ]]; then
      echo 'No matching active continuation; use status first' >&2
      exit 1
    fi
    kill -TERM -- "-$pid"
    for _ in $(seq 1 20); do
      live_state "$state" || break
      sleep 1
    done
    if live_state "$state"; then
      kill -KILL -- "-$pid"
    fi
    docker rm -f vowser-eval-v2-br3 >/dev/null 2>&1 || true
    bash "$root/shared/db-control.sh" stop mysql
    bash "$root/shared/db-control.sh" stop neo4j
    echo "stopped pid=$pid group=$group log=$log"
    ;;
  *)
    echo 'Usage: continue_managed.sh {start GROUP ATTEMPT|status|stop GROUP}' >&2
    exit 2
    ;;
esac
