# 운영 API 이미지 교체

CI가 만든 ARM64 JVM 이미지를 운영 서버(`oci-prod`, `/srv/ken-blog-live`)에 반영하는 반복 절차. 열을 추가·삭제하는 변경은 확장-축소 순서로 이관 SQL과 이미지 교체를 나눈다.

## 자동 배포

`main`의 CI(`.github/workflows/ci.yml`)가 이미지 검사를 통과하면 `deploy` 작업이 운영 API를 교체한다.

1. `jvm-image`: ARM64 JVM 이미지 생성·실행 검사, `deploy/tests/release-test.sh`로 교체·롤백 검사, 아카이브와 SHA-256 보관.
2. `schema-approval`: 직전 push 이후 `deploy/sql/`이 바뀌었거나 비교할 커밋이 없으면(수동 실행) Environment `production-schema`의 승인을 기다린다. 승인 전에 아래 '스키마 변경' 순서로 SQL을 적용한다.
3. `deploy`: GitHub OIDC로 tailnet에 일회용 노드(`tag:ci`)로 들어와, 배포 키로 아카이브를 서버에 표준 입력으로 보낸다. 끝나면 공개 주소의 health와 스냅샷을 확인한다.

서버는 배포 키로 `/usr/local/sbin/ken-blog-release`(저장소의 `deploy/release.sh` 사본)만 실행한다.

1. 인자 형식(`jvm-<커밋> <SHA-256>`)과 아카이브 SHA-256·이미지 이름·ARM64 확인 후 `docker load`.
2. `production.env`의 `KEN_BLOG_API_IMAGE`를 바꾸고, Compose 파일 두 개로 API만 재생성해 healthcheck가 healthy가 될 때까지 기다린다.
3. 로컬 API 포트에서 스냅샷·CSRF·기술 아이콘 200과 기동 이후 ERROR 로그 없음을 확인한다.
4. 실패하면 이전 이미지로 되돌려 다시 healthy를 기다린다. 결과는 `releases/history.log`에 남는다.

종료 코드: 0 성공·이미 배포됨, 64 인자 오류, 65 아카이브 불일치, 70 롤백 성공, 71 롤백 실패, 75 다른 배포 진행 중.

## Compose 명령의 기준

운영 DB는 사설 CA의 TLS로 연결하므로 API는 truststore 마운트가 필요하다. 수동으로 Compose를 실행할 때도 두 파일을 함께 지정한다.

```bash
cd /srv/ken-blog-live
docker compose --env-file production.env \
  -f deploy/compose.production.yaml \
  -f deploy/compose.mysql-tls.yaml \
  up -d --no-deps --wait api
```

`compose.production.yaml` 하나로 API를 재생성하면 `/run/ken-blog/mysql-truststore.p12`가 없어 JPA 초기화 단계에서 기동이 실패하고 재시작을 반복한다. 2026-10-07 수동 배포와 롤백에서 이 누락으로 API가 약 6분간 중단됐고, 이후 배포 스크립트가 두 파일을 고정한다.

## 수동 배포

CI 배포 작업을 쓸 수 없을 때는 CI artifact를 받아 서버에서 같은 스크립트를 실행한다.

```bash
sudo ken-blog-release "jvm-<커밋> $(cut -d' ' -f1 image.tar.gz.sha256)" < image.tar.gz
```

## 서버 구성 변경

Compose 파일·Caddyfile·`release.sh`는 자동 배포 대상이 아니다. 바뀌면 검토 후 서버의 `/srv/ken-blog-live/deploy/`와 `/usr/local/sbin/ken-blog-release`에 직접 반영한다. 배포 키가 실행하는 스크립트를 CI가 바꿀 수 없게 하기 위함이다.

## 배포 키와 접근 경계

| 경계 | 설정 |
| --- | --- |
| 네트워크 | 배포 키는 tailnet 주소(`from=`)에서만 유효. CI 노드는 GitHub OIDC로 `tag:ci`를 받으며, ACL은 `tag:ci`에서 서버 22번 포트만 허용 |
| tailnet 진입 | Tailscale 신뢰 자격 증명의 subject를 `repo:gjaku1031@150967087/ken-blog@1387307910:environment:production`으로 제한(저장소가 변하지 않는 ID 형식 subject를 씀). GitHub에 Tailscale 비밀값 없음 |
| SSH 키 | 사용자 `ken-deploy`의 `authorized_keys`에 `restrict,from="100.64.0.0/10",command="sudo -n /usr/local/sbin/ken-blog-release \"$SSH_ORIGINAL_COMMAND\""` |
| 권한 | sudoers는 `ken-deploy`에 `/usr/local/sbin/ken-blog-release` 실행만 허용. 스크립트는 root 소유 0755 |

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
