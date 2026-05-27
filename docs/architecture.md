# Ken Blog 아키텍처

![현재 배포 구조와 후속 연결을 구분한 도면](../diagrams/architecture.svg)

[다크 도면](../diagrams/architecture.dark.svg) · [PNG](../diagrams/architecture.png) · [다크 PNG](../diagrams/architecture.dark.png) · [도면 소스와 아이콘 출처](../diagrams/README.md)

방문자에게 GitHub Pages의 정적 Next.js 화면 제공. Pages 배포 대상은 빌드 결과인 `apps/web/out`의 HTML·JavaScript·이미지. Next 서버 프로세스 없음. [CI](../.github/workflows/ci.yml)는 Web·API 빌드와 검사 담당. 별도 [Pages workflow](../.github/workflows/pages.yml)는 정적 화면의 빌드와 배포 담당. CI의 VM 애플리케이션 자동 배포 없음.

Spring Boot API는 OCI ARM64 VM에서 Buildpacks로 만든 JVM 이미지와 Docker Compose로 실행. 검증 연결은 VM의 `127.0.0.1:18081`에만 바인딩. 로컬 정적 화면에서 브라우저의 API 상태 요청과 CORS 응답 확인. 공개 HTTPS API 주소는 미확정이며 Pages 화면에는 API 미설정 안내 표시. 그림의 브라우저→Spring 갈색 파선은 **계획된 공개 연결**로, 현재 동작하는 인터넷 경로가 아님. 공개 주소 준비 후 빌드 시 `NEXT_PUBLIC_API_BASE_URL` 저장소 변수에 입력하고 재배포 필요.

MySQL 8.4.11은 같은 VM의 개발용 Docker Compose 서비스와 별도 데이터 볼륨으로 구성. DB 호스트 포트는 기본 `127.0.0.1:13306`에만 바인딩하고, Spring 컨테이너는 Compose 네트워크의 `mysql:3306`에 JDBC로 연결. Spring의 `DB_URL`·`DB_USERNAME`·`DB_PASSWORD`가 연결을 결정하고, 시작할 때 Flyway가 초기 `posts` 테이블을 적용한 뒤 JPA가 스키마를 검증. 구체 `PostService`가 Spring Data JPA `PostRepository` 인터페이스를 통해 초안을 저장하고 ID·slug로 조회. 외부 게시글 작성·조회 HTTP 경로, 운영 DB와 공개 인터넷의 DB 접속은 이번 구성에 없음. 도면의 Spring→MySQL 실선은 로컬 게시글 영속화 검증의 내부 접근을 뜻함.

Redis와 OCI Object Storage는 후속 단계로, 도면의 분리된 하단 영역은 미구현·미연결 계획 표시. 실행 방법과 검증 조건은 [런타임 안내](runtime.md)에 기록.
