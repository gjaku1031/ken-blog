# 애플리케이션 구조 결정

기준일: 2026-10-02. 상태: 소스 구현 완료, 기존 운영 자료 이관 및 사이트 전환 전.

## 글과 탐색

일반 글과 프로젝트 문서를 공통 `Post`로 관리하고, 묶음은 `Series`의 `TECH`·`PROJECT` 종류로 구분. 별도 Notes 분류는 제거. navbar는 Home·Posts·Projects이며 Posts는 일반 글, Projects는 프로젝트 시리즈 탐색. 기술 스택과 프로젝트 기간은 프로젝트 시리즈에만 지정. 시리즈 또는 소분류의 지정 순서상 첫 공개 문서를 대문으로 사용.

별도 Notes·Tech·Project 문서 모델을 유지하는 대안은 단순해진 요구사항에서 저장·조회·탐색 계약을 중복시키므로 제외. 글 ID·slug·기존 본문·비공개 자료는 `ops/unify-post-series.py`의 명시적 이관 대상으로 보존하며 자동 공개하지 않는 기준.

## 원고와 화면

본문 정본은 `content/posts/{slug}.md`, DB는 메타데이터와 연결 관계 관리. 기존 DB 본문 열은 이관·복구 호환용으로 보존하며 신규 원고를 저장하는 경로로 사용하지 않음. 공개 원고만 Git 추적하고 미출간·비공개 원고와 비밀값은 공개 저장소에 반영하지 않는 기준.

웹 본문 작성·수정 화면과 본문 쓰기 API는 제거. 원고는 저장소에서 수정하고 웹/MCP는 지원하는 조회·메타데이터·로컬 이미지 기능 제공. 첨부는 영속 로컬 디스크로 관리하며 기존 OCI 객체는 해시를 대조해 이관할 때까지 보존.

공개·관리자 화면은 Node/TypeScript·Nunjucks로 빌드한 GitHub Pages 정적 파일. 본문 렌더링과 완성 HTML 조립을 Node로 통일하고 Kotlin SiteGenerator·Thymeleaf 제거. API는 Spring Boot, Node는 빌드 용도. `pages`의 공개 snapshot·revision 계약 유지. 독자용 공개 Post API·SPA 라우터·htmx 추가 없음. 배포 실행과 이력은 GitHub Actions 담당. 상세 배치와 운영 상태는 [인프라 ADR](ADR_infra.md) 참조.

## 홈 소개의 코드 관리

변경 빈도가 낮은 홈 소개는 `src/main/resources/web/site/templates/views/about.njk`의 정적 HTML로 직접 관리. 현재 공개 사이트의 이름·한 줄 소개·소개·GitHub·이메일 내용을 그대로 이전. 별도 DB 모델·설정 API·런타임 조회 없이 템플릿 수정과 Pages 배포로 반영하는 결정.

프로필 Controller·Service·DTO·Repository·Entity와 사진 업로드/조회/삭제 API 제거. 관리자 메뉴·폼·요청, snapshot의 profile 필드, 빌드의 사진 다운로드 및 보안/Caddy 경로 허용도 제거. 기존 MCP에는 프로필 전용 도구가 없어 도구 수 변경 없음. 공용 이미지 정규화는 남아 있는 기술 배지의 64px 생성·교체에만 사용.

기존 운영 `home_profile` 행과 사진 파일의 실제 삭제는 수행하지 않음. 옛 DB/OCI 자료 이관 도구의 사진 참조는 자료 보존용으로 유지하며 애플리케이션 기능과 구분.

검증: 기존 JVM 검사 35개, 타입 검사·빈 사이트 및 프로필 없는 실제 격리 API snapshot 기반 생성 통과. 관리자 인증 후 제거한 API 5개 모두 404, 기술 배지 생성·교체 64px 및 기존 프로필 DB 행 보존 확인. JPA 생성 DDL·jOOQ 생성 코드·API JAR에서 프로필 모델 부재 확인. 실제 격리 API에 Chromium으로 로그인·관리자 목록 조회·로그아웃 검증, 프로필 네트워크 요청과 JavaScript 오류 없음. 원격 push·운영 반영 전 상태.

## 인증과 제거한 기능

단일 설정 관리자 계정의 비밀번호 로그인, Spring Security·JDBC 세션·CSRF·로그인 실패 제한 유지. 관리자 계정 변경 시 세션 해제. MFA·TOTP·복구 코드 기능은 제거하고 이전 인증 세션의 자동 재사용은 차단. JWT나 Redis 세션으로 전환하지 않는 결정.

잔디·조회수 통계·Google Analytics 수집 및 대시보드 기능 제거. Next.js/React·웹 편집기·Redis·런타임 OCI Object Storage·Flyway·Swagger 의존도 제거. 기능 제거를 이유로 기존 DB·원고·첨부·계정·백업의 실제 자료를 삭제하지 않는 기준.

검증 이력: Post·Series 통합 시 기존 JVM 검사 35개, Pages 생성, Native API의 비밀번호 로그인·jOOQ 조회·MCP·이미지 기능 검증 완료. 배포 및 성능 검증의 데이터 범위와 제한은 인프라 ADR에 별도 기록.

## 예외와 공개 오류 응답

### 조사와 분류 기준

