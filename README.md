# Ken Blog

Next.js 프론트와 Kotlin·Spring Boot API를 함께 관리하는 저장소.

```text
apps/
├── web/       # Next.js·TypeScript
└── api/       # Kotlin·Spring Boot
planning/      # 계획·완료 조건·진행 상태
docs/          # 개발 규칙과 문서
```

현재 범위는 두 앱의 독립 빌드·기동, Next 홈의 API 상태 조회, 오류 응답·Swagger 명세와 CI. DB·인증·파일 저장소는 후속 단계에서 연결.

- [현재 계획](planning/issues/P0-03.md)
- [작업 상태](planning/tasks.md)
- [개발 순서](planning/roadmap.md)
- [코드·문서 규칙](docs/code-conventions.md)

## API 실행

필요 환경: JDK 25. Spring Boot 4.1.1·Kotlin 2.3.21, Maven 3.9.16용 wrapper 사용.

```bash
cd apps/api
./mvnw -B clean verify
SERVER_ADDRESS=127.0.0.1 SERVER_PORT=8081 ./mvnw spring-boot:run
```

`http://127.0.0.1:8081/actuator/health`의 `UP` 응답으로 기동 확인. `verify`에서 Kotlin 통합 테스트·컴파일·패키징 수행. 현재 API에는 DB·인증·업무 기능 없음.

| 경로 | 제공 내용 |
|---|---|
| `/api/v1/status` | `{"status":"UP"}` 응답. DB·외부 서비스 상태 점검은 포함하지 않음 |
| `/v3/api-docs` | OpenAPI 명세 JSON |
| `/swagger-ui/index.html` | Swagger UI |

상태 API의 명세는 `StatusApi`, 실제 응답은 `StatusController`에서 관리. 공통 오류 응답은 RFC 9457 `ProblemDetail` 사용. `ApiErrorHandler`는 Spring의 `ResponseEntityExceptionHandler`를 확장해 기존 HTTP 상태·프로토콜 헤더를 유지하고 공개 가능한 설명으로 응답. 오류 유발용 경로는 테스트 소스에만 포함.

## Web 실행

필요 환경: Node.js 24.21.0·npm 11.19.0. Next.js 16.3.6·React 19.3.0·TypeScript 7.0.2 사용.

```bash
cd apps/web
npm ci
npm test
npm run typecheck
npm run build
API_BASE_URL=http://127.0.0.1:8081 npm run dev -- --hostname 127.0.0.1
```

`http://127.0.0.1:3000`에서 준비 화면과 API 연결 상태 확인. API와 별도 터미널에서 실행. `typecheck`는 Next가 생성하는 라우트 타입 준비 후 TypeScript 검사. 생성된 타입·빌드 결과는 Git 제외.

`API_BASE_URL`은 Next 서버가 접근할 Spring의 HTTP(S) 기본 주소. 경로·쿼리·인증 정보가 없는 원본 주소만 허용. 개발 환경의 예시는 [apps/web/.env.example](apps/web/.env.example) 참고. 로컬 파일로 관리하려면 `apps/web/.env.local`에 설정하며 Git에는 포함하지 않음. `NEXT_PUBLIC_` 접두사 사용 없음.

홈 요청마다 Next 서버에서 `/api/v1/status` 조회. API 상태는 캐시하지 않으며 응답 본문을 읽는 시간을 포함해 최대 3초 대기. `UP`은 프로세스가 응답한다는 의미로 DB·외부 서비스 점검 포함 없음. 미설정·설정 오류·HTTP 오류·연결 실패·시간 초과·응답 형식 오류는 고정 안내로 표시. 화면에 내부 주소와 오류 원문 표시 없음.

API 연결은 요청 시 실행하므로 API가 꺼져 있거나 주소가 설정되지 않아도 `npm run build` 가능. 프로덕션 기동 예시:

```bash
API_BASE_URL=http://127.0.0.1:8081 npm run start -- --hostname 127.0.0.1
```

원격 VM에서 실행할 경우 Mac의 SSH 터널 예시:

```bash
ssh -N -L 3000:127.0.0.1:3000 -L 8081:127.0.0.1:8081 <VM-접속대상>
```

터널 연결 후 Mac의 `http://localhost:3000`과 `http://localhost:8081/actuator/health`로 확인. 개발 서버 실행은 위 명령으로 별도 진행.

## 현재 검증

- API Maven verify 통과. Kotlin 통합 테스트 12개로 상태·명세·오류 응답과 프로토콜 헤더 검증. 패키징한 JAR의 상태·명세·Swagger HTML 응답 확인.
- Web 테스트 6개·타입 검사·API 주소 미설정 프로덕션 빌드 통과. 실제 Next·Spring 연결과 API 중지 상태의 브라우저 안내·오류 없음 확인.
- [GitHub CI](https://github.com/gjaku1031/ken-blog/actions/runs/36129596739)의 API·Web 빌드와 프로덕션 서버 HTTP 응답 검증 통과. 검증일: 2026-09-25.

실제 환경변수·비밀 설정과 `docs/study/`는 Git에 포함하지 않음. 운영 클라우드 자원 연결·배포와 GitHub Pages 대문은 후속 계획.
