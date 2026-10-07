#!/usr/bin/env bash
# 운영 공개 데이터와 현재 원고로 사이트를 로컬 빌드하고 127.0.0.1:8765에서 제공함
# 사용: preview.sh <출력 디렉터리>   → <출력>/ken-blog/post/<slug>/
set -euo pipefail
out=${1:?Usage: preview.sh OUTPUT_DIR}
cd "$(git rev-parse --show-toplevel)"
PUBLIC_API_BASE_URL=$(gh variable get BLOG_API_BASE_URL --repo gjaku1031/ken-blog) \
  node .github/pages/build.mjs --output-dir="$out/ken-blog" | tail -1
if ! curl -s -o /dev/null http://127.0.0.1:8765/ken-blog/; then
  (cd "$out" && nohup python3 -m http.server 8765 >/dev/null 2>&1 &)
  sleep 1
fi
echo "http://127.0.0.1:8765/ken-blog/"
