#!/usr/bin/env bash
# 실제 운영 환경 파일을 읽지 않고 Compose·Caddy 구문과 필수 경계 검증
set -euo pipefail
ken_verify_dir=$(mktemp -d)
trap 'rm -rf "$ken_verify_dir"' EXIT
mkdir "$ken_verify_dir/assets"
: > "$ken_verify_dir/empty.env"
export KEN_BLOG_PRODUCTION_ENV_FILE="$ken_verify_dir/empty.env"
export KEN_BLOG_ASSETS_DIR="$ken_verify_dir/assets"
export KEN_BLOG_API_IMAGE=ken-blog-api:config-validation
export KEN_BLOG_PUBLIC_IP=192.0.2.1
export KEN_BLOG_PUBLIC_BIND_IP=127.0.0.1
export AUTH_PROXY_KEY=ci-proxy-validation-not-a-production-secret
# 출력에는 환경 값을 쓰지 않고 파싱 성공 여부만 확인
docker compose -f deploy/compose.production.yaml config --quiet
docker run --rm -e KEN_BLOG_PUBLIC_IP -e AUTH_PROXY_KEY \
  --mount "type=bind,source=$PWD/deploy/Caddyfile,target=/etc/caddy/Caddyfile,readonly" \
  caddy:2.11.4-alpine caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
# 인증 없는 공개 메서드와 신뢰 출처 헤더를 실제 프록시에서 확인
python3 deploy/tests/verify-routing.py
