# 애플리케이션 구조 결정

기준일: 2026-10-02. 상태: 소스 구현 완료, 기존 운영 자료 이관 및 사이트 전환 전.

## 글과 탐색

일반 글과 프로젝트 문서를 공통 `Post`로 관리하고, 묶음은 `Series`의 `TECH`·`PROJECT` 종류로 구분. 별도 Notes 분류는 제거. navbar는 Home·Posts·Projects이며 Posts는 일반 글, Projects는 프로젝트 시리즈 탐색. 기술 스택과 프로젝트 기간은 프로젝트 시리즈에만 지정. 시리즈 또는 소분류의 지정 순서상 첫 공개 문서를 대문으로 사용.

별도 Notes·Tech·Project 문서 모델을 유지하는 대안은 단순해진 요구사항에서 저장·조회·탐색 계약을 중복시키므로 제외. 글 ID·slug·기존 본문·비공개 자료는 `ops/unify-post-series.py`의 명시적 이관 대상으로 보존하며 자동 공개하지 않는 기준.

## 원고와 화면

본문 정본은 `content/posts/{slug}.md`, DB는 메타데이터와 연결 관계 관리. 기존 DB 본문 열은 이관·복구 호환용으로 보존하며 신규 원고를 저장하는 경로로 사용하지 않음. 공개 원고만 Git 추적하고 미출간·비공개 원고와 비밀값은 공개 저장소에 반영하지 않는 기준.

웹 본문 작성·수정 화면과 본문 쓰기 API는 제거. 원고는 에이전트나 작성자가 로컬 Git 파일에서 직접 수정하고 관리자 화면·HTTP API는 메타데이터·출간 상태·로컬 이미지 관리 담당. Spring은 원고를 보관하거나 읽지 않으며 Markdown 렌더링과 HTML 조립은 Node 빌드의 책임. 첨부는 영속 로컬 디스크로 관리하며 기존 OCI 객체는 해시를 대조해 이관할 때까지 보존.

공개·관리자 화면은 Node/TypeScript·Nunjucks로 빌드한 GitHub Pages 정적 파일. 본문 렌더링과 완성 HTML 조립을 Node로 통일하고 Kotlin SiteGenerator·Thymeleaf 제거. API는 Spring Boot, Node는 빌드 용도. `pages`의 공개 snapshot·revision 계약 유지. 독자용 공개 Post API·SPA 라우터·htmx 추가 없음. 배포 실행과 이력은 GitHub Actions 담당. 상세 배치와 운영 상태는 [인프라 ADR](ADR_infra.md) 참조.

## 홈 소개의 코드 관리

변경 빈도가 낮은 홈 소개는 `src/main/resources/web/site/templates/views/about.njk`의 정적 HTML로 직접 관리. 현재 공개 사이트의 이름·한 줄 소개·소개·GitHub·이메일 내용을 그대로 이전. 별도 DB 모델·설정 API·런타임 조회 없이 템플릿 수정과 Pages 배포로 반영하는 결정.

프로필 Controller·Service·DTO·Repository·Entity와 사진 업로드/조회/삭제 API 제거. 관리자 메뉴·폼·요청, snapshot의 profile 필드, 빌드의 사진 다운로드 및 보안/Caddy 경로 허용도 제거. 공용 이미지 정규화는 남아 있는 기술 배지의 64px 생성·교체에만 사용.

기존 운영 `home_profile` 행과 사진 파일의 실제 삭제는 수행하지 않음. 옛 DB/OCI 자료 이관 도구의 사진 참조는 자료 보존용으로 유지하며 애플리케이션 기능과 구분.

검증: 기존 JVM 검사 35개, 타입 검사·빈 사이트 및 프로필 없는 실제 격리 API snapshot 기반 생성 통과. 관리자 인증 후 제거한 API 5개 모두 404, 기술 배지 생성·교체 64px 및 기존 프로필 DB 행 보존 확인. JPA 생성 DDL·jOOQ 생성 코드·API JAR에서 프로필 모델 부재 확인. 실제 격리 API에 Chromium으로 로그인·관리자 목록 조회·로그아웃 검증, 프로필 네트워크 요청과 JavaScript 오류 없음. 원격 push·운영 반영 전 상태.

