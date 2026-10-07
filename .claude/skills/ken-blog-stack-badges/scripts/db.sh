#!/usr/bin/env bash
# 운영 MySQL에 SQL 파일을 실행함. oci-blog SSH 터널을 거치며 접속 정보는 출력하지 않음
# 사용: db.sh <SQL 파일>   (읽기 전용 조회는 그대로, 쓰기는 사용자 확인 후 실행)
set -euo pipefail
sql_file=${1:?Usage: db.sh SQL_FILE}
[[ -r "$sql_file" ]] || { echo "SQL 파일을 읽을 수 없음: $sql_file" >&2; exit 64; }

# 원격 production.env의 DB_URL·DB_USERNAME·DB_PASSWORD를 base64로만 받아 옴
payload=$(ssh -o BatchMode=yes -o ConnectTimeout=8 oci-blog 'python3 -' <<'PY'
import base64, re
env = {}
for line in open("/srv/ken-blog-live/production.env", encoding="utf-8"):
    if "=" in line and not line.lstrip().startswith("#"):
        k, v = line.rstrip("\n").split("=", 1)
        env[k] = v.strip().strip('"').strip("'")
m = re.match(r"jdbc:mysql://([^:/]+):(\d+)/([^?]+)", env["DB_URL"])
print(base64.b64encode("\n".join([m.group(1), m.group(2), m.group(3), env["DB_USERNAME"], env["DB_PASSWORD"]]).encode()).decode())
PY
)
mapfile -t cfg < <(printf '%s' "$payload" | base64 -d)
host=${cfg[0]} port=${cfg[1]} db=${cfg[2]} user=${cfg[3]}
export MYSQL_PWD=${cfg[4]}
unset payload cfg

local_port=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1])')
ssh -o BatchMode=yes -N -L "127.0.0.1:${local_port}:${host}:${port}" oci-blog &
tunnel=$!
trap 'kill $tunnel 2>/dev/null || true; unset MYSQL_PWD' EXIT
for _ in $(seq 1 30); do (echo > "/dev/tcp/127.0.0.1/${local_port}") 2>/dev/null && break; sleep 0.3; done

docker run --rm -i --network host -e MYSQL_PWD mysql:8.4.11 \
  mysql --default-character-set=utf8mb4 --ssl-mode=REQUIRED -h 127.0.0.1 -P "$local_port" -u "$user" "$db" < "$sql_file"
