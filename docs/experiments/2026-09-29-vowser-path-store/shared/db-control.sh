#!/usr/bin/env bash
set -euo pipefail

action=${1:-}
kind=${2:-}
case "$kind" in
  mysql) name=vowser-eval-v2-mysql; port=19506 ;;
  neo4j) name=vowser-eval-v2-neo4j; port=19587 ;;
  *) echo 'Usage: db-control.sh {start|stop|ready|status|stats} {mysql|neo4j}' >&2; exit 2 ;;
esac
case "$action" in
  start)
    if [[ "$(docker inspect --format '{{.State.Running}}' "$name")" != true ]]; then
      docker start "$name" >/dev/null
    fi
    ;;
  stop)
    if [[ "$(docker inspect --format '{{.State.Running}}' "$name")" == true ]]; then
      docker stop "$name" >/dev/null
    fi
    ;;
  ready)
    # TCP 수신 가능성 확인. 인증·쿼리 준비는 각 실험의 드라이버 스모크에서 확인.
    for _ in $(seq 1 60); do
      if (echo >/dev/tcp/127.0.0.1/"$port") >/dev/null 2>&1; then
        printf '%s TCP ready at 127.0.0.1:%s\n' "$name" "$port"
        exit 0
      fi
      sleep 1
    done
    echo "$name TCP not ready after 60 s" >&2
    exit 1
    ;;
  status)
    docker inspect --format '{{.Name}} running={{.State.Running}} image={{.Image}} nano_cpus={{.HostConfig.NanoCpus}} memory={{.HostConfig.Memory}}' "$name"
    ;;
  stats)
    docker stats --no-stream --format '{{.Name}} cpu={{.CPUPerc}} memory={{.MemUsage}}' "$name"
    ;;
  *) echo 'Usage: db-control.sh {start|stop|ready|status|stats} {mysql|neo4j}' >&2; exit 2 ;;
esac