기존 `operations/domain/OperationFailure`는 Markdown 조회·기술 배지·이미지 검증·MCP 입력 검증이 공유하는 실패로, 운영 기능 전용 패키지와 실제 역할의 불일치. HTTP의 기능별 핸들러와 MCP의 타입 분기가 별도로 상태·설명을 정의하여 같은 실패의 의미가 달라지는 구조. 선택적 `code`는 값을 지정한 사용처가 없고 HTTP 확장 필드도 실제 생성되지 않는 상태.

- 입력·업무 규칙·알려진 자원 장애: `global/error/BusinessException`의 HTTP 상태와 안전한 공개 설명으로 표현. 별도 기능 타입이 필요 없는 Markdown·배지·이미지·MCP 검증은 직접 사용.
- 기능별 의미나 타입 분기가 필요한 실패: Post·Category·Series·Wiki 예외와 `AttachmentFailure`를 공통 예외의 하위 타입으로 유지. 없는 글·중복 slug·원고 SHA 충돌 등의 의미 보존. 첨부 실패 타입은 업로드 보상 정리와 이미지 검증의 catch 경계에서 사용하므로 제거 금지.
- 예상하지 못한 결함: 일반 예외를 입력 오류로 감싸지 않고 공통 경계에서 안전한 서버 오류로 처리. 내부 메시지·SQL·파일 경로·비밀값을 응답에 복사하지 않는 기준. Markdown 안내의 기존 검증된 저장소 상대 경로만 유지.

기능별 예외 자체는 모두 사용 중이므로 삭제 대상이 아니며 서로 다른 의미를 하나로 합치지 않는 결정. 상태·설명은 각 예외에 한 번 선언하고 `AttachmentFailure`의 중복 필드, `OperationFailure`와 미사용 `code`, 양쪽 경계의 기능별 중복 매핑 제거. 중복 slug 예외의 미사용 원문 인자는 제거하되 원인 예외 보존. DB 본문을 전제로 한 Wiki 충돌 주석은 실제 Markdown 원본 기준으로 수정.

### HTTP·MCP 변환과 호환성

`PublicError`에서 공통 공개 상태·설명을 결정하고 `ApiErrorHandler`와 `McpToolCalls`는 각 프로토콜의 응답으로 변환. 알려진 업무 예외 우선, 잠금 충돌 409, 원인 체인에서 확인한 DB 연결 장애 503, 인증 실패 401, 프레임워크 지정 상태, 나머지 500 순서. 예상하지 못한 서버 오류는 메시지나 원인 대신 예외 클래스명만 로그에 기록. 새로운 오류 코드 enum이나 예외별 매핑 계층 추가 없음.

HTTP는 기존 상태·ProblemDetail의 title/status/detail/instance 형태와 Allow·Accept 등 프로토콜 헤더 유지. Spring MVC의 구체적 예외는 `ResponseEntityExceptionHandler` 경계에서 처리하고 확정된 응답의 null 결과 보존. MVC 밖 인증·권한·JDBC 세션 오류는 기존 Security 필터 경계 유지하며 DB 연결 판별 함수만 `global/error`에서 공유.

MCP는 기존 `isError`, `{ok:false,error:{code,message}}`, 구조화 본문과 JSON 텍스트의 동시 반환 계약 유지. 업무 오류의 validation/not_found/conflict/unavailable 코드도 유지하며 메시지만 HTTP의 구체적인 안전한 설명으로 통일. 상태→MCP 코드 변환은 숫자로 비교하여 Spring의 413 상태 별칭 차이로 동일 상태가 다른 코드가 되는 문제 방지. 실제 첨부 크기 초과의 기존 validation 계약 유지.

기존 MCP의 모든 `DataAccessException` → unavailable 규칙과 그 밖의 비업무 예외 → internal 규칙은 클라이언트 호환성 때문에 유지. 따라서 직접 전달된 잠금·SQL 문법·무결성 오류의 코드는 unavailable, 다른 예외에 감싸진 DB 연결 장애의 코드는 internal인 기존 한계 존속. 다만 잠금 충돌은 충돌 설명, 예상하지 못한 SQL 오류는 서버 오류 설명으로 구분하여 모든 DB 실패를 연결 장애라고 잘못 설명하던 동작 제거. 코드까지 재분류하는 변경은 별도 외부 계약 변경 대상으로 분리.

공통 예외에서 HttpStatus를 유지하는 선택은 기존 HTTP 중심 계약과 일치하며, 별도 상태 enum과 변환 계층을 만들지 않기 위한 기준. 도메인 선행 컴파일에는 이 부모 클래스만 포함하며 JPA 스키마 생성의 독립성 유지.

검증: clean build와 기존 MySQL·인증·HTTP·첨부 검사 35개 통과. 저장소 밖 격리 검사 44개 통과: 기능별 예외·공통/첨부 상태·실제 Markdown/이미지/본문 선언 오류·연결/잠금/SQL 오류·인증/프레임워크 오류의 HTTP 상태와 MCP 코드, 공개 설명 일치, 내부 문자열 비노출, 성공 응답, 원인 보존, 응답 확정 후 처리 및 JDBC 세션 필터 경계 확인. 413의 기존·새 상태 별칭 모두 validation 확인. 최종 API JAR에 옛 예외·격리 검증 코드 없음. 신규 저장소 테스트·원격 push·운영 배포 없음.
