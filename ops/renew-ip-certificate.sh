#!/usr/bin/env bash
set -euo pipefail

# IP 인증서를 갱신한 뒤 Spring SSL bundle이 읽는 PEM을 원자적으로 교체.
: "${KEN_BLOG_ACME_WEBROOT_DIR:?ACME webroot directory is required}"
: "${KEN_BLOG_CERTBOT_CONFIG_DIR:?Certbot configuration directory is required}"
: "${KEN_BLOG_TLS_DIR:?Dedicated application TLS directory is required}"
certbot_image="${KEN_BLOG_CERTBOT_IMAGE:-certbot/certbot:v5.4.0}"

if [[ "$KEN_BLOG_ACME_WEBROOT_DIR" != /* || ! -d "$KEN_BLOG_ACME_WEBROOT_DIR" ]]; then
    echo 'ACME webroot must be an existing absolute directory' >&2
    exit 2
fi
if [[ "$KEN_BLOG_CERTBOT_CONFIG_DIR" != /* || ! -f "$KEN_BLOG_CERTBOT_CONFIG_DIR/renewal/ken-blog-api.conf" ]]; then
    echo 'The ken-blog-api Certbot lineage is missing' >&2
    exit 2
fi
command -v docker >/dev/null

# 수동 실행과 systemd 중복 갱신 방지. 잠금 파일은 운영 디렉터리에 보존.
exec 9>"$KEN_BLOG_CERTBOT_CONFIG_DIR/.ken-blog-renew.lock"
flock -n 9 || exit 0

docker run --rm --pull=never \
    --mount "type=bind,source=$KEN_BLOG_CERTBOT_CONFIG_DIR,target=/etc/letsencrypt" \
    --mount "type=bind,source=$KEN_BLOG_ACME_WEBROOT_DIR,target=/var/www/certbot" \
    "$certbot_image" renew \
    --cert-name ken-blog-api \
    --webroot \
    --webroot-path /var/www/certbot \
    --preferred-profile shortlived \
    --non-interactive

"$(dirname "$(readlink -f "$0")")/install-tls-material.sh"
