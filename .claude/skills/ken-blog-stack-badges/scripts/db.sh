#!/usr/bin/env bash
# 운영 MySQL에 SQL 파일을 실행함. oci-prod SSH 터널을 거치며 접속 정보는 화면·로그에 남기지 않음
# 실행용: db.sh <SQL 파일>   (읽기 전용 조회는 그대로, 쓰기는 사용자 확인 후 실행)
# 필요: oci-prod SSH 설정(비밀번호 입력 없이 접속), 로컬 docker, python3. 종료 코드: 64 인자 오류, 69 접속·터널 실패, 그 외는 mysql 종료 코드
set -euo pipefail
sql_file=${1:?사용: db.sh <SQL 파일>}
[[ -r "$sql_file" ]] || { echo "SQL 파일을 읽을 수 없음: $sql_file" >&2; exit 64; }
command -v docker >/dev/null || { echo "docker가 없어 MySQL 클라이언트 이미지를 실행할 수 없음" >&2; exit 69; }

# 접속 정보는 원격 production.env에서 base64 한 줄로만 받아 와 변수에 두고 출력하지 않음
# ConnectTimeout 8: 접속 실패를 몇 초 안에 알리되 해외 리전까지의 SSH 지연은 넘기지 않는 값
payload=$(ssh -o BatchMode=yes -o ConnectTimeout=8 oci-prod 'python3 -' <<'PY'
import base64, re
env = {}
for line in open("/srv/ken-blog-live/production.env", encoding="utf-8"):
    if "=" in line and not line.lstrip().startswith("#"):
        k, v = line.rstrip("\n").split("=", 1)
        env[k] = v.strip().strip('"').strip("'")
m = re.match(r"jdbc:mysql://([^:/]+):(\d+)/([^?]+)", env["DB_URL"])
print(base64.b64encode("\n".join([m.group(1), m.group(2), m.group(3), env["DB_USERNAME"], env["DB_PASSWORD"]]).encode()).decode())
PY
) || { echo "oci-prod 접속 또는 production.env 읽기 실패" >&2; exit 69; }
mapfile -t cfg < <(printf '%s' "$payload" | base64 -d)
[[ ${#cfg[@]} -eq 5 ]] || { echo "접속 정보 형식이 예상과 다름(호스트·포트·DB·사용자·비밀번호 5줄)" >&2; exit 69; }
host=${cfg[0]} port=${cfg[1]} db=${cfg[2]} user=${cfg[3]}
export MYSQL_PWD=${cfg[4]}
unset payload cfg

# 빈 로컬 포트로 SSH 터널을 열고, 최대 9초(0.3초 × 30회) 동안 포트가 열리길 기다림. 종료 시 터널과 비밀번호 변수를 정리
local_port=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1])')
ssh -o BatchMode=yes -N -L "127.0.0.1:${local_port}:${host}:${port}" oci-prod &
tunnel=$!
trap 'kill $tunnel 2>/dev/null || true; unset MYSQL_PWD' EXIT
ready=0
for _ in $(seq 1 30); do
  if (echo > "/dev/tcp/127.0.0.1/${local_port}") 2>/dev/null; then ready=1; break; fi
  sleep 0.3
done
[[ $ready -eq 1 ]] || { echo "SSH 터널이 열리지 않음(127.0.0.1:${local_port})" >&2; exit 69; }

# mysql:8.4.11: 클라이언트 버전을 고정해 실행 환경마다 같은 결과를 얻음. 비밀번호는 MYSQL_PWD 환경 변수로만 전달하고 인자에 쓰지 않음
docker run --rm -i --network host -e MYSQL_PWD mysql:8.4.11 \
  mysql --default-character-set=utf8mb4 --ssl-mode=REQUIRED -h 127.0.0.1 -P "$local_port" -u "$user" "$db" < "$sql_file"
