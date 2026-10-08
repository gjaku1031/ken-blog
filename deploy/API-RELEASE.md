# 운영 API 이미지 교체

CI가 만든 ARM64 JVM 이미지를 운영 서버(`oci-prod`, `/srv/ken-blog-live`)에 반영하는 반복 절차. 열을 추가·삭제하는 변경은 확장-축소 순서로 이관 SQL과 이미지 교체를 나눈다.

## Compose 명령의 기준

운영 DB는 사설 CA의 TLS로 연결하므로 API는 truststore 마운트가 필요하다. 모든 Compose 명령에 두 파일을 함께 지정한다.

```bash
cd /srv/ken-blog-live
docker compose --env-file production.env \
  -f deploy/compose.production.yaml \
  -f deploy/compose.mysql-tls.yaml \
  up -d --no-deps api
```

`compose.production.yaml` 하나로 API를 재생성하면 `/run/ken-blog/mysql-truststore.p12`가 없어 JPA 초기화 단계에서 기동이 실패하고 재시작을 반복한다. 2026-10-07 Java 이미지 배포와 롤백에서 이 누락으로 API가 약 6분간 중단됐다. 실행 중인 컨테이너의 `com.docker.compose.project.config_files` 라벨로 두 파일이 모두 적용됐는지 확인한다.

## 절차

1. 배포 전 기록: 현재 `KEN_BLOG_API_IMAGE` 태그와 이미지 ID, 공개 스냅샷의 `version`·`revision`.
2. CI artifact의 아카이브 SHA-256 대조 후 서버로 전송, `docker load`, 이미지 ID 대조.
3. `production.env`의 `KEN_BLOG_API_IMAGE`만 새 태그로 변경.
4. 위 기준 명령으로 API만 재생성. Caddy·DB·다른 환경 값은 변경하지 않는다.
5. 호스트의 API 포트(`API_PORT`, 현재 18084)에서 `/actuator/health`가 UP이 될 때까지 대기.
6. 확인: 공개 주소의 health UP, 스냅샷 `version`과 `revision`이 배포 전과 같음, `/api/v1/auth/csrf` 200, 기술 아이콘 이미지 200, 기동 이후 로그의 ERROR 없음.
7. 하나라도 실패하면 1에서 기록한 태그로 `KEN_BLOG_API_IMAGE`를 되돌리고 같은 기준 명령으로 재생성한 뒤 health를 확인한다.

## 스키마 변경

운영은 `APP_JPA_DDL_AUTO=validate`, `APP_SQL_INIT_MODE=never`로 기동한다. 스키마 불일치로 기동이 실패하면 DDL 자동 갱신으로 바꾸지 않고 누락된 이관을 확인한다.

1. 열 추가: 이관 SQL로 열을 먼저 추가한 뒤 새 이미지를 배포한다.
2. 열 삭제: NOT NULL 열은 먼저 NULL 허용으로 바꾸고, 새 이미지를 배포해 기동을 확인한 뒤 열을 지운다.
3. 이관 SQL은 `deploy/sql/`에 날짜와 함께 두고, 실행 전 SQL을 검토한다.

## 새 DB 설치

`./gradlew generateJpaSchema`가 만든 `build/generated/jooq/schema.sql`을 검토해 **빈 DB에만** 적용한다. 이어 `deploy/sql/bootstrap-auth.sql`과 `INSERT INTO content_state (id) VALUES (1);`을 한 번 실행하고, 관리자 `users` 행을 직접 등록한다. bootstrap SQL은 인증 상태가 이미 있으면 실패하며 일반 앱 기동에는 포함되지 않는다.

## 인증 상태 유실 복구

API를 멈추고 원인을 확인한 뒤 `deploy/sql/recover-auth-state.sql`을 실행한다. 모든 JDBC 세션과 실패 출처가 삭제되므로 모든 브라우저가 다시 로그인해야 한다. 정상 재시작은 인증 상태 행을 다시 만들지 않는다.

## MySQL TLS

JDBC URL은 `sslMode=VERIFY_IDENTITY`이며 호스트명이 서버 인증서 SAN과 일치해야 한다. 사설 CA는 검토한 CA만 가져온 PKCS12 truststore를 `compose.mysql-tls.yaml`로 마운트하고, 비밀번호는 0600 환경 파일의 `MYSQL_TRUSTSTORE_PASSWORD`로 분리한다. `deploy/verify-mysql-tls.sh`는 일회용 CA로 정상 연결·다른 CA·호스트 불일치·평문 서버 거부를 확인한다.

## 사전 검사

Java 25·Node 24·Docker·OpenSSL·Python·Chromium이 있는 격리 환경에서 실행한다. CI의 `verify` 작업과 같다.

```sh
./gradlew --no-daemon clean build prepareMysqlTlsVerification
npm ci
npx playwright install --with-deps chromium
bash deploy/verify-config.sh
bash deploy/verify-mysql-tls.sh build/verification/mysql-connector-j-*.jar
python3 deploy/verify-runtime.py
```

마지막 검사는 누락 열로 기동 거부, 열 추가 후 기존 값 보존·기동, 두 HTTPS 사이트의 실제 Chromium 인증, DB 중단 시 JDBC 세션 503, 인증 상태 유실 후 기동 거부, 세션 전량 폐기 복구를 확인한다.
