#!/usr/bin/env bash
# 운영 API 이미지 교체. 표준 입력의 CI 이미지 아카이브를 불러와 API만 재생성하고, 검사에 실패하면 이전 이미지로 되돌림
# 실행용: sudo ken-blog-release "jvm-<40자 커밋> <아카이브 SHA-256>" < image.tar.gz
# 배포 키의 authorized_keys command=가 이 스크립트만 실행하므로 인자는 문자열 하나로 받아 형식을 검사함
# 종료 코드: 0 성공(또는 이미 배포됨), 64 인자 오류, 65 아카이브 불일치, 70 새 이미지 실패 후 롤백 성공, 71 롤백도 실패, 75 다른 배포 진행 중
set -euo pipefail

# 운영 경로. 검증 스크립트만 바꿔 씀. 배포 키는 sudo로 실행해 환경 변수가 지워지므로 운영에서는 바꿀 수 없음
LIVE=${KEN_BLOG_LIVE_DIR:-/srv/ken-blog-live}
ENV_FILE=$LIVE/production.env
HISTORY=$LIVE/releases/history.log
# 운영 DB TLS truststore 마운트가 빠지지 않도록 Compose 파일 두 개를 고정함
COMPOSE=(docker compose --env-file "$ENV_FILE" -f "$LIVE/deploy/compose.production.yaml" -f "$LIVE/deploy/compose.mysql-tls.yaml")
# healthy 대기 상한. 1 CPU 한도에서 기동 약 25초. healthcheck start_period(120초) 이후의 첫 실패 판정까지 기다림
WAIT_SECONDS=150

# 인자 검사: 커밋 태그와 아카이브 해시만 허용
read -r tag sha <<<"${1:-}"
if [[ ! ${tag:-} =~ ^jvm-[0-9a-f]{40}$ || ! ${sha:-} =~ ^[0-9a-f]{64}$ ]]; then
  echo "사용: ken-blog-release \"jvm-<커밋> <sha256>\" < image.tar.gz" >&2
  exit 64
fi
image=ken-blog-api:$tag

# 동시 배포 방지
exec 9>"$LIVE/releases/.release.lock"
flock -n 9 || { echo "다른 배포가 진행 중" >&2; exit 75; }

# 단계 출력. Actions 로그에 그대로 남음
step() { echo "[$(date -u +%H:%M:%S)] $*"; }

# 배포 이력 한 줄 기록: 시각, 결과, 이전 이미지, 새 이미지
record() { echo "$(date -u +%FT%TZ) $1 ${prev:-none} $image" >> "$HISTORY"; }

# production.env의 이미지 값만 바꿈. 같은 디렉터리의 사본을 고친 뒤 이름을 바꿔, 중간에 끊겨도 파일이 반쯤 쓰이지 않음
set_image() {
  cp -p "$ENV_FILE" "$ENV_FILE.next"
  sed -i "s|^KEN_BLOG_API_IMAGE=.*|KEN_BLOG_API_IMAGE=$1|" "$ENV_FILE.next"
  mv "$ENV_FILE.next" "$ENV_FILE"
}

# API만 재생성하고 healthcheck가 healthy가 될 때까지 기다림. 상한을 넘거나 컨테이너가 죽으면 실패
up() { "${COMPOSE[@]}" up -d --no-deps --wait --wait-timeout "$WAIT_SECONDS" api; }

# 기동 후 확인: 공개 데이터·인증 경로·이미지 응답과 기동 이후 ERROR 로그. 실패하면 0이 아닌 값을 돌려줌
verify() {
  local origin=http://127.0.0.1:$api_port container badge
  curl -fsS -o "$work/snapshot.json" "$origin/api/v1/pages/snapshot" || { echo "스냅샷 응답 실패" >&2; return 1; }
  curl -fsS -o /dev/null "$origin/api/v1/auth/csrf" || { echo "CSRF 응답 실패" >&2; return 1; }
  # 공개 프로젝트에 쓰인 첫 기술 아이콘(/api/v1/stack-badges/{id}/image?v=…). 없으면 이미지 경로 확인을 건너뜀
  badge=$(jq -r '[.. | objects | .imageUrl? // empty | select(test("^/api/v1/stack-badges/"))][0] // empty' "$work/snapshot.json")
  if [[ -n $badge ]]; then
    curl -fsS -o /dev/null "$origin$badge" || { echo "기술 아이콘 응답 실패" >&2; return 1; }
  fi
  container=$("${COMPOSE[@]}" ps -q api)
  if docker logs --since "$(docker inspect -f '{{.State.StartedAt}}' "$container")" "$container" 2>&1 | grep -E ' ERROR ' >&2; then
    echo "기동 이후 ERROR 로그 있음" >&2
    return 1
  fi
  step "revision $revision_before → $(jq -r .revision "$work/snapshot.json")"
}

work=$(mktemp -d "${TMPDIR:-/var/tmp}/ken-blog-release.XXXXXX")
trap 'rm -rf "$work"' EXIT

# 1. 아카이브 수신과 전송 손상 확인. 출처는 배포 키를 가진 CI로 한정되며, 해시는 전송 중 손상만 걸러냄
step "아카이브 수신"
cat > "$work/image.tar.gz"
echo "$sha  $work/image.tar.gz" | sha256sum -c --quiet - || { echo "아카이브 SHA-256 불일치" >&2; exit 65; }
loaded=$(docker load -i "$work/image.tar.gz" | sed -n 's/^Loaded image: //p')
[[ $loaded == "$image" ]] || { echo "아카이브 이미지 이름이 다름: $loaded" >&2; exit 65; }
[[ $(docker image inspect -f '{{.Os}}/{{.Architecture}}' "$image") == linux/arm64 ]] || { echo "ARM64 이미지가 아님" >&2; exit 65; }

# 2. 배포 전 상태 기록
prev=$(sed -n 's/^KEN_BLOG_API_IMAGE=//p' "$ENV_FILE")
api_port=$(sed -n 's/^API_PORT=//p' "$ENV_FILE")
if [[ $prev == "$image" ]]; then
  step "이미 배포된 이미지: $image"
  exit 0
fi
revision_before=$(curl -fs "http://127.0.0.1:$api_port/api/v1/pages/snapshot" | jq -r .revision) || revision_before=unknown
step "이전 $prev → 새 $image"

# 3. 교체와 확인. 실패하면 이전 이미지로 되돌림
set_image "$image"
if up && verify; then
  record ok
  step "배포 완료"
  exit 0
fi

step "새 이미지 실패, 이전 이미지로 되돌림"
"${COMPOSE[@]}" logs --no-color --tail 80 api >&2 || true
set_image "$prev"
if up; then
  record rolled_back
  step "롤백 완료: $prev"
  exit 70
fi
record rollback_failed
echo "롤백도 실패함. 서버에서 직접 확인 필요" >&2
exit 71
