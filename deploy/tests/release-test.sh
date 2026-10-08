#!/usr/bin/env bash
# deploy/release.sh를 운영 Compose 파일 그대로 실행해 배포·재배포·아카이브 거부·기동 실패 롤백을 확인함
# 실행용: bash deploy/tests/release-test.sh <CI 이미지 아카이브(image.tar.gz)>
# 필요: Docker, Compose, jq. 격리 MySQL과 임시 운영 디렉터리를 만들고 끝나면 지움. 18084·13309 포트를 씀
set -euo pipefail

archive=${1:?사용: release-test.sh <image.tar.gz>}
repo=$(cd "$(dirname "$0")/../.." && pwd)
release=$repo/deploy/release.sh
image=$(docker load -i "$archive" | sed -n 's/^Loaded image: //p')
[[ $image =~ ^ken-blog-api:jvm-[0-9a-f]{40}$ ]] || { echo "CI 이미지 이름이 아님: $image" >&2; exit 64; }
tag=${image#ken-blog-api:}
db_port=13309
api_port=18084
mysql_name=ken-blog-release-test-mysql

live=$(mktemp -d)
export KEN_BLOG_LIVE_DIR=$live
COMPOSE=(docker compose --env-file "$live/production.env" -f "$live/deploy/compose.production.yaml" -f "$live/deploy/compose.mysql-tls.yaml")

# 실패 시 진단을 남기고 컨테이너·임시 디렉터리 정리
cleanup() {
  result=$?
  if [[ $result -ne 0 ]]; then
    "${COMPOSE[@]}" logs --no-color --tail 60 api || true
    cat "$live/releases/history.log" 2>/dev/null || true
  fi
  "${COMPOSE[@]}" down --remove-orphans >/dev/null 2>&1 || true
  docker rm -f "$mysql_name" >/dev/null 2>&1 || true
  docker rmi ken-blog-api:jvm-ffffffffffffffffffffffffffffffffffffffff >/dev/null 2>&1 || true
  rm -rf "$live"
  exit "$result"
}
trap cleanup EXIT

# 결과 확인용 출력
pass() { echo "PASS $*"; }
fail() { echo "FAIL $*" >&2; exit 1; }

# release.sh 실행 후 종료 코드만 표준 출력으로 돌려줌. 스크립트 출력은 표준 오류로 보여 줌
run_release() {
  local code=0
  bash "$release" "$1 $2" < "$3" >&2 || code=$?
  echo "$code"
}

# 실행 중인 API 컨테이너의 이미지와 health 상태
running_image() { docker inspect -f '{{.Config.Image}}' "$("${COMPOSE[@]}" ps -q api)"; }
running_health() { docker inspect -f '{{.State.Health.Status}}' "$("${COMPOSE[@]}" ps -q api)"; }

# 1. 격리 MySQL. 다른 Compose 네트워크의 API가 docker0 게이트웨이의 게시 포트로 접속함
docker run -d --name "$mysql_name" -p "$db_port:3306" \
  -e MYSQL_DATABASE=ken_blog_release -e MYSQL_USER=release -e MYSQL_PASSWORD=release_ephemeral_only \
  -e MYSQL_ROOT_PASSWORD=release_root_ephemeral_only mysql:8.4.11 >/dev/null
gateway=$(docker network inspect bridge -f '{{(index .IPAM.Config 0).Gateway}}')
for _ in $(seq 1 60); do
  docker exec "$mysql_name" mysqladmin ping -h 127.0.0.1 --silent >/dev/null 2>&1 && break
  sleep 2
done
# 첫 ping 직후 초기화 재시작이 있어 실제 접속까지 다시 확인함
for _ in $(seq 1 30); do
  docker exec "$mysql_name" sh -c 'MYSQL_PWD=release_ephemeral_only mysql -urelease ken_blog_release -e "SELECT 1"' >/dev/null 2>&1 && break
  sleep 2
done
docker exec -i "$mysql_name" sh -c 'MYSQL_PWD=release_ephemeral_only mysql -urelease ken_blog_release' < "$repo/deploy/sql/bootstrap-auth.sql"

# 2. 임시 운영 디렉터리: 저장소의 Compose·Caddy 파일과 운영과 같은 키의 환경 파일
mkdir -p "$live/deploy" "$live/releases" "$live/assets"
cp "$repo/deploy/compose.production.yaml" "$repo/deploy/compose.mysql-tls.yaml" "$repo/deploy/Caddyfile" "$live/deploy/"
: > "$live/mysql-truststore.p12"
cat > "$live/production.env" <<EOF
DB_URL=jdbc:mysql://$gateway:$db_port/ken_blog_release
DB_USERNAME=release
DB_PASSWORD=release_ephemeral_only
ADMIN_USERNAME=release_admin
KEN_BLOG_PRODUCTION_ENV_FILE=$live/production.env
KEN_BLOG_ASSETS_DIR=$live/assets
KEN_BLOG_API_IMAGE=ken-blog-api:not-deployed
API_PORT=$api_port
KEN_BLOG_PUBLIC_IP=192.0.2.1
KEN_BLOG_PUBLIC_BIND_IP=127.0.0.1
AUTH_PROXY_KEY=release-test-proxy-key-not-a-production-secret
KEN_BLOG_MYSQL_TRUSTSTORE=$live/mysql-truststore.p12
MYSQL_TRUSTSTORE_PASSWORD=
EOF
chmod 600 "$live/production.env"

# 3. 운영 설정(validate, SQL 초기화 없음)으로 뜨도록 같은 이미지를 기본 설정으로 한 번 띄워 스키마를 만듦
docker run -d --name ken-blog-release-schema --network host --user 10001:1001 --memory 1536m --cpus 1 \
  -e DB_URL="jdbc:mysql://127.0.0.1:$db_port/ken_blog_release" -e DB_USERNAME=release -e DB_PASSWORD=release_ephemeral_only \
  -e ADMIN_USERNAME=release_admin -e APP_ASSETS_DIRECTORY=/var/lib/ken-blog/assets -e SERVER_PORT=18085 \
  --mount "type=bind,source=$live/assets,target=/var/lib/ken-blog/assets,readonly" "$image" >/dev/null
for _ in $(seq 1 90); do
  curl -fsS http://127.0.0.1:18085/actuator/health >/dev/null 2>&1 && break
  sleep 2
done
curl -fsS http://127.0.0.1:18085/actuator/health >/dev/null || { docker logs ken-blog-release-schema; docker rm -f ken-blog-release-schema; fail "스키마 준비용 기동 실패"; }
docker rm -f ken-blog-release-schema >/dev/null

sha=$(sha256sum "$archive" | cut -d' ' -f1)

# 4. 새 이미지 배포: 성공, healthy, TLS truststore 마운트, 이력 기록
[[ $(run_release "$tag" "$sha" "$archive" | tail -1) == 0 ]] || fail "첫 배포가 실패함"
[[ $(running_image) == "$image" && $(running_health) == healthy ]] || fail "배포 후 이미지·health 불일치"
docker inspect -f '{{range .Mounts}}{{.Destination}} {{end}}' "$("${COMPOSE[@]}" ps -q api)" | grep -q /run/ken-blog/mysql-truststore.p12 \
  || fail "truststore 마운트 누락"
grep -q " ok ken-blog-api:not-deployed $image\$" "$live/releases/history.log" || fail "배포 이력 누락"
pass "배포 성공, healthy, truststore 마운트, 이력 기록"

# 5. 같은 이미지 재배포: 재생성 없이 성공
before=$("${COMPOSE[@]}" ps -q api)
[[ $(run_release "$tag" "$sha" "$archive" | tail -1) == 0 ]] || fail "같은 이미지 재배포가 실패함"
[[ $("${COMPOSE[@]}" ps -q api) == "$before" ]] || fail "같은 이미지인데 컨테이너가 재생성됨"
pass "같은 이미지 재배포는 건너뜀"

# 6. 해시가 다른 아카이브와 잘못된 인자: 교체 전에 거부
[[ $(run_release "$tag" "$(printf '0%.0s' {1..64})" "$archive" | tail -1) == 65 ]] || fail "해시 불일치를 거부하지 않음"
[[ $(run_release "latest" "$sha" "$archive" | tail -1) == 64 ]] || fail "잘못된 태그를 거부하지 않음"
[[ $(running_image) == "$image" ]] || fail "거부된 배포가 실행 이미지를 바꿈"
pass "해시 불일치·잘못된 태그 거부"

# 7. 기동하지 못하는 이미지: 이전 이미지로 롤백하고 healthy 유지
broken=ken-blog-api:jvm-ffffffffffffffffffffffffffffffffffffffff
printf 'FROM %s\nENTRYPOINT ["/bin/false"]\n' "$image" | docker build -q -t "$broken" - >/dev/null
docker save "$broken" | gzip -1 > "$live/broken.tar.gz"
docker rmi "$broken" >/dev/null
[[ $(run_release "${broken#ken-blog-api:}" "$(sha256sum "$live/broken.tar.gz" | cut -d' ' -f1)" "$live/broken.tar.gz" | tail -1) == 70 ]] \
  || fail "기동 실패 이미지에서 롤백 종료 코드가 아님"
[[ $(running_image) == "$image" && $(running_health) == healthy ]] || fail "롤백 후 이전 이미지가 healthy가 아님"
grep -q "^KEN_BLOG_API_IMAGE=$image\$" "$live/production.env" || fail "롤백 후 환경 파일 이미지 값이 이전 값이 아님"
grep -q " rolled_back $image $broken\$" "$live/releases/history.log" || fail "롤백 이력 누락"
pass "기동 실패 시 이전 이미지로 롤백"
