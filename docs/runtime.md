# 정적 프론트와 로컬 API 실행

현재 프론트는 GitHub Pages에 올리는 Next.js 정적 파일. 브라우저가 Spring의 공개 글·분류·태그 및 인증 API를 직접 호출하는 구조. 공개 HTTPS API 주소는 아직 미설정. Spring API는 Cloud Native Buildpacks의 JVM 이미지로 생성하고, 이 문서의 Compose는 API·개발 MySQL을 실행. [게시글 저장 기반](persistence.md)은 API 내부 기능이며 [관리자 로그인](authentication.md)은 MySQL에 저장하는 서버 세션 기반. 관리자 이미지 첨부는 [비공개 OCI Object Storage](attachments.md)에 선택적으로 연결. P1-04의 [Redis Cloud 공개 본문 캐시](cache.md)는 기본 비활성으로 격리 검증·main·CI·Pages 반영 완료이며 Compose에 Redis 서비스를 추가하지 않음.

## Spring 이미지와 API 실행

ARM64 호스트에서 Java 25 JVM 이미지 생성. Spring Boot Maven 플러그인이 Paketo `builder-noble-java-tiny:0.0.152`를 사용하며 API Dockerfile은 없음. 저장소 루트에서 `.env.example`을 Git 제외 대상 `.env`로 복사해 `DB_PASSWORD`와 `MYSQL_ROOT_PASSWORD`를 서로 다른 로컬 값으로 채운 뒤 실행. 로컬 HTTP에서 인증 쿠키까지 검증하려면 `.env`의 `SESSION_COOKIE_SECURE=false`; 초기 관리자 준비 절차는 [관리자 로그인](authentication.md)에 기록:

```sh
cd apps/api
./mvnw -B -ntp spring-boot:build-image -DskipTests
cd ../..
docker compose -p ken-blog-p102 up -d --no-build
docker compose -p ken-blog-p102 ps
curl -fsS http://127.0.0.1:18081/api/v1/status
curl -fsS http://127.0.0.1:18081/actuator/health
```

