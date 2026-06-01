# Ken Blog 아키텍처

![공개 Pages와 새 프로젝트의 로컬 검증 구성 및 후속 연결](../diagrams/architecture.svg)

[다크 도면](../diagrams/architecture.dark.svg) · [PNG](../diagrams/architecture.png) · [다크 PNG](../diagrams/architecture.dark.png) · [도면 소스와 아이콘 출처](../diagrams/README.md)

방문자에게 GitHub Pages의 정적 Next.js 화면 제공. Pages 배포 대상은 빌드 결과인 `apps/web/out`의 HTML·JavaScript·이미지. Next 서버 프로세스 없음. [CI](../.github/workflows/ci.yml)는 Web·API 빌드와 검사 담당. 별도 [Pages workflow](../.github/workflows/pages.yml)는 정적 화면의 빌드와 배포 담당. CI의 VM 애플리케이션 자동 배포 없음.

새 프로젝트의 Spring Boot API는 Buildpacks JVM 이미지와 Docker Compose로 OCI ARM64 VM의 격리 로컬 검증 환경에 실행하도록 구성. API의 기본 호스트 바인딩은 `127.0.0.1:18081`. 현재 VM에서 별도로 실행 중인 기존 앱·Redis와 다른 자원이며, 도면은 기존 앱의 교체나 CI의 VM 자동 배포를 뜻하지 않음. 공개 HTTPS API 주소는 미확정이며 Pages 화면에는 API 미설정 안내 표시. 그림의 브라우저→Spring 갈색 파선은 **계획된 공개 연결**로, 현재 동작하는 인터넷 경로가 아님. 공개 주소 준비 후 빌드 시 `NEXT_PUBLIC_API_BASE_URL` 저장소 변수에 입력하고 재배포 필요.

MySQL 8.4.11은 같은 VM의 새 프로젝트 개발용 Docker Compose 서비스와 별도 데이터 볼륨으로 구성. DB 호스트 포트는 기본 `127.0.0.1:13306`에만 바인딩하고, Spring 컨테이너는 Compose 네트워크의 `mysql:3306`에 JDBC로 연결. Spring의 `DB_URL`·`DB_USERNAME`·`DB_PASSWORD`가 연결을 결정. Flyway V1·V2가 게시글·계정, V3가 Spring Session JDBC의 `SPRING_SESSION`·`SPRING_SESSION_ATTRIBUTES` 테이블을 생성하며, JPA는 애플리케이션 엔티티의 스키마를 검증. 세션 스키마 자동 초기화는 사용하지 않음. 구체 `PostService`가 Spring Data JPA `PostRepository` 인터페이스를 통해 초안을 저장하고 ID·slug로 조회. 외부 게시글 작성·조회 HTTP 경로, 운영 DB와 공개 인터넷의 DB 접속은 이번 구성에 없음. 도면의 Spring→MySQL 실선은 게시글·계정·세션의 로컬 내부 접근을 뜻함.

Spring Security의 로그인·권한 판단에 사용할 계정과 비밀번호 해시는 MySQL에 저장. Spring Session JDBC가 같은 MySQL에 서버 세션을 저장하며 기본 비활동 만료는 30분, 만료 행 정리 작업은 매분 실행하도록 설정. 로컬 인증은 CSRF 토큰 취득→로그인·세션 ID 교체→현재 사용자 조회→로그아웃·세션 무효화 흐름. 세부 계약은 [관리자 인증 안내](authentication.md)에 기록. 인증 API는 로컬 검증 범위이고 Pages에는 로그인 화면이 없음. 공개 HTTPS API 주소와 실제 도메인에 맞춘 쿠키·CSRF 정책은 아직 미확정. 게시글 작성 HTTP 경로도 현재 없음.

Redis Cloud는 후속 공개 글 캐시용, OCI Object Storage는 후속 첨부파일 저장용. 도면의 분리된 하단 영역은 두 자원 모두 미구현·미연결 계획 표시. 실행 방법과 검증 조건은 [런타임 안내](runtime.md)에 기록.
