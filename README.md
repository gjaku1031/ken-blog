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

필요 환경: JDK 25. Spring Boot 4.1.1·Kotlin 2.3.21, Maven wrapper 3.9.16 사용.

```bash
cd apps/api
./mvnw -B clean verify
SERVER_ADDRESS=127.0.0.1 SERVER_PORT=8081 ./mvnw spring-boot:run
```

`http://127.0.0.1:8081/actuator/health`의 `UP` 응답으로 기동 확인. 현재 API에는 DB·인증·업무 기능 없음. `verify`는 현재 컴파일·패키징 확인이며 아직 테스트 소스 없음.

프론트 실행 명령과 전체 검증 결과는 초기 구성 완료 후 기록.
