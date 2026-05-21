# Ken Blog 아키텍처

![현재 배포 구조와 후속 연결을 구분한 도면](../diagrams/architecture.svg)

[다크 도면](../diagrams/architecture.dark.svg) · [PNG](../diagrams/architecture.png) · [다크 PNG](../diagrams/architecture.dark.png) · [도면 소스와 아이콘 출처](../diagrams/README.md)

방문자에게 GitHub Pages의 정적 Next.js 화면 제공. Pages 배포 대상은 빌드 결과인 `apps/web/out`의 HTML·JavaScript·이미지. Next 서버 프로세스 없음. [CI](../.github/workflows/ci.yml)는 Web·API 빌드와 검사 담당. 별도 [Pages workflow](../.github/workflows/pages.yml)는 정적 화면의 빌드와 배포 담당. CI의 VM 애플리케이션 자동 배포 없음.

Spring Boot API는 OCI ARM64 VM에서 Buildpacks로 만든 JVM 이미지와 Docker Compose로 별도 실행. 현재 검증 연결은 VM의 `127.0.0.1:18081`에만 바인딩. 로컬 정적 화면에서 브라우저의 API 상태 요청과 CORS 응답 확인. 공개 HTTPS API 주소는 미확정이며 Pages 화면에는 API 미설정 안내 표시. 그림의 브라우저→Spring 갈색 파선은 **계획된 공개 연결**로, 현재 동작하는 인터넷 경로가 아님. 공개 주소 준비 후 빌드 시 `NEXT_PUBLIC_API_BASE_URL` 저장소 변수에 입력하고 재배포 필요.

MySQL·JPA, Redis, OCI Object Storage는 후속 단계. 현재 API와의 연결 없음. 도면의 분리된 하단 영역은 계획 표시용이며 실제 운영 자원이 아님. 실행 방법과 이번 검증 조건은 [런타임 안내](runtime.md)에 기록.
