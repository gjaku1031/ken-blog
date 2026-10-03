#!/usr/bin/env bash
# 일회용 CA·서버 인증서·MySQL에서 Connector/J의 VERIFY_IDENTITY 검증
set -euo pipefail
ken_tls_dir=$(mktemp -d)
ken_tls_name="ken-blog-tls-$$"
# 성공·실패 모두 검증 컨테이너와 비운영 인증서 해제
cleanup() {
  docker rm -f -v "$ken_tls_name" "${ken_tls_name}-plain" >/dev/null 2>&1 || true
  rm -rf "$ken_tls_dir"
}
trap cleanup EXIT
# 현재 프로젝트의 검증된 런타임 Connector/J 경로를 인수로 받음
ken_tls_driver=${1:?Connector/J jar path is required}
openssl req -x509 -newkey rsa:2048 -nodes -keyout "$ken_tls_dir/ca-key.pem" -out "$ken_tls_dir/ca.pem" -days 1 -subj /CN=KenBlogTestCA >/dev/null 2>&1
openssl req -newkey rsa:2048 -nodes -keyout "$ken_tls_dir/server-key.pem" -out "$ken_tls_dir/server.csr" -subj /CN=127.0.0.1 >/dev/null 2>&1
printf 'subjectAltName=IP:127.0.0.1\nextendedKeyUsage=serverAuth\n' > "$ken_tls_dir/extensions"
openssl x509 -req -in "$ken_tls_dir/server.csr" -CA "$ken_tls_dir/ca.pem" -CAkey "$ken_tls_dir/ca-key.pem" -CAcreateserial -out "$ken_tls_dir/server-cert.pem" -days 1 -extfile "$ken_tls_dir/extensions" >/dev/null 2>&1
openssl req -x509 -newkey rsa:2048 -nodes -keyout "$ken_tls_dir/wrong-key.pem" -out "$ken_tls_dir/wrong.pem" -days 1 -subj /CN=WrongCA >/dev/null 2>&1
for ken_tls_ca in ca wrong; do
  keytool -importcert -noprompt -alias test-ca -file "$ken_tls_dir/$ken_tls_ca.pem" -keystore "$ken_tls_dir/$ken_tls_ca.p12" -storetype PKCS12 -storepass test-store-only >/dev/null 2>&1
done
# 일회용 테스트 키는 MySQL 컨테이너 사용자도 읽을 수 있게 준비
chmod 755 "$ken_tls_dir"
chmod 644 "$ken_tls_dir/server-key.pem"
docker run -d --name "$ken_tls_name" -p 127.0.0.1::3306 \
  -e MYSQL_ROOT_PASSWORD=ci_tls_root_only -e MYSQL_DATABASE=tls_test -e MYSQL_USER=tls_probe -e MYSQL_PASSWORD=ci_tls_only \
  --mount "type=bind,source=$ken_tls_dir,target=/test-certs,readonly" mysql:8.4.11 \
  --ssl-ca=/test-certs/ca.pem --ssl-cert=/test-certs/server-cert.pem --ssl-key=/test-certs/server-key.pem >/dev/null
# 실제 TCP 준비를 확인하며 시간 제한 내에만 대기
for ken_tls_attempt in $(seq 1 45); do
  if docker exec "$ken_tls_name" mysqladmin ping -h 127.0.0.1 --connect-timeout=2 --silent >/dev/null 2>&1; then break; fi
  sleep 1
done
ken_tls_port=$(docker port "$ken_tls_name" 3306/tcp | sed 's/.*://')
ken_tls_options="sslMode=VERIFY_IDENTITY&connectTimeout=3000&socketTimeout=3000&trustCertificateKeyStoreType=PKCS12&trustCertificateKeyStorePassword=test-store-only&trustCertificateKeyStoreUrl=file:$ken_tls_dir/ca.p12"
# 정상 인증서·호스트 성공, 다른 CA·다른 호스트는 연결 실패
java --class-path "$ken_tls_driver" deploy/tests/MysqlTlsProbe.java "jdbc:mysql://127.0.0.1:$ken_tls_port/tls_test?$ken_tls_options" true
java --class-path "$ken_tls_driver" deploy/tests/MysqlTlsProbe.java "jdbc:mysql://localhost:$ken_tls_port/tls_test?$ken_tls_options" false
java --class-path "$ken_tls_driver" deploy/tests/MysqlTlsProbe.java "jdbc:mysql://127.0.0.1:$ken_tls_port/tls_test?${ken_tls_options/ca.p12/wrong.p12}" false
# TLS가 없는 별도 서버도 거부
docker run -d --name "${ken_tls_name}-plain" -p 127.0.0.1::3306 \
  -e MYSQL_ROOT_PASSWORD=ci_tls_root_only -e MYSQL_DATABASE=tls_test -e MYSQL_USER=tls_probe -e MYSQL_PASSWORD=ci_tls_only \
  mysql:8.4.11 --tls-version= >/dev/null
for ken_tls_attempt in $(seq 1 45); do
  if docker exec "${ken_tls_name}-plain" mysqladmin ping -h 127.0.0.1 --connect-timeout=2 --silent >/dev/null 2>&1; then break; fi
  sleep 1
done
ken_tls_plain_port=$(docker port "${ken_tls_name}-plain" 3306/tcp | sed 's/.*://')
java --class-path "$ken_tls_driver" deploy/tests/MysqlTlsProbe.java "jdbc:mysql://127.0.0.1:$ken_tls_plain_port/tls_test?sslMode=DISABLED&allowPublicKeyRetrieval=true&connectTimeout=3000&socketTimeout=3000" true
java --class-path "$ken_tls_driver" deploy/tests/MysqlTlsProbe.java "jdbc:mysql://127.0.0.1:$ken_tls_plain_port/tls_test?$ken_tls_options" false
printf 'Connector/J TLS: valid CA/host accepted; wrong CA/host and plaintext rejected.\n'
