#!/usr/bin/env bash
set -euo pipefail
umask 077

# Certbot 원본 권한을 넓히지 않고 앱 UID가 읽는 단일 PEM만 별도 디렉터리에 원자적으로 설치.
: "${KEN_BLOG_CERTBOT_CONFIG_DIR:?Certbot configuration directory is required}"
: "${KEN_BLOG_TLS_DIR:?Dedicated application TLS directory is required}"
[[ "$KEN_BLOG_CERTBOT_CONFIG_DIR" = /* && "$KEN_BLOG_TLS_DIR" = /* && "$KEN_BLOG_TLS_DIR" != / ]] || exit 2
[[ ! -L "$KEN_BLOG_TLS_DIR" ]] || { echo 'TLS directory must not be a symlink' >&2; exit 2; }
source_dir="$KEN_BLOG_CERTBOT_CONFIG_DIR/live/ken-blog-api"
cert="$source_dir/fullchain.pem"
key="$source_dir/privkey.pem"
[[ -f "$cert" && -f "$key" ]] || { echo 'Certificate lineage is missing' >&2; exit 2; }
openssl x509 -in "$cert" -noout -checkend 0 >/dev/null
cert_public=$(openssl x509 -in "$cert" -pubkey -noout | openssl pkey -pubin -outform DER | sha256sum | cut -d' ' -f1)
key_public=$(openssl pkey -in "$key" -pubout -outform DER | sha256sum | cut -d' ' -f1)
[[ "$cert_public" = "$key_public" ]] || { echo 'Certificate and key do not match' >&2; exit 2; }
install -d -m 0700 -o 10001 -g 10001 "$KEN_BLOG_TLS_DIR"
pending=$(mktemp "$KEN_BLOG_TLS_DIR/.server.pem.XXXXXX")
trap 'rm -f -- "$pending"' EXIT
cat "$cert" "$key" > "$pending"
chmod 0600 "$pending"
chown 10001:10001 "$pending"
if [[ -f "$KEN_BLOG_TLS_DIR/server.pem" ]] && cmp -s "$pending" "$KEN_BLOG_TLS_DIR/server.pem"; then
  echo 'TLS material unchanged'
else
  mv -f -- "$pending" "$KEN_BLOG_TLS_DIR/server.pem"
  echo 'TLS material installed for Spring SSL bundle reload'
fi
