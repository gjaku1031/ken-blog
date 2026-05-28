# 정적 프론트와 로컬 API 실행

현재 프론트는 GitHub Pages에 올리는 Next.js 정적 파일. 브라우저가 공개 상태 API를 직접 호출하는 구조. Spring API는 Cloud Native Buildpacks의 JVM 이미지로 생성하고, 이 문서의 Compose는 API와 개발 MySQL을 실행. [게시글 저장 기반](persistence.md)은 API 내부 기능이며 Redis·OCI Object Storage와 인증은 후속 작업.

## Spring 이미지와 API 실행

ARM64 호스트에서 Java 25 JVM 이미지 생성. Spring Boot Maven 플러그인이 Paketo `builder-noble-java-tiny:0.0.152`를 사용하며 API Dockerfile은 없음. 저장소 루트에서 `.env.example`을 Git 제외 대상 `.env`로 복사해 `DB_PASSWORD`와 `MYSQL_ROOT_PASSWORD`를 서로 다른 로컬 값으로 채운 뒤 실행:

```sh
cd apps/api
./mvnw -B -ntp spring-boot:build-image -DskipTests
cd ../..
docker compose -p ken-blog-p101 up -d --no-build
docker compose -p ken-blog-p101 ps
curl -fsS http://127.0.0.1:18081/api/v1/status
curl -fsS http://127.0.0.1:18081/actuator/health
```

이미지 이름 `ken-blog-p004-api:local`은 앞 단계에서 정한 로컬 태그. DB 의존성이 추가된 현재 소스로 반드시 재빌드 필요. Compose는 API 컨테이너의 8080을 호스트의 `127.0.0.1:18081`에, MySQL의 3306을 `127.0.0.1:13306`에만 연결. 기존 8080 서비스와 포트 분리. [루트 `.env.example`](https://github.com/gjaku1031/ken-blog/blob/main/.env.example)의 포트나 개발 DB 비밀번호는 `.env`에서 설정. 외부 공개 주소와 HTTPS 설정은 현재 없음.

```sh
docker compose -p ken-blog-p101 logs --tail=100 api
docker compose -p ken-blog-p101 stop api
docker compose -p ken-blog-p101 start api
docker compose -p ken-blog-p101 down
```

이미지를 갱신하려면 Buildpacks 명령 재실행 후 `docker compose -p ken-blog-p101 up -d --no-build` 실행. `down`은 이 Compose 프로젝트의 컨테이너·네트워크만 제거하며 MySQL 이름 볼륨과 다른 프로젝트는 유지. 기존 `ken-blog-p004` Compose 실행 환경이 있다면 그것은 별개로 남음.

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
  docker compose -p ken-blog-p101 up -d --no-build
```

그다음 웹을 로컬 테스트 주소로 재빌드하고 `out/`을 `/ken-blog` 경로에 배치:

```sh
cd apps/web
NEXT_PUBLIC_BASE_PATH=/ken-blog \
  NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:18081 npm run build
mkdir -p /tmp/ken-blog-p101-site/ken-blog
cp -a out/. /tmp/ken-blog-p101-site/ken-blog/
python3 -m http.server 14000 --bind 127.0.0.1 \
  --directory /tmp/ken-blog-p101-site
```

같은 호스트의 브라우저에서 `http://127.0.0.1:14000/ken-blog/` 확인. API가 실행 중이면 정상 안내, `docker compose -p ken-blog-p101 stop api` 후 새로고침하면 연결 실패 안내. 복구는 `docker compose -p ken-blog-p101 start api`. 정적 파일 서버는 실행한 터미널에서 `Ctrl+C`로 종료.

Spring CORS는 `/api/v1/status`의 지정 origin과 공개 GET 및 OPTIONS 사전 요청만 허용. 기본 origin은 `https://gjaku1031.github.io`; 로컬 origin은 위처럼 실행 시 명시적으로 추가. 브라우저 호출은 자격 증명을 보내지 않으며 API는 자격 증명 허용 CORS 헤더를 반환하지 않음. CORS는 브라우저의 읽기 정책으로, API 인증이나 네트워크 방화벽을 대체하지 않음.

## 메모리 한도와 검증 범위

API Compose 메모리 한도는 1 GiB. 이는 컨테이너 상한이며 사용량이나 호스트 전체 점유량이 아님. 아래는 **이전 P0-04 상태**에서 2026-09-25 ARM64·24 GB VM, Docker 29.8.1, Compose 5.5.1로 `ken-blog-p004` API 컨테이너 하나만 기동해 `docker stats --no-stream`으로 측정한 기록. 기존 앱과 Redis는 별도 컨테이너로 계속 실행 중이었으나 아래 값에 포함하지 않음.

| 조건 | API 메모리 사용량 / 1 GiB 한도 |
| --- | --- |
| 기동·요청 후 유휴, 2초 간격 3회 | 185.1, 185.2, 185.2 MiB |
| 상태 API GET 400회, 4개 동시 작업자, 약 10.5초 중 3회 | 188.2, 188.9, 192.2 MiB |

부하 요청은 400/400회 성공. 수치는 한 VM과 당시 상태 API만의 짧은 표본이며 최대 사용량이나 장기 안정성 보장값이 아님. 새 MySQL·JPA 추가 후의 메모리와 Redis 등 후속 기능을 포함한 4 GB 운영 적합성은 미검증.

## 참고

- [Spring Boot Maven 플러그인의 OCI 이미지 생성](https://docs.spring.io/spring-boot/maven-plugin/build-image.html)
- [Next.js 정적 출력](https://nextjs.org/docs/app/guides/static-exports)
- [Spring MVC CORS](https://docs.spring.io/spring-framework/reference/web/webmvc-cors.html)
