# 정적 프론트와 로컬 API 실행

현재 프론트는 GitHub Pages에 올리는 Next.js 정적 파일. 브라우저가 공개 상태 API를 직접 호출하는 구조. Spring API는 Cloud Native Buildpacks의 JVM 이미지로 생성하고, 이 문서의 Compose는 API·개발 MySQL을 실행. [게시글 저장 기반](persistence.md)은 API 내부 기능이며 [관리자 로그인](authentication.md)은 MySQL에 저장하는 서버 세션 기반. 관리자 이미지 첨부는 [비공개 OCI Object Storage](attachments.md)에 선택적으로 연결. P1-04의 [Redis Cloud 공개 본문 캐시](cache.md)는 기본 비활성으로 격리 검증·main·CI·Pages 반영 완료이며 Compose에 Redis 서비스를 추가하지 않음.

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

현재 공개 HTTPS API 주소가 없으므로 Pages 배포 빌드는 위처럼 API URL을 비움. 화면은 `공개 API 주소가 아직 설정되지 않았습니다.`를 표시. `http://127.0.0.1:18081`은 같은 VM의 로컬 검증에만 사용하며 Pages 방문자의 브라우저에서 접근할 수 없음. HTTPS Pages에서 HTTP API를 설정해도 브라우저의 혼합 콘텐츠 규칙에 따라 연결 불가. 공개 연결은 후속 HTTPS API 주소 마련 후 별도 빌드·배포 대상.

## 로컬의 두 origin 검증

API를 로컬 정적 사이트 `http://127.0.0.1:14000`에서 읽으려면 허용 origin을 추가하여 Compose 시작:

```sh
APP_CORS_ALLOWED_ORIGINS=https://gjaku1031.github.io,http://127.0.0.1:14000 \
  docker compose -p ken-blog-p102 up -d --no-build
```

그다음 웹을 로컬 테스트 주소로 재빌드하고 `out/`을 `/ken-blog` 경로에 배치:

```sh
cd apps/web
NEXT_PUBLIC_BASE_PATH=/ken-blog \
  NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:18081 npm run build
mkdir -p /tmp/ken-blog-p102-site/ken-blog
cp -a out/. /tmp/ken-blog-p102-site/ken-blog/
python3 -m http.server 14000 --bind 127.0.0.1 \
  --directory /tmp/ken-blog-p102-site
```

같은 호스트의 브라우저에서 `http://127.0.0.1:14000/ken-blog/` 확인. API가 실행 중이면 정상 안내, `docker compose -p ken-blog-p102 stop api` 후 새로고침하면 연결 실패 안내. 복구는 `docker compose -p ken-blog-p102 start api`. 정적 파일 서버는 실행한 터미널에서 `Ctrl+C`로 종료.

Spring CORS는 `/api/v1/status`의 지정 origin과 공개 GET 및 OPTIONS 사전 요청만 허용. 기본 origin은 `https://gjaku1031.github.io`; 로컬 origin은 위처럼 실행 시 명시적으로 추가. 현재 정적 화면의 상태 조회는 자격 증명을 보내지 않으며 API는 상태 경로에 자격 증명 허용 CORS 헤더를 반환하지 않음. 인증 API의 자격 증명 CORS는 별도 `APP_AUTH_CORS_ALLOWED_ORIGINS`로만 명시 허용하며 기본 비허용. CORS는 브라우저의 읽기 정책으로, API 인증이나 네트워크 방화벽을 대체하지 않음.

2026-09-25 별도 검증 프로젝트에서 Spring Session JDBC를 포함한 Buildpacks 이미지 생성 성공. MySQL·API만 기동해 `/actuator/health`와 `/api/v1/status` `UP` 확인. 같은 MySQL에 재연결한 실행 JAR에서 Flyway V1~V3가 중복 적용되지 않았고, API 재시작 후 유효 세션 복원도 확인. 검증용 MySQL의 중단·복구와 만료 행 정리는 [관리자 로그인](authentication.md)에 기록. 검증 프로젝트의 컨테이너·네트워크·전용 볼륨·임시 비밀 파일은 제거했으며 기존 8080 앱·Redis는 유지.

2026-09-25 P1-03 격리 검증에서는 Java SDK의 OCI Object Storage 실제 PNG·JPEG 업로드·다운로드·삭제, 실패 후 상태 정리, Buildpacks Compose API·MySQL 기동, DB 중단·복구를 확인. 실행별 첨부 객체 접두사는 정리 후 비어 있음. 응답 상태와 인위적 장애 주입의 범위는 [첨부파일 운영 안내](attachments.md)에 기록. 새 API를 공개 HTTPS 주소에 배포하거나 기존 앱을 교체한 결과는 아님.

2026-09-26 P1-04 최종 소스의 기존 검사 28개 통과. 격리 Buildpacks·Compose 이미지에서는 V6 본문 해시, JDBC 로그인·세션 ID 교체, 외부 Redis Cloud의 공개 본문 키·TTL과 비공개 전환 뒤 차단·키 제거, 글 삭제를 확인. 초기 냉간 연결 실패 시 HTTP는 DB 원문으로 우회했고 짧은 유예 뒤 캐시 연결에 성공. 최종 JAR에서는 캐시 miss·hit, 해시 불일치, Redis 중단 시 DB fallback·복구, API 재시작 후 기존 JDBC 세션, 비공개 전환·삭제도 확인. 검증 전용 JAR·MySQL·Redis·이미지 프로젝트·볼륨과 Cloud 소유 prefix는 제거. 기존 VM 앱·Redis의 ID·이미지·시작 시각은 유지. main·[CI](https://github.com/gjaku1031/ken-blog/actions/runs/36220258568)·[Pages](https://github.com/gjaku1031/ken-blog/actions/runs/36220258654) 반영 완료. 공개 HTTPS API 배포는 아직 없음.

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