이미지 이름 `ken-blog-p004-api:local`은 앞 단계에서 정한 로컬 태그. JDBC 세션과 첨부 기능의 현재 코드를 포함하려면 이미지 재빌드 필요. Compose는 API 컨테이너의 8080을 호스트의 `127.0.0.1:18081`에, MySQL의 3306을 `127.0.0.1:13306`에만 연결. 새 프로젝트에 Redis 서비스는 없음. 기존 8080 앱과 Redis는 별도 환경으로 유지. [루트 `.env.example`](https://github.com/gjaku1031/ken-blog/blob/main/.env.example)의 포트나 개발 DB 비밀번호는 `.env`에서 설정. 외부 공개 주소와 HTTPS 설정은 현재 없음.

OCI Object Storage 연결에는 `OCI_OBJECT_STORAGE_ENDPOINT`·`OCI_OBJECT_STORAGE_REGION`·`OCI_OBJECT_STORAGE_BUCKET`·`OCI_OBJECT_STORAGE_ACCESS_KEY`·`OCI_OBJECT_STORAGE_SECRET_KEY`를 외부 설정으로 주입. 다섯 값이 모두 비어 있으면 앱은 기동하지만 첨부 경로는 503, 일부만 채우면 설정 오류로 기동 실패. 선택적 `OCI_OBJECT_STORAGE_KEY_PREFIX` 기본값은 `ken-blog/attachments`. 비밀키를 저장소·빌드 출력·로그에 넣지 않음. 검증에는 기존 객체와 분리한 실행별 접두사를 사용. 구성·장애 처리·정리 절차는 [첨부파일 운영 안내](attachments.md) 참고.

P1-04 외부 캐시는 `CACHE_REDIS_ENABLED=false` 기본값에서 연결하지 않음. 활성 시 `CACHE_REDIS_HOST`를 지정하고 공급자의 port·username·password·TLS 지원 여부를 확인해 `CACHE_REDIS_PORT`·`CACHE_REDIS_USERNAME`·`CACHE_REDIS_PASSWORD`·`CACHE_REDIS_TLS`를 저장소 밖에서 공급. 기본 TLS 값은 `true`이며 서버가 지원할 때만 사용; 인증서 검증 우회 없음. `CACHE_REDIS_PREFIX` 기본 `ken-blog:public-posts`, `CACHE_REDIS_TTL_SECONDS=300`, 연결/명령 timeout 각각 300ms. Compose는 외부 설정을 API에만 전달하고 Redis 컨테이너·포트·볼륨을 만들지 않는 계약. 활성화해도 첫 연결은 서버 준비 뒤 백그라운드에서 수행하고 준비 중·연결 실패 뒤 5초 유예 중인 HTTP 요청은 Redis를 기다리지 않고 DB 원문을 사용. 비활성·장애 시 DB 조회로 복귀하지만 DB 장애에는 기존 503 적용. 설정과 키/권한 경계는 [캐시 안내](cache.md) 참고.

기존 Redis Cloud 설정을 **읽기만** 사용한 사전 PING은 `PONG`이었고, 해당 설정의 `CACHE_REDIS_TLS=false`는 평문 연결. 사전 PING 자체는 Java 캐시 기능의 근거가 아니며 이후 격리 JAR·Buildpacks 이미지에서 실제 외부 캐시 키·TTL을 별도로 확인. TLS 연결 성공이나 성능 개선의 근거는 없음. 기존 외부 Redis 정책이나 기존 VM 앱·Redis 실행 자원은 변경하지 않음.

```sh
docker compose -p ken-blog-p102 logs --tail=100 api
docker compose -p ken-blog-p102 stop api
docker compose -p ken-blog-p102 start api
docker compose -p ken-blog-p102 down
```

이미지를 갱신하려면 Buildpacks 명령 재실행 후 `docker compose -p ken-blog-p102 up -d --no-build` 실행. `down`은 이 Compose 프로젝트의 컨테이너·네트워크만 제거하며 MySQL 이름 볼륨과 다른 프로젝트는 유지. API 재시작 뒤에도 MySQL에 있는 유효 세션은 유지. 기존 `ken-blog-p004` Compose 실행 환경은 별개로 유지.

## 정적 웹 빌드

`apps/web`에서 `npm ci` 후 `npm run build`를 실행하면 `out/`에 HTML·CSS·JS·도면 등 정적 파일 생성. Next 서버와 웹 컨테이너는 필요 없음. GitHub Pages 프로젝트 경로에 맞춰 빌드할 때 `NEXT_PUBLIC_BASE_PATH=/ken-blog` 사용. 이 값과 `NEXT_PUBLIC_API_BASE_URL`은 **빌드 시** 공개 JS에 포함되어, 변경 시 재빌드 필요. 공개 변수에 비밀값 입력 금지.

```sh
cd apps/web
npm ci
NEXT_PUBLIC_BASE_PATH=/ken-blog NEXT_PUBLIC_API_BASE_URL= npm run build
```

현재 공개 HTTPS API 주소가 없으므로 Pages 배포 빌드는 위처럼 API URL을 비움. 로컬 미설정 빌드의 Home·Tech·글 상세는 API 요청 없이 구성 안내를 표시하고 실제 글 0건으로 오인시키지 않음을 확인. `http://127.0.0.1:18081`은 같은 VM의 로컬 검증에만 사용하며 Pages 방문자의 브라우저에서 접근할 수 없음. HTTPS Pages에서 HTTP API를 설정해도 브라우저의 혼합 콘텐츠 규칙에 따라 연결 불가. 공개 연결은 후속 HTTPS API 주소 마련 후 별도 빌드·배포 대상.

## 로컬의 두 origin 검증

P2-01 화면은 정적 서버 `http://127.0.0.1:14000`과 API `http://127.0.0.1:18081`의 **포트가 다른 두 origin**에서 격리 검증. 두 주소의 호스트는 모두 `127.0.0.1`로 통일하고 한쪽만 `localhost`로 바꾸지 않음. 같은 호스트의 host-only `KENBLOGSESSION` 쿠키를 사용하지만 포트가 다르므로 정확한 origin CORS 설정이 필요. 로컬 HTTP 로그인 시험에서만 `Secure` 쿠키를 끄고, 초기 ADMIN/USER 계정과 DB는 [인증 안내](authentication.md)에 따라 별도로 준비. 현재 소스로 API 이미지를 재빌드한 뒤 아래 예시처럼 실행:

```sh
APP_CORS_ALLOWED_ORIGINS=https://gjaku1031.github.io,http://127.0.0.1:14000 \
  APP_AUTH_CORS_ALLOWED_ORIGINS=http://127.0.0.1:14000 \
  SESSION_COOKIE_SECURE=false \
  docker compose -p ken-blog-p102 up -d --no-build
```

`APP_CORS_ALLOWED_ORIGINS`는 상태 API와 공개 GET의 origin, `APP_AUTH_CORS_ALLOWED_ORIGINS`는 쿠키가 필요한 인증 API와 회원 글·분류·태그 GET의 credential 허용 origin. 같은 로컬 origin을 두 설정에 적되 Pages 공개 origin에는 인증 허용을 추가하지 않음. 익명 공개 조회 요청은 브라우저에서 쿠키를 제외하고, 로그인 후 회원 조회에서만 자격 증명을 포함하는 P2-01 계약. `SESSION_COOKIE_SECURE=false`는 이 HTTP 로컬 환경 한정이며 공개 HTTPS 환경의 기본 `true`를 바꾸지 않음.

그다음 웹을 로컬 테스트 주소로 재빌드하고 `out/`을 `/ken-blog` 경로에 배치:

```sh
cd apps/web
NEXT_PUBLIC_BASE_PATH=/ken-blog \
  NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:18081 npm run build
mkdir -p /tmp/ken-blog-p201-site/ken-blog
cp -a out/. /tmp/ken-blog-p201-site/ken-blog/
python3 -m http.server 14000 --bind 127.0.0.1 \
  --directory /tmp/ken-blog-p201-site
```

같은 호스트의 브라우저에서 `http://127.0.0.1:14000/ken-blog/` 확인. P2-01의 `trailingSlash` 정적 빌드는 `/ken-blog/tech/`, `/ken-blog/post/?slug=글주소`, `/ken-blog/login/` 직접 열기·새로고침을 지원. `/ken-blog/projects/`와 `/ken-blog/notes/`는 준비 화면. 글 slug는 경로 매개변수가 아니라 `/post/`의 쿼리이며 URL 인코딩 필요. API 중단·복구는 격리 검증 프로젝트에서만 수행하고 정적 파일 서버는 실행한 터미널에서 `Ctrl+C`로 종료.

Spring CORS는 `/api/v1/status`의 지정 origin과 공개 GET을 허용하며 상태 경로에는 credential 허용 헤더가 없음. 인증 API의 자격 증명 CORS는 별도 `APP_AUTH_CORS_ALLOWED_ORIGINS`로만 명시 허용하며 기본 비허용. 동일한 로컬 origin을 두 목록에 넣으면 글·분류·태그 GET에는 credential 허용 CORS 응답을 받을 수 있지만, 익명 공개 fetch가 쿠키를 보낼지는 브라우저 코드의 요청 설정이 결정. CORS는 브라우저의 응답 읽기 정책이며 API 인증이나 네트워크 방화벽을 대체하지 않음. 공개 Pages에는 API HTTPS 주소가 아직 없어 이 로컬 로그인 결과를 실사이트 로그인 완료로 해석하지 않음.

2026-09-26 P2-01 소스의 두 번째 정적 빌드·타입 검사와 기존 npm 검사 7개 통과. 격리 Chrome에서 6개 정적 경로의 직접 접근, Tech 첫 10건에서 전체 14건으로 추가 로드, 분류·태그 URL 필터의 새로고침·뒤로가기와 빈 결과, 익명 PRIVATE 잠금·회원 로그인 후 본문, 잘못된 비밀번호와 로그아웃, Markdown의 표·코드·읽기 전용 할 일·위험 링크와 외부 이미지 자동 요청 차단을 확인. Home·Tech·본문·로그인의 라이트·다크 접근성 검사 8회에서 위반 0건. 320~1440px의 주요 화면에서 페이지 가로 넘침 0이고, 320px의 긴 코드와 8열 표는 키보드로 내부 가로 스크롤 가능. 키보드 본문 건너뛰기, 테마 선택의 새로고침 후 유지, 외부 `returnTo` 차단 확인. 인증 본문 응답을 지연한 뒤 로그아웃해도 PRIVATE 본문이 다시 나타나지 않았고, 격리 API 중단의 연결 오류와 재시작 후 재시도 복구를 확인. 브라우저의 미처리 오류는 없었음. 별도 API 주소 미설정 정적 빌드에서 Home·Tech·글 상세의 구성 안내, API 네트워크 요청 없음, 홈 도면의 두 테마 자산 로드를 확인. main `fa86abc`·[CI](https://github.com/gjaku1031/ken-blog/actions/runs/36223462342)·[Pages](https://github.com/gjaku1031/ken-blog/actions/runs/36223462339) 반영 완료. 현재 Pages API 주소는 여전히 미설정이고 기존 운영 API는 교체하지 않음.

P2-02A는 기존 Compose의 API·MySQL 구성과 공개 Pages 정적 빌드 설정을 바꾸지 않는 편집본 API. 2026-09-26 Maven `clean verify`의 기존 검사 28개와 격리 JAR·MySQL HTTP 검증 통과. V7 기존 글·분류·태그·JDBC 세션의 V8 보존, 편집본의 수동 저장·재시작 후 복원·본문 없는 SQL 목록, 출간·동시 revision·원본 충돌·인위적 실패 롤백, ADMIN/CSRF·CORS·DB 장애 503/복구 확인. Redis 본문 캐시는 편집본을 저장하지 않고 성공 출간의 커밋 후 키를 무효화하며, 실패 롤백에서는 이전 캐시를 보존. 새 Buildpacks 이미지 생성이나 기존 운영 API·MySQL 교체는 하지 않았고 main `19b884a`·[CI](https://github.com/gjaku1031/ken-blog/actions/runs/36224536190)·[Pages](https://github.com/gjaku1031/ken-blog/actions/runs/36224536203) 반영 완료. 상세 근거는 [편집본 계약](editor-drafts.md) 참고. 공개 HTTPS API 주소나 실사이트 관리자 편집 연결은 없음.


P2-02B의 정적 관리자 경로는 `/ken-blog/write/`와 `/ken-blog/admin/drafts/`. 기존 글·편집본 직접 진입은 각각 `/ken-blog/write/?postId=양수`, `/ken-blog/write/?draftId=양수` 쿼리 사용. 같은 `127.0.0.1` 호스트의 로컬 정적 서버와 API, `APP_AUTH_CORS_ALLOWED_ORIGINS`의 정확한 `http://127.0.0.1:14000` 설정, 로컬 HTTP에서만 `SESSION_COOKIE_SECURE=false`라는 위 실행 경계 유지. 편집본 GET·POST·PUT·DELETE·출간 CORS는 기존 계약. 관리자 글 목록·상세와 관리자 분류·태그의 추가 자격 증명 CORS는 인증 origin의 GET에만 적용. API `clean verify`의 기존 검사 28개와 격리 JAR에서 해당 GET credential 응답 및 쓰기 메서드·공개 전용 origin preflight의 `403` 확인. 웹 검사 7개·타입 검사·정적 빌드와 격리 Chrome의 새 글 저장·출간, 기존 글 원문 보존, 목록 페이지·삭제, 세션 만료·늦은 응답 폐기, 키보드·라이트/다크 320~1440px 화면 확인. 격리 MySQL·API 중단에서 오류·입력 유지, 복구 후 수동 저장·새로고침 복원 확인. API 주소 미설정 별도 정적 빌드에서 글쓰기·편집본 목록·Home의 설정 안내, API 요청 0건과 가짜 데이터 없음 확인. 상세 범위는 [편집 화면](editor.md)에 기록. 기존 운영 API·MySQL과 공개 HTTPS API 배포는 이 작업에서 변경하지 않음.

2026-09-25 별도 검증 프로젝트에서 Spring Session JDBC를 포함한 Buildpacks 이미지 생성 성공. MySQL·API만 기동해 `/actuator/health`와 `/api/v1/status` `UP` 확인. 같은 MySQL에 재연결한 실행 JAR에서 Flyway V1~V3가 중복 적용되지 않았고, API 재시작 후 유효 세션 복원도 확인. 검증용 MySQL의 중단·복구와 만료 행 정리는 [관리자 로그인](authentication.md)에 기록. 검증 프로젝트의 컨테이너·네트워크·전용 볼륨·임시 비밀 파일은 제거했으며 기존 8080 앱·Redis는 유지.

2026-09-25 P1-03 격리 검증에서는 Java SDK의 OCI Object Storage 실제 PNG·JPEG 업로드·다운로드·삭제, 실패 후 상태 정리, Buildpacks Compose API·MySQL 기동, DB 중단·복구를 확인. 실행별 첨부 객체 접두사는 정리 후 비어 있음. 응답 상태와 인위적 장애 주입의 범위는 [첨부파일 운영 안내](attachments.md)에 기록. 새 API를 공개 HTTPS 주소에 배포하거나 기존 앱을 교체한 결과는 아님.

2026-09-26 P1-04 최종 소스의 기존 검사 28개 통과. 격리 Buildpacks·Compose 이미지에서는 V6 본문 해시, JDBC 로그인·세션 ID 교체, 외부 Redis Cloud의 공개 본문 키·TTL과 비공개 전환 뒤 차단·키 제거, 글 삭제를 확인. 초기 냉간 연결 실패 시 HTTP는 DB 원문으로 우회했고 짧은 유예 뒤 캐시 연결에 성공. 최종 JAR에서는 캐시 miss·hit, 해시 불일치, Redis 중단 시 DB fallback·복구, API 재시작 후 기존 JDBC 세션, 비공개 전환·삭제도 확인. 검증 전용 JAR·MySQL·Redis·이미지 프로젝트·볼륨과 Cloud 소유 prefix는 제거. 기존 VM 앱·Redis의 ID·이미지·시작 시각은 유지. main·[CI](https://github.com/gjaku1031/ken-blog/actions/runs/36220258568)·[Pages](https://github.com/gjaku1031/ken-blog/actions/runs/36220258654) 반영 완료. 공개 HTTPS API 배포는 아직 없음.

## P2-03A 이미지 연결 실행 경계 — 격리 검증 진행

P2-03A는 기존 API·MySQL Compose와 비공개 OCI Object Storage 설정을 사용하고 Flyway V9에 글·편집본 이미지 연결 관계를 추가. 별도 저장소 서비스·웹 컨테이너·Redis 이미지 캐시·버킷 공개 정책·VM 자동 배포는 없음. 새 `/api/v1/posts/{postId}/attachments/{id}/content`는 글 ID와 이미지 ID를 받아 현재 MySQL에서 출간·범위·연결·READY를 확인한 뒤 Spring이 OCI 원본을 전달. 관리자 첨부 GET/POST/DELETE의 브라우저 CORS는 `APP_AUTH_CORS_ALLOWED_ORIGINS`에 명시한 정확한 인증 origin만 자격 증명 허용, 쓰기에는 기존 세션·CSRF 필요. 공개 전용 origin은 관리자 첨부 접근 대상이 아님. 기존 V8 데이터·JDBC 세션의 V9 전환, 실제 OCI PNG/JPEG 바이트·권한별 이미지 읽기, 연결/삭제 경합과 편집본 출간을 격리 HTTP·SQL로 확인. 격리 MySQL 중단 중 익명·인증 이미지 모두 `503 ProblemDetail`, 복구 뒤 기존 JDBC 세션·이미지 복원을 확인. 별도 새 DB의 V1~V9·관리자 준비·로그인·글 생성 HTTP도 확인. 검증 소유 글·편집본·첨부의 연결을 해제하고 첨부 DELETE `204`·OCI HEAD `404`·정확한 소유 접두사 목록 0·메타데이터 0을 확인. 소유 JAR·MySQL 컨테이너·볼륨 제거 후 기존 VM 앱·Redis의 ID·이미지·시작 시각 동일성 확인. main·CI·Pages 반영 전.

로컬의 `http://127.0.0.1:14000`과 `http://127.0.0.1:18081`은 origin이 달라도 동일 host의 같은 site이므로 `SameSite=Lax` 세션 검증이 가능. 반면 GitHub Pages와 향후 API 도메인이 교차 site이면 이 로컬 결과만으로 쿠키가 PRIVATE 이미지 요청에 전송된다고 볼 수 없음. 공개 HTTPS API 도메인과 쿠키·CSRF·자격 증명 정책을 별도로 확정해야 하며 현재 Pages 빌드의 API URL은 비어 있음. 공개 이미지 블록과 관리자 업로드 UI는 P2-03B 후속 범위. 기존 VM 앱·Redis·버킷 정책은 이 계획으로 교체하지 않음.

## 메모리 한도와 검증 범위

API Compose 메모리 한도는 1 GiB. 이는 컨테이너 상한이며 사용량이나 호스트 전체 점유량이 아님. 아래는 **이전 P0-04 상태**에서 2026-09-25 ARM64·24 GB VM, Docker 29.8.1, Compose 5.5.1로 `ken-blog-p004` API 컨테이너 하나만 기동해 `docker stats --no-stream`으로 측정한 기록. 기존 앱과 Redis는 별도 컨테이너로 계속 실행 중이었으나 아래 값에 포함하지 않음.

| 조건 | API 메모리 사용량 / 1 GiB 한도 |
| --- | --- |
| 기동·요청 후 유휴, 2초 간격 3회 | 185.1, 185.2, 185.2 MiB |
| 상태 API GET 400회, 4개 동시 작업자, 약 10.5초 중 3회 | 188.2, 188.9, 192.2 MiB |

부하 요청은 400/400회 성공. 수치는 한 VM과 당시 상태 API만의 짧은 표본이며 최대 사용량이나 장기 안정성 보장값이 아님. 별도 P1-04 격리 이미지의 한 시점에서는 API 375.1 MiB/1 GiB 한도, MySQL 461.4 MiB 사용량을 관찰. 서로 다른 시점·구성의 값이므로 증감이나 최대 사용량 추정에 사용하지 않으며 4 GB 운영 적합성은 미검증.

## 참고

- [Spring Boot Maven 플러그인의 OCI 이미지 생성](https://docs.spring.io/spring-boot/maven-plugin/build-image.html)
- [Next.js 정적 출력](https://nextjs.org/docs/app/guides/static-exports)
- [Spring MVC CORS](https://docs.spring.io/spring-framework/reference/web/webmvc-cors.html)
