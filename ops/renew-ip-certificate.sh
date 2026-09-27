#!/usr/bin/env bash
set -euo pipefail

# HTTP-01 webroot로 지정한 IP 인증서만 갱신하고 성공한 시도 뒤 gateway가 인증서를 다시 읽도록 함.
: "${KEN_BLOG_ACME_WEBROOT_DIR:?ACME webroot directory is required}"
: "${KEN_BLOG_CERTBOT_CONFIG_DIR:?Certbot configuration directory is required}"
: "${KEN_BLOG_GATEWAY_CONTAINER:?Gateway container name is required}"
certbot_image="${KEN_BLOG_CERTBOT_IMAGE:-certbot/certbot:v5.4.0}"

if [[ "$KEN_BLOG_ACME_WEBROOT_DIR" != /* || ! -d "$KEN_BLOG_ACME_WEBROOT_DIR" ]]; then
    echo 'ACME webroot must be an existing absolute directory' >&2
    exit 2
fi
if [[ "$KEN_BLOG_CERTBOT_CONFIG_DIR" != /* || ! -f "$KEN_BLOG_CERTBOT_CONFIG_DIR/renewal/ken-blog-api.conf" ]]; then
    echo 'The ken-blog-api Certbot lineage is missing' >&2
    exit 2
fi
if [[ ! "$KEN_BLOG_GATEWAY_CONTAINER" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*$ ]]; then
    echo 'Gateway container name is invalid' >&2
    exit 2
fi

command -v docker >/dev/null

docker run --rm --pull=never \
    --mount "type=bind,source=$KEN_BLOG_CERTBOT_CONFIG_DIR,target=/etc/letsencrypt" \
    --mount "type=bind,source=$KEN_BLOG_ACME_WEBROOT_DIR,target=/var/www/certbot" \
    "$certbot_image" renew \
    --cert-name ken-blog-api \
    --webroot \
    --webroot-path /var/www/certbot \
    --preferred-profile shortlived \
    --non-interactive

docker exec "$KEN_BLOG_GATEWAY_CONTAINER" nginx -t
docker exec "$KEN_BLOG_GATEWAY_CONTAINER" nginx -s reload
