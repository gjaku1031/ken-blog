# 2026-10-03 리뷰 변경의 운영 전환

이 문서는 코드 변경의 배포 절차이며 운영 DB에 자동 실행되지 않는다. 기존 API는 `7299253`, 새 API는 필수 `baseVersion` 편집 계약과 공개 스냅샷 v3를 사용한다.

## 기존 DB

1. 먼저 같은 변경의 Pages 빌더가 v2/v3를 모두 읽도록 준비하고 관리자 유지보수 시간을 정한다. DB 백업과 복구 가능 여부를 확인하고 API 쓰기를 중지한다. `admin_auth_state`와 `content_state`가 각각 `id=1` 한 행인지 확인한다. 인증 상태가 없으면 일반 설치 SQL로 복구하지 않고 아래 사고 복구 절차를 사용한다.
2. 복사 DB에서 `deploy/sql/review-2026-10-03.sql`을 먼저 실행한다. 운영에는 `posts.edit_version`과 `admin_login_sources`가 아직 없는지 확인한 뒤 같은 SQL을 한 번 적용한다. 재실행은 중복 열·테이블 오류로 멈춘다. 옛 `body`, `body_sha256`, `series_order`는 변경하지 않는다.
3. 사설 CA를 포함한 MySQL TLS 연결을 검증한다. JDBC URL은 `sslMode=VERIFY_IDENTITY`이며 URL 호스트명이 서버 인증서 SAN과 일치해야 한다. IP로 바꾸거나 `REQUIRED`, `trustServerCertificate`로 우회하지 않는다. 공인 CA이면 JRE truststore, 사설 CA이면 검토한 CA만 가져온 PKCS12 truststore를 사용한다.
4. 사설 CA 예: `keytool -importcert -alias mysql-ca -file /secure/mysql-ca.pem -keystore /secure/mysql-truststore.p12 -storetype PKCS12`. 비밀번호는 프롬프트로 입력한다. `KEN_BLOG_MYSQL_TRUSTSTORE`에 파일 경로를 지정하고 `compose.mysql-tls.yaml`을 추가한다. API의 UID 10001/GID 1001이 파일을 읽을 수 있도록 소유권·권한을 준비한다. JDBC URL에는 `trustCertificateKeyStoreUrl=file:/run/ken-blog/mysql-truststore.p12`, `trustCertificateKeyStoreType=PKCS12`, URL 인코딩한 `trustCertificateKeyStorePassword`를 운영 0600 환경 파일에만 기록한다. 정상 CA/호스트만 성공하고 잘못된 CA, SAN 불일치, TLS 없는 서버는 실패해야 한다.
5. `AUTH_PROXY_KEY`에 최소 32자의 무작위 값을 준비하여 API와 Caddy에 동일하게 주입한다. Caddy가 출처 IP와 공유 키 헤더를 덮어쓴다. 외부 8080 접근은 금지하고 기존 loopback 바인딩을 유지한다. 공유 키가 없는 개발 환경은 직접 연결 주소로 제한한다.
6. 새 이미지를 `APP_JPA_DDL_AUTO=validate`, `APP_SQL_INIT_MODE=never`로 기동한다. production Compose는 이 값을 고정한다. 스키마 불일치로 기동이 실패하면 DDL 자동 갱신으로 전환하지 않고 누락된 변경을 확인한다. 준비하지 않은 이미지를 운영에 먼저 배포하지 않는다.
7. 준비한 v2/v3 호환 빌더로 새 API의 스냅샷을 수집하여 Pages를 빌드·배포한다. 새 API에서 구 관리자 화면의 저장은 400이고, 새 관리자 화면의 전체 목록 API는 구 서버에 없으므로 두 전환 사이에는 관리자 작업을 재개하지 않는다. Pages 배포 후 관리자는 페이지를 새로고침한다. 호환용 무버전 쓰기 우회는 제공하지 않는다.
8. 정상 로그인, 출처별 제한, GET/HEAD 공개 이미지, 글 편집 409, 공개 메타데이터 비교와 원고·이미지 실제 반영을 확인한다. 메타데이터 일치 표시는 원고/이미지 배포 완료를 보증하지 않는다.

롤백 시 앱·Pages를 함께 이전 버전으로 되돌린다. 추가 열/테이블은 남겨 두며 자료를 지우지 않는다. 이전 앱의 자동 인증 행 초기화 결함도 돌아오므로 인증 상태 행이 존재하는지 확인하고 롤백 기간을 제한한다.

## 신규 빈 DB