## 인증과 제거한 기능

단일 설정 관리자 계정의 비밀번호 로그인, Spring Security·JDBC 세션·CSRF·로그인 실패 제한 유지. 관리자 계정 변경 시 세션 해제. MFA·TOTP·복구 코드 기능은 제거하고 이전 인증 세션의 자동 재사용은 차단. JWT나 Redis 세션으로 전환하지 않는 결정.

잔디·조회수 통계·Google Analytics 수집 및 대시보드 기능 제거. Next.js/React·웹 편집기·Redis·런타임 OCI Object Storage·Flyway·Swagger 의존도 제거. 기능 제거를 이유로 기존 DB·원고·첨부·계정·백업의 실제 자료를 삭제하지 않는 기준.

검증 이력: Post·Series 통합 시 기존 JVM 검사 35개, Pages 생성, Native API의 비밀번호 로그인·jOOQ 조회·MCP·이미지 기능 검증 완료. 배포 및 성능 검증의 데이터 범위와 제한은 인프라 ADR에 별도 기록.

## MCP 제거와 원고 접근 경계

원고 작성·수정은 로컬 파일 편집, DB 메타데이터·이미지는 관리자 HTTP, 렌더링·페이지 생성은 Node로 역할 분리. 이 구조에서 별도의 블로그 MCP 서버는 중복 진입점과 원고 배포 의존성을 만들므로 전부 제거. 대체 MCP·CLI·추상화나 신규 스킬 제작 없음.

제거 대상은 `mcp` 도구·DTO·본문 선언 검사·리소스/프롬프트·이미지 Base64 입력·오류 변환·로컬 접속 필터와 Spring AI/MCP 의존성·설정·전용 Security 체인. 이들만 호출하던 `RepositoryMarkdown`, `ContentFeedService`, 공개 피드 DTO/목록 필터와 위키 다중 제목 해석 서비스도 제거. Pages가 사용하는 공개 상세 메타데이터 서비스, 관리자 제목 검색·위키 선언 DB 관계·탐색 쿼리, 인증·분류·시리즈·태그·첨부·기술 배지·출간 서비스는 유지.

Spring에는 원고 디렉터리 설정·마운트·파일 조회 경로 없음. 관리자 상세 조회·등록·메타데이터 수정·출간은 Markdown 파일 존재와 무관하게 처리. 관리자 화면의 원고 안내는 slug로 계산하는 `content/posts/{slug}.md` 규칙이며 파일 존재 확인 없음. 기존 원고·비공개 파일·백업과 DB의 옛 body/body_sha256 열은 보존. `PostBodyHash`는 신규 행의 빈 본문 호환 열 초기화에만 사용하며 파일 검증이나 응답에는 사용하지 않음.

### 변경된 HTTP 계약

- 관리자 글 상세/변경 응답 `PostDetailResponse`의 body·bodySha256 제거. 웹 화면은 두 필드를 소비하지 않으며 MCP 소비자는 함께 제거.
- 공개 snapshot의 글 항목 `PublicPostDetailResponse.body` 제거. 항상 빈 값이던 필드이며 Node 소비자는 기존에도 API 본문을 무시하고 Git 원고를 읽던 구조. snapshot v2·revision·공개 선별 유지. Node 내부 렌더링 모델과 격리 fixture의 body는 API 필드와 별개로 유지.
- `PUT /api/v1/admin/posts/{id}/wiki-links` 입력은 `{"wikiTargets":["제목"]}`만 허용. expectedBodySha256 제거 및 원고 해시 불일치 409 제거. 이전 해시 필드가 남은 요청은 보호 장치가 동작하는 것으로 오해하지 않도록 400 반환. 요청의 배열 필수·타입·개수·문자 검증과 중복 정규화, 글 404, 부모 행 잠금과 트랜잭션은 유지.

이전 해시는 조회 시점과 선언 교체 시점 사이의 원고 변경을 감지해 낡은 원고에 근거한 선언 저장을 거부하던 장치. 원고를 바꾸지 않은 채 두 요청이 선언만 수정하는 경합까지 차단하는 버전은 아니었음. 제거 후 선언은 DB 메타데이터로 독립 교체하며 마지막으로 저장한 요청이 최종 값. 원고와 선언의 일치는 작성자 책임으로 이동하며 새로운 해시·낙관적 버전은 미도입. `WikiLinkConflictException`도 실제 발생 조건 소멸로 제거.

