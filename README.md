# Ken Blog

Next.js 프론트와 Kotlin·Spring Boot API를 함께 관리하는 저장소.

```text
apps/
├── web/       # Next.js·TypeScript
└── api/       # Kotlin·Spring Boot
planning/      # 계획·완료 조건·진행 상태
docs/          # 개발 규칙과 문서
```

초기 범위는 두 앱의 독립 빌드·기동과 CI. DB·인증·파일 저장소는 후속 단계에서 연결.

- [현재 계획](planning/issues/P0-01.md)
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

`http://127.0.0.1:8081/actuator/health`의 `UP` 응답으로 기동 확인. 현재 API에는 DB·인증·업무 기능 없음. `verify`는 현재 컴파일·패키징 확인이며 아직 테스트 소스 없음.

## Web 실행

필요 환경: Node.js 24.21.0·npm 11.19.0. Next.js 16.3.6·React 19.3.0·TypeScript 7.0.2 사용.

```bash
cd apps/web
npm ci
npm run typecheck
npm run build
npm run dev -- --hostname 127.0.0.1
```

`http://127.0.0.1:3000`에서 준비 화면 확인. API와 별도 터미널에서 실행. `typecheck`는 Next가 생성하는 라우트 타입 준비 후 TypeScript 검사. 생성된 타입·빌드 결과는 Git 제외.

원격 VM에서 실행할 경우 Mac의 SSH 터널 예시:

```bash
ssh -N -L 3000:127.0.0.1:3000 -L 8081:127.0.0.1:8081 <VM-접속대상>
```

터널 연결 후 Mac의 `http://localhost:3000`과 `http://localhost:8081/actuator/health`로 확인. 개발 서버 실행은 위 명령으로 별도 진행.

## 현재 검증

- API Maven 빌드와 JAR 기동·health 응답 확인. 테스트 소스는 아직 없음.
- Web 클린 설치·타입 검사·프로덕션 빌드 통과. 개발 서버의 브라우저 렌더링과 오류 없음 확인.
- CI 원격 실행 결과는 workflow 반영 후 기록.

실제 환경변수·비밀 설정과 `docs/study/`는 Git에 포함하지 않음. 운영 클라우드 자원 연결·배포와 GitHub Pages 대문은 후속 계획.