JPA 전체 생성 DDL은 `./gradlew generateJpaSchema`의 `build/generated/jooq/schema.sql`을 검토하여 **빈 DB에만** 명시적으로 적용한다. 기존 DB에는 이 생성 스크립트를 실행하지 않는다. 이어 `deploy/sql/bootstrap-auth.sql`, `INSERT INTO content_state (id) VALUES (1);`을 한 번 실행한다. 관리자 `users` 행은 기존 운영 계약대로 별도 직접 등록한다. bootstrap SQL은 중복 인증 상태에서 실패하며 일반 앱 시작에는 포함되지 않는다. 개발 환경도 첫 설치에서만 같은 인증 bootstrap이 필요하다. 테스트는 격리 MySQL의 init script로 명시적으로 설치한다.

## 인증 상태 유실 복구

API를 중지하고 사고 원인을 확인한 뒤 `deploy/sql/recover-auth-state.sql`을 명시적으로 실행한다. 모든 JDBC 세션과 실패 출처가 삭제되므로 모든 브라우저가 다시 로그인해야 한다. 새 API를 기동하여 설정 지문/인증 버전 동기화를 확인한다. 백업의 `SPRING_SESSION*`만 따로 복원하지 않는다. 정상 재시작은 인증 상태를 재생성하지 않는다.

## 로그인 제한의 범위

한 출처는 첫 실패부터 60초 동안 실패 5회까지 검사하며 이후 요청은 기간을 연장하지 않고 거부한다. IPv6는 /64로 묶고 DB에는 주소 해시만 기록한다. 만료 행은 로그인 시 제거하고 활성 행은 최대 4,096개다. 모든 인스턴스는 인증 상태 행 잠금으로 직렬화하며 전체 비밀번호 검증은 60초당 30회다. 출처가 차단된 요청은 전체 연산 예산을 소비하지 않는다. 성공한 출처의 실패 상태는 초기화하지만 전역 연산 예산은 초기화하지 않는다.

분산 공격이 전역 연산 한도를 소진하면 정상 로그인도 제한될 수 있다. 기존 인증 세션은 계속 동작한다. 외부 로그인 접근은 유지하며, 공격 중 운영 복구는 방화벽에서 공격 출처를 제한하거나 운영자가 허용한 VPN 경로를 사용한다. 단순 출처 제한으로 모든 서비스 거부 공격이 해소된다고 보지 않는다. 공유 프록시 키와 모든 운영 환경 값은 로그·브라우저·저장소에 노출하지 않는다.

## 로컬 파일 경계

이미지는 운영자가 사전에 준비한 불변 파일을 읽기 전용으로 마운트한다. 루트와 모든 부모 디렉터리는 신뢰한 운영자 소유이며 비신뢰 사용자가 이름·마운트를 바꾸지 못해야 한다. 파일 교체는 API를 중지하거나 새 객체 키를 준비하여 처리한다. 현재 `NOFOLLOW_LINKS`는 마지막 경로 요소에 적용되므로 악의적인 로컬 작성자와 동시에 디렉터리를 교체하는 위협까지 보장하지 않는다.

TLS 검사 도구 `deploy/verify-mysql-tls.sh`는 일회용 CA와 인증서를 만들어 앱과 같은 Connector/J로 정상 연결·다른 CA·호스트 불일치·평문 서버 거부를 확인한다. MySQL 8.4의 검사 서버에서 `tls_version` 빈 값으로 TLS를 끄는 방법은 [MySQL 공식 TLS 문서](https://dev.mysql.com/doc/refman/8.4/en/encrypted-connection-protocols-ciphers.html)를 따른다. 운영 CA·SAN·네트워크와의 연결 확인은 별도로 필요하다.

## 반복 가능한 사전 검사

Java 25·Node 24·Docker·OpenSSL·Python과 Chromium이 있는 격리 환경에서 실행한다. 모든 DB·인증서·계정은 검사 전용으로 생성하며 운영 환경 파일을 읽지 않는다.

```sh
./gradlew --no-daemon clean build prepareMysqlTlsVerification
npm ci
npx playwright install --with-deps chromium
bash deploy/verify-config.sh
bash deploy/verify-mysql-tls.sh build/verification/mysql-connector-j-*.jar
python3 deploy/verify-review-runtime.py
```

마지막 검사는 이전 열 구성을 재현한 DB에서 누락 열로 기동 거부, 명시 이관 후 기존 값 보존·기동, 두 HTTPS 사이트의 실제 Chromium 인증, 실제 DB 중단 시 JDBC 세션 503, 인증 상태 유실 후 기동 거부, 세션 전량 폐기 복구를 확인한다. 브라우저는 검사 컨텍스트에서 일회용 자체 서명 인증서를 허용한다. 운영 인증서 신뢰와 실제 Pages origin, Safari·Firefox 지원을 검증한 것으로 간주하지 않는다.