위키 제목 해석·링크·역링크의 정적 렌더링은 기존 Node가 원고에서 추출한 제목을 공개 snapshot에 연결하는 방식 유지. DB의 `post_wiki_links`와 관리자 선언·제목 탐색은 유지하며, Node의 원고 링크와 DB 선언을 자동 동기화하는 새 흐름은 추가하지 않음. 출간된 글의 원고 누락은 API 출간 요청을 막지 않고 기존 Pages 빌드를 실패시키는 경계.

## 예외와 공개 오류 응답

입력·업무 규칙·알려진 자원 장애는 `global/error/BusinessException`의 상태와 안전한 공개 설명 사용. 기능별 의미가 있는 Post·Category·Series·위키 입력 예외와, 업로드 보상 정리에서 타입을 구분하는 `AttachmentFailure`는 하위 타입 유지. 기술 배지·이미지 정규화 오류는 공통 타입 직접 사용. 예상하지 못한 결함을 입력 오류로 감싸지 않는 기준.

`ApiErrorHandler`에서 HTTP 분류와 ProblemDetail 생성을 직접 수행. MCP와 공유하던 중간 PublicError DTO는 유일한 소비자에 통합하여 제거. Security/JDBC 세션과 공유하는 연결 장애 판별 함수만 global/error에 유지. 알려진 업무 실패 우선, 잠금 충돌 409, DB 연결 장애 503, 인증 실패 401, 프레임워크 지정 상태, 나머지 500 처리. 내부 메시지·SQL·비밀값은 응답에 복사하지 않고 예상하지 못한 오류 로그에는 클래스명만 기록. MVC 상태·Allow/Accept 헤더·확정 응답의 null 처리 및 MVC 밖 Security/JDBC 세션 경계 유지.

이전 OperationFailure의 잘못된 위치·미사용 code·중복 필드는 앞선 정리에서 제거한 상태. 이번 MCP 제거로 MCP 오류 코드 호환 분기와 이중 프로토콜 설명도 전부 제거. 공통 예외를 위한 별도 enum이나 새로운 추상화 없음. 기능별 예외 부모인 BusinessException만 JPA 선행 컴파일 대상에 포함하는 기존 생성 구조 유지.

## 이번 변경의 검증과 적용 범위

최종 clean build와 기존 MySQL·인증·HTTP·첨부 검사 35개 통과. 저장소 밖의 별도 MySQL/JVM을 원고 설정·마운트 없이 실행하여 CI와 동일한 관리자 HTTP 시나리오 검증: 로그인/로그아웃·권한/CSRF, PNG/JPEG 업로드·64px 배지, 분류/시리즈/글 등록·메타데이터/태그·이미지 연결·위키 선언·출간/공개 해제·제목 탐색·공개 snapshot. 새 위키 요청의 교체/정규화/빈 배열/잘못된 입력과 제거된 경로의 인증 후 GET/POST 404 확인. 최종 오류 처리 통합 JAR에서도 기동·인증·위키 변경 및 안전한 400/404/409 ProblemDetail 재확인.

Node 타입 검사·빈 Pages 생성과 실제 격리 API snapshot + 별도 Git 형식 원고의 완성 HTML 생성 통과. 위키 링크/역링크·이미지 포함, 미출간 파일과 옛 DB 본문 비노출 확인. 원고 누락 시 API snapshot은 정상이며 Node 빌드는 실패하고 이전 사이트 산출물 유지. 격리 DB의 옛 body/body_sha256 값은 메타데이터·위키 변경 후 보존. 기존 원고 파일 바이트와 사용자 수정 대조 완료.

최종 JAR의 MCP 코드·리소스·Spring AI/MCP 라이브러리·RepositoryMarkdown·중간 PublicError 부재 확인. API가 접근하는 파일은 이미지 저장소이며 원고 파일 접근 없음. 신규 저장소 테스트·원격 push·운영 배포·서버 파일 삭제 미수행. Git과 DB 선언의 일치/출간 준비 및 실제 운영 반영은 별도 책임.
