#!/usr/bin/env bash
set -euo pipefail

out=results-v2/caddy-v2-headers.txt
: > "$out"

capture() {
  local label="$1"
  local url="$2"
  printf '\n## %s\nURL: %s\n-- HEAD --\n' "$label" "$url" >> "$out"
  curl -skI -H 'Accept-Encoding: gzip' "$url" >> "$out"
  printf '%s\n' '-- GET headers (body discarded) --' >> "$out"
  curl -skD - -o /dev/null -H 'Accept-Encoding: gzip' "$url" >> "$out"
  local etag
  etag="$(curl -skI -H 'Accept-Encoding: gzip' "$url" | awk 'tolower($1)=="etag:" { sub(/\r$/, ""); sub(/^[^ ]+ +/, ""); print; exit }')"
  if [[ -n "$etag" ]]; then
    printf '%s\n' '-- Conditional HEAD --' >> "$out"
    curl -skI -H 'Accept-Encoding: gzip' -H "If-None-Match: $etag" "$url" >> "$out"
  fi
}

capture csr_html 'https://csr.127.0.0.1.nip.io:18444/project/?slug=ken-blog'
capture csr_js 'https://csr.127.0.0.1.nip.io:18444/_next/static/chunks/2ul8ophnk13y-.js'
capture csr_css 'https://csr.127.0.0.1.nip.io:18444/_next/static/chunks/11lz9qhy9uk99.css'
capture csr_image 'https://csr.127.0.0.1.nip.io:18444/api/v1/stack-badges/17/image'
capture hybrid_html 'https://hybrid.127.0.0.1.nip.io:18444/project/ken-blog/'
capture hybrid_js 'https://hybrid.127.0.0.1.nip.io:18444/_next/static/chunks/2ul8ophnk13y-.js'
capture hybrid_css 'https://hybrid.127.0.0.1.nip.io:18444/_next/static/chunks/2s77t-wi87yy4.css'
capture hybrid_image 'https://hybrid.127.0.0.1.nip.io:18444/api/v1/stack-badges/17/image'
capture static_html 'https://static.127.0.0.1.nip.io:18444/ken-blog/post/post-f9235d74-4d5b-4705-8f59-ba3511bd50e9/'
capture static_js 'https://static.127.0.0.1.nip.io:18444/ken-blog/assets/public-FWLTE7VH.js'
capture static_css 'https://static.127.0.1.nip.io:18444/ken-blog/assets/public-MS3AGEKC.css'
capture static_image 'https://static.127.0.0.1.nip.io:18444/ken-blog/assets/stack-17-b49115b257a12acbee18264e8f466fcab0913c5b9b217d08ca3f803f43aaa573.png'

for host in csr hybrid; do
  printf '\n## %s_api_json\nGET headers (body discarded)\n' "$host" >> "$out"
  curl -skD - -o /dev/null "https://$host.127.0.0.1.nip.io:18444/api/v1/projects/ken-blog" >> "$out"
done
printf '\n## static_auth_me\nBrowser route interception only; no server request\n' >> "$out"
printf 'saved %s\n' "$out"
