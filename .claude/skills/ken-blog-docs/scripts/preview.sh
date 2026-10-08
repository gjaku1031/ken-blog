#!/usr/bin/env bash
# 운영 공개 데이터와 현재 원고로 사이트를 로컬 빌드하고 127.0.0.1:8765에서 제공함
# 실행용: preview.sh <출력 디렉터리>   → <출력>/ken-blog/post/<slug>/
# 필요: gh 로그인(공개 API 주소를 저장소 변수에서 읽음), node, python3, curl. 종료 코드: 64 인자 오류, 1 빌드·서버 실패
set -euo pipefail
out=${1:?사용: preview.sh <출력 디렉터리>}
# 8765: preview-shots.cjs의 기본 URL과 맞춘 고정 포트. 이미 떠 있으면 그대로 씀
port=8765
cd "$(git rev-parse --show-toplevel)"
api=$(gh variable get BLOG_API_BASE_URL --repo gjaku1031/ken-blog) \
  || { echo "공개 API 주소를 읽지 못함: gh 로그인 상태와 저장소 변수 BLOG_API_BASE_URL을 확인" >&2; exit 1; }
PUBLIC_API_BASE_URL="$api" node .github/pages/build.mjs --output-dir="$out/ken-blog" | tail -1
[[ -d "$out/ken-blog/post" ]] || { echo "빌드 결과가 없음: $out/ken-blog/post" >&2; exit 1; }
if ! curl -s -o /dev/null "http://127.0.0.1:$port/ken-blog/"; then
  (cd "$out" && nohup python3 -m http.server "$port" >/dev/null 2>&1 &)
  sleep 1
  curl -s -o /dev/null "http://127.0.0.1:$port/ken-blog/" || { echo "로컬 서버가 뜨지 않음: 127.0.0.1:$port" >&2; exit 1; }
fi
echo "http://127.0.0.1:$port/ken-blog/"
