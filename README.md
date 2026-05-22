# Ken Blog

Next.js·TypeScript 정적 프론트와 Kotlin·Spring Boot API를 함께 관리하는 저장소.

```text
apps/
├── web/       # GitHub Pages에 배포할 정적 프론트
└── api/       # VM에서 실행할 Spring API
planning/      # 계획·완료 조건·진행 상태
docs/          # 실행·설계 안내
```

프론트는 GitHub Pages에서 제공하고 브라우저가 Spring API를 호출하는 구조. VM에는 Spring 실행. 공개 API 도메인·HTTPS 주소가 아직 없어 공개 홈은 API 미설정 상태로 배포.

- [프론트와 임시 아키텍처 대문](https://gjaku1031.github.io/ken-blog/)
- [현재 계획](planning/issues/P0-04.md) · [작업 상태](planning/tasks.md) · [개발 순서](planning/roadmap.md)
- [코드·문서 규칙](docs/code-conventions.md) · [런타임 안내](docs/runtime.md) · [도면 설명](docs/architecture.md)

## API 직접 실행

필요 환경: JDK 25. Spring Boot 4.1.1·Kotlin 2.3.21·Maven wrapper 사용.

```bash
cd apps/api
./mvnw -B clean verify
SERVER_ADDRESS=127.0.0.1 SERVER_PORT=8081 ./mvnw spring-boot:run
```

| 경로 | 제공 내용 |
|---|---|
| `/actuator/health` | 기동 상태 |
| `/api/v1/status` | `{"status":"UP"}` 응답. DB·외부 서비스 점검 포함 없음 |
| `/v3/api-docs` | OpenAPI 명세 JSON |
| `/swagger-ui/index.html` | Swagger UI |

상태 API 명세는 `StatusApi`, 구현은 `StatusController`에서 관리. Spring MVC 오류는 `ApiErrorHandler`의 RFC 9457 `ProblemDetail`로 처리. 현재 DB·인증·게시글 기능 없음.

## 정적 프론트 빌드

필요 환경: Node.js 24.21.0·npm 11.19.0.

```bash
cd apps/web
npm ci
npm test
npm run typecheck
NEXT_PUBLIC_BASE_PATH=/ken-blog npm run build
```

`out/`을 정적 호스팅에 게시. GitHub Actions도 같은 정적 산출물을 Pages에 배포하며 Next 서버는 실행하지 않음. 기본 주소가 비어 있는 빌드도 정상 완료되고 홈에 미설정 안내 표시.

`NEXT_PUBLIC_API_BASE_URL`은 브라우저가 접근할 공개 API 주소. 빌드 시 JavaScript에 포함되므로 비밀값 저장 금지. 현재 공개 배포에는 설정하지 않음. HTTPS Pages에서 HTTP API 호출은 허용하지 않으며 실제 API의 HTTPS 준비 후 주소를 설정하고 다시 빌드해야 함.

`NEXT_PUBLIC_BASE_PATH`는 프로젝트 하위 경로이며 Pages 배포 값은 `/ken-blog`. 환경변수 예시는 [apps/web/.env.example](apps/web/.env.example), 로컬 정적 서버·API 연결 및 CORS 확인 절차는 [런타임 안내](docs/runtime.md) 참고.

## Spring 컨테이너와 배포 범위

Spring API 이미지는 Buildpacks로 생성. Compose는 API 한 개만 실행하며 Web Docker 구성 없음. 기본 공개 포트는 로컬 주소에만 연결하고 공개 HTTPS API 배포는 아직 수행하지 않음.

[도면 설명과 원본](docs/architecture.md)은 실제 정적 프론트 배포·API 실행 기반과 후속 HTTPS 연결·MySQL·Redis·OCI Object Storage를 구분.

## 검증 기록

계획별 실제 빌드·테스트·브라우저·CI 결과는 [작업 상태](planning/tasks.md)에서 확인. 메모리 사용량은 [런타임 안내](docs/runtime.md)의 측정 조건과 함께 해석.

실제 환경 파일과 `docs/study/`는 Git 및 Pages 산출물에서 제외. 로그인·DB·Redis·첨부파일·GA 연동과 공개 HTTPS API 연결은 후속 단계.
