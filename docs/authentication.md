# 관리자 로그인과 MySQL 세션

P1-02는 내부 관리자 로그인을 위한 서버 세션 기반. 관리자 게시글 초안 API와 이미지 첨부 API는 이후 단계에서 추가. P1-04B의 출간 글 익명/로그인 권한별 조회와 P1-04의 선택적 Redis Cloud 공개 본문 캐시는 2026-09-26 격리 검증 후 main·CI·Pages 반영 완료. 캐시는 계정·세션·CSRF를 받지 않음. P1-05A 분류·태그 공개 GET의 권한·CORS 확장도 같은 날 격리 HTTP 검증 후 main·CI·Pages 반영 완료. 공개 회원가입·회원 관리 화면은 현재 없음. P2-01의 정적 로그인 화면은 로컬 브라우저 인증·만료·늦은 응답 검증 후 main `fa86abc`·[CI](https://github.com/gjaku1031/ken-blog/actions/runs/36223462342)·[Pages](https://github.com/gjaku1031/ken-blog/actions/runs/36223462339) 반영 완료. 초기 계정은 자동 생성되지 않으며 로컬 운영자가 외부 설정을 명시할 때만 한 명 준비. 공개 HTTPS API 주소와 도메인은 아직 미정이므로 외부 로그인 운영 없음.

Kotlin 소스는 역할별 패키지에 배치. `account/domain`은 저장 계정과 역할, `account/repository`·`account/service`·`account/bootstrap`은 조회·준비 흐름, `auth/controller`·`auth/dto`·`auth/service`는 HTTP 계약과 인증 처리, `global/config`·`global/security`·`global/error`는 공통 보안 설정과 오류 응답 담당. Spring 진입점은 공통 상위 패키지에 두어 하위 컴포넌트를 탐색.

## 계정과 초기 준비

Flyway V2가 `users` 표와 대소문자를 구분하는 고유 `username`, `{bcrypt}` 접두사가 있는 `password_hash`, `ADMIN`·`USER` 역할, UTC 생성 시각을 추가. 초기 준비는 `BOOTSTRAP_ADMIN_USERNAME`과 `BOOTSTRAP_ADMIN_PASSWORD_HASH`가 모두 비어 있으면 생략. 두 값을 모두 공급하면 빈 표에 관리자 한 명 생성. 이름은 소문자 ASCII로 시작하고 영숫자·밑줄·하이픈을 허용하는 3~64자. 해시는 BCrypt 비용 10~14의 60자 인코딩 결과에 `{bcrypt}` 접두사를 붙인 값. 아래 생성 예시는 비용 12. 일반 사용자 역할은 현재 권한 검증과 후속 확장용 스키마에만 존재하며 생성 API 없음.

기존 관리자 한 명이 있으면 다시 준비하지 않고 DB의 기존 해시 유지. 외부 해시를 바꿔 재시작해도 비밀번호가 바뀌지 않음. 기존에 다른 계정이 있거나 동명 `USER`가 있으면 관리자 자동 승격 없이 기동 실패. 비밀번호 교체는 아직 공개 API에 없으며 DB 변경은 별도 운영 절차가 필요한 후속 작업.

로컬 `.env`에 관리자 정보를 넣을 때에는 `$`가 포함된 BCrypt 해시를 **단일따옴표**로 감싸야 Compose가 다시 보간하지 않음. 다음 명령은 루트의 `.env.example`을 바탕으로 비밀값 파일을 만들고, 비밀번호를 터미널 입력에서 숨겨 해시를 직접 파일에 저장. Python의 `bcrypt` 패키지 필요. 기존 `.env`에 DB 비밀번호가 있다면 해당 파일은 유지하고 두 관리자 설정만 교체. 새 `.env`의 빈 `DB_PASSWORD`·`MYSQL_ROOT_PASSWORD`는 서로 다른 로컬 값으로 별도 입력 필요.

```sh
cp -n .env.example .env
chmod 600 .env
python3 - <<'PY'
import getpass
import re
from pathlib import Path

import bcrypt

username = input("초기 관리자 이름: ")
if not re.fullmatch(r"[a-z][a-z0-9_-]{2,63}", username):
    raise SystemExit("관리자 이름 형식 오류")
password = getpass.getpass("초기 관리자 비밀번호: ")
raw = password.encode("utf-8")
if not 1 <= len(raw) <= 72:
    raise SystemExit("비밀번호는 UTF-8로 1~72바이트 필요")
encoded = "{bcrypt}" + bcrypt.hashpw(raw, bcrypt.gensalt(rounds=12)).decode("ascii")
path = Path(".env")
settings = path.read_text(encoding="utf-8")
for key, value in (("BOOTSTRAP_ADMIN_USERNAME", username), ("BOOTSTRAP_ADMIN_PASSWORD_HASH", f"'{encoded}'")):
    settings, count = re.subn(rf"^{key}=.*$", lambda _: f"{key}={value}", settings, flags=re.MULTILINE)
    if count != 1:
        raise SystemExit(f"{key} 설정 줄 확인 필요")
path.write_text(settings, encoding="utf-8")
PY
```

해시 문자열은 문법·비용 형식까지 검증하지만 비밀번호의 출처나 강도 보증은 하지 않음. 로그인 비밀번호는 앞뒤 공백을 제거하지 않고 그대로 비교. UTF-8로 72바이트 초과 시 다른 잘못된 계정 정보와 같은 HTTP 401을 반환.

## HTTP 흐름

| 요청 | 접근과 응답 |
| --- | --- |
| `GET /api/v1/auth/csrf` | 익명 허용. `headerName`=`X-CSRF-TOKEN`과 현재 세션의 `token` 반환, 세션 쿠키 발급 |
| `POST /api/v1/auth/login` | JSON `username`·`password`와 현재 쿠키·CSRF 헤더 필요. 성공 시 새 세션 ID, `username`·`role` 반환 |
| `GET /api/v1/auth/me` | 유효한 세션 필요. 이름·역할만 반환 |
| `POST /api/v1/auth/logout` | 유효한 세션과 현재 CSRF 헤더 필요. 세션·CSRF 삭제 후 HTTP 204 |

로그인 전 `/csrf`를 먼저 호출하고 받은 쿠키와 토큰을 로그인에 함께 전송. 로그인 성공 시 세션 ID가 바뀌고 기존 CSRF 토큰도 제거되므로 `/csrf`를 다시 호출한 뒤 로그아웃 등 변경 요청에 사용. 로그아웃 뒤 이전 쿠키로 `/me` 접근 불가. 미인증은 HTTP 401, 역할 부족·CSRF 누락/불일치는 HTTP 403, MySQL 연결 장애는 HTTP 503의 `application/problem+json` 응답. 없는 계정과 틀린 비밀번호의 공개 오류 설명은 동일. 필터 경계 밖의 예외 원문이나 저장된 해시를 응답에 넣지 않음.

`/api/v1/admin/` 아래는 `ADMIN` 역할만 허용. 관리자 기능은 [게시글 작성·출간](posts.md)과 [이미지 첨부](attachments.md) API이며, P2-02A의 [별도 편집본 API](editor-drafts.md)는 격리 검증 후 main·CI·Pages 반영 완료. 테스트 전용 경로에서도 `USER`의 403을 검증. P1-04B 공개 GET `/api/v1/posts`와 `/api/v1/posts/{slug}`는 익명 접근 허용하되 출간·가시성 필터는 서비스/DB 조회에서 적용. 익명 인증 토큰의 `isAuthenticated`만으로 비공개 읽기를 허용하지 않고 `ROLE_USER`·`ROLE_ADMIN`만 인정. 이 `USER` 읽기 권한은 계정 발급·회원 관리 화면의 완료를 뜻하지 않음. `/api/v1/status`, `/actuator/health`, OpenAPI·Swagger UI의 공개 GET도 익명으로 접근 가능. 테스트 전용 오류 경로는 운영 JAR에 포함되지 않음.

## 쿠키·CORS와 MySQL

Spring Session JDBC가 기존 MySQL의 `SPRING_SESSION`·`SPRING_SESSION_ATTRIBUTES`에 인증 컨텍스트와 CSRF 토큰을 저장. Flyway V3가 현재 Spring Session 4.1.1 내장 MySQL 스키마를 적용하며 `spring.session.jdbc.initialize-schema=never`로 자동 중복 생성을 막음. 세션 비활동 한도는 마지막 접근부터 30분이며 만료 세션 행은 기본 작업이 매분 정리. 만료 즉시 인증은 거부되고 실제 행 삭제는 이후 정리 시점일 수 있음. API만 재시작해도 DB의 유효 세션을 읽으며, MySQL 연결 장애 시 메모리 세션으로 대체하지 않음. 쿠키 이름은 `KENBLOGSESSION`, `HttpOnly`, `SameSite=Lax`; 기본 `Secure=true`. HTTP 로컬 검증에서만 `SESSION_COOKIE_SECURE=false`를 명시. 쿠키는 호스트 전용이며 공개 도메인 설정 전까지 HTTPS 외부 로그인 없음.

Redis Cloud 캐시의 기본값은 비활성. 활성화해도 각 익명 상세의 `PUBLISHED`·`PUBLIC` 판단은 MySQL에서 수행하며 비공개/회원 상세·관리자 응답·세션/CSRF·계정 정보는 Redis 조회/저장 대상이 아님. Redis 중단은 DB 원본 본문 조회로 돌아가고, MySQL 중단은 캐시만으로 권한을 판단하지 않아 기존 503 경계 유지. 외부 캐시 설정과 확인 범위는 [캐시 안내](cache.md) 참고.

공개 상태 조회와 P1-04B 출간 글 GET은 `APP_CORS_ALLOWED_ORIGINS`에 적힌 정확한 origin에서만 허용. P1-05A 공개 분류·태그 GET에도 같은 origin 규칙 적용. 공개 origin에는 자격 증명 CORS 응답을 허용하지 않음. 이는 브라우저의 교차 출처 응답 접근 규칙이며 서버가 전달된 쿠키를 별도로 무시한다는 뜻이 아님. 인증 API와 쿠키가 있는 글·분류·태그 GET은 별도 `APP_AUTH_CORS_ALLOWED_ORIGINS`가 비어 있으면 교차 출처 자격 증명 요청 비허용. 같은 호스트의 로컬 정적 화면에서 시험할 때만 예를 들어 `http://127.0.0.1:14000`을 명시. 인증 origin의 인증 API에는 GET·POST와 `X-CSRF-TOKEN` 헤더에만 자격 증명 CORS 허용하며, 글·분류·태그 GET에도 같은 origin의 자격 증명 허용. 공개/인증 글·분류·태그 조회 성공 응답은 `Cache-Control: no-store`; 비공개 응답에 공개 캐시 사용 없음. P1-05A의 CORS·no-store는 격리 HTTP에서 확인. GitHub Pages 기본 도메인과 별도 API 도메인의 타사 쿠키 동작은 공개 HTTPS 도메인 준비 후 검증할 후속 결정.

P2-06A 위키 제목 조회 `GET /api/v1/wiki-links/resolve`도 같은 공개/인증 origin 구분을 적용. 익명은 PUBLIC 이동 정보, PRIVATE는 대상 메타데이터 없는 `LOCKED`만 받으며 USER·ADMIN 세션에서만 PRIVATE 이동 정보를 받음. 공개 origin의 자격 증명 CORS는 비허용, 인증 origin의 자격 증명 GET만 허용. POST 허용이나 CSRF 예외 추가 없음. 2026-09-26 격리 HTTP에서 익명·USER·ADMIN·로그아웃별 결과, 공개/인증 origin CORS, POST 거부와 no-store를 확인. DB 중단 시 익명·로그인 요청 503과 복구 뒤 같은 로그인 세션 유지, 최종 JAR의 공개/관리자/로그아웃 응답과 OpenAPI 계약도 재확인. main·CI·Pages 반영은 아직 전. 상세 입력·응답 경계는 [위키 제목 조회](wiki-links.md) 참고.

P2-02A 편집본 API는 `/api/v1/admin/editor-drafts` 아래 GET·POST·PUT·DELETE와 출간 POST를 `ADMIN` 세션에만 허용. 쓰기에는 기존 CSRF 보호, 성공 응답에는 `no-store` 적용. `APP_AUTH_CORS_ALLOWED_ORIGINS`의 정확한 origin에만 자격 증명 CORS를 허용하고, 공개 origin의 관리자 편집본 GET 접근은 허용하지 않음. 2026-09-26 격리 HTTP에서 익명·USER 차단, ADMIN/CSRF, 명시 인증 origin의 자격 증명 CORS와 공개 전용 origin의 편집본 거부를 확인. main `19b884a`·[CI](https://github.com/gjaku1031/ken-blog/actions/runs/36224536190)·[Pages](https://github.com/gjaku1031/ken-blog/actions/runs/36224536203) 반영 완료. 공개 Pages origin을 인증 허용 목록에 넣지 않았고 공개 HTTPS API 배포도 없음.


P2-02B의 `/write/`와 `/admin/drafts/`는 ADMIN 세션을 확인하고, 익명은 안전한 내부 `returnTo`를 거쳐 로그인으로 이동하며 USER에게는 권한 안내를 표시하는 계약. 수동 저장·삭제·출간은 현재 CSRF 토큰을 사용. 로그아웃·세션 만료·계정 전환 때 편집 중인 관리자 원문과 늦게 도착한 응답을 화면에서 폐기하며 원고·쿠키·CSRF 토큰을 `localStorage`에 저장하지 않음. 기존 편집본 경로의 CORS는 유지. 관리자 글 목록·상세와 관리자 분류·태그 GET의 자격 증명 CORS는 정확히 지정한 인증 origin에만 추가. 2026-09-26 API `clean verify`에서 기존 검사 28개 통과, 격리 JAR GET의 인증 origin credential 응답 확인. 같은 경로의 POST·PUT·PATCH·DELETE와 공개 전용 origin GET의 preflight는 `403` 확인. 이 추가 조회 CORS는 `USER` 권한을 허용하는 변경이 아님. 격리 Chrome에서는 SQL의 CSRF 속성을 제거한 쓰기 `403` 뒤 원고 보존·재시도 성공, 세션 만료 뒤 원고 제거, 지연된 편집본 상세 응답의 로그아웃 뒤 폐기를 확인. 화면의 전체 검증 상태는 [편집 화면](editor.md) 참고. 공개 HTTPS API와 실사이트 인증 연결은 없음.

## P2-01 로컬 브라우저 연결

정적 화면 `http://127.0.0.1:14000/ken-blog/`과 API `http://127.0.0.1:18081`은 포트가 달라 서로 다른 origin. 호스트는 둘 다 `127.0.0.1`로 유지해야 호스트 전용 세션 쿠키를 공유. API를 로컬 HTTP로 실행할 때에만 `SESSION_COOKIE_SECURE=false`를 설정하고, `APP_CORS_ALLOWED_ORIGINS`에는 공개 GET용 로컬 origin, `APP_AUTH_CORS_ALLOWED_ORIGINS`에는 로그인과 회원 읽기용 같은 origin을 명시. 정확한 빌드·실행 예시는 [런타임 안내](runtime.md) 참고. 공개 Pages origin을 인증 허용 목록에 추가한 결과나 공개 HTTPS 로그인 성공은 아직 없음.

P2-01 화면은 익명 글·분류·태그 조회에 쿠키를 보내지 않고, 로그인 화면에서 `GET /api/v1/auth/csrf`로 세션 쿠키와 토큰을 받은 뒤 쿠키와 `X-CSRF-TOKEN` 헤더를 포함해 로그인 요청. 로그인 응답으로 사용자 상태를 갱신하고 새 세션의 CSRF 토큰을 다시 받은 뒤, 회원 글 조회 전 `/me`로 세션 유효성을 재확인. 회원 조회에만 자격 증명을 포함. 로그아웃에도 새 세션의 CSRF 토큰을 전송. 로그인 실패·로그아웃·세션 만료 401에서는 화면의 회원 전용 본문과 사용자 정보를 제거하고 이전 요청의 늦은 응답이 다시 표시되지 않도록 구성. 서버 로그아웃에 실패하면 화면 데이터는 먼저 지우되 세션 폐기 실패를 별도 안내. 비밀번호·CSRF 토큰·세션 ID를 브라우저 영구 저장소에 넣지 않으며 JWT를 사용하지 않음.

2026-09-26 격리 Chrome에서 잘못된 비밀번호의 거부, USER의 CSRF 로그인과 원래 PRIVATE 글로 복귀, 로그아웃 후 본문 제거, ADMIN 로그인 확인. 실제 JDBC 세션 만료 시각을 앞당긴 뒤 탭 복귀의 `/me` 재확인으로 잠금 화면 전환 확인. 자연 상태에서 30분을 기다린 만료 검증은 아님. 인증된 본문 응답을 받았지만 반환을 지연한 상태에서 로그아웃해도 PRIVATE 본문이 다시 표시되지 않는 것을 화면 변화 관찰로 확인. 격리 API 중단 시 연결 오류와 재시작 후 화면 재시도 복구도 확인. 공개 HTTPS API 연결·실사이트 로그인 성공으로 해석하지 않음.

## 검증

이번 P1-02A에서 `cd apps/api && ./mvnw -B -ntp -DskipTests clean package`로 운영 코드와 기존 테스트를 컴파일하고 실행 JAR를 생성. 테스트 실행은 생략했으므로 CI 결과와 구분. 기존 실제 TCP 서버 테스트는 Testcontainers MySQL 8.4.11에서 CSRF·로그인·세션 ID 교체·로그아웃·권한과 JDBC 세션 행의 삭제·만료 거부를 검사하도록 변경. JDBC 세션의 만료 시각을 시험용으로 앞당기는 검사는 자연 상태로 30분 기다린 결과가 아님.

2026-09-25 격리 MySQL·실행 JAR의 실제 HTTP에서 CSRF 발급 200, 누락·잘못된 토큰 403, 로그인 200과 세션 ID 교체, `/me` 200, 로그인 전 CSRF 재사용 403 확인. API만 재시작한 뒤 같은 쿠키의 `/me`는 200. 검증용 MySQL을 중단하면 `/me`·`/csrf`·`/login`이 각각 내부 연결 정보를 배제한 503 `ProblemDetail` 반환, DB 복구 후 `/me` 200, 로그아웃 204, 이전 쿠키 `/me` 401 확인. 테스트용 JDBC 세션의 시간 필드를 과거로 바꾸면 `/me` 401; 별도로 HTTP 조회하지 않은 만료 세션·속성 행은 약 58초 후 매분 정리 작업으로 삭제됨. 자연 상태로 30분을 기다린 검증은 아님. Buildpacks 이미지 생성 후 별도 Compose의 MySQL·API만 기동해 health·status `UP` 확인. 로컬에서는 테스트 실행을 생략했고, [원격 CI](https://github.com/gjaku1031/ken-blog/actions/runs/36151614912)는 기존 28개 테스트를 실패·오류·건너뜀 없이 완료.

참고: [Spring Security 세션 인증 저장](https://docs.spring.io/spring-security/reference/servlet/authentication/session-management.html), [Spring Security CSRF](https://docs.spring.io/spring-security/reference/servlet/exploits/csrf.html), [Spring Session JDBC](https://docs.spring.io/spring-session/reference/guides/boot-jdbc.html), [Spring Session JDBC 만료 정리](https://docs.spring.io/spring-session/reference/configuration/jdbc.html), [Docker Compose `.env` 보간](https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/).
