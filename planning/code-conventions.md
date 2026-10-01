# 코드와 문서 작성 기준

## 백엔드

Kotlin 사용. Java 소스 추가 없음. 생성자 주입과 `val` 우선. Service는 구체 클래스, JPA Repository는 Spring Data JPA의 `JpaRepository`를 확장하는 인터페이스로 선언. HTTP 매핑·입력 설정은 구체 Controller에 선언하며 Swagger용 `*Api.kt` 계약 인터페이스와 문서 생성 계층 없음. 기본 CRUD는 상속받고 필요한 조건 조회만 파생 쿼리 등으로 선언하며 기본 메서드를 중복 선언하거나 불필요한 공통 Repository 계층을 만들지 않음.

새 엔티티 저장에서 즉시 DB 제약 검사가 필요한 경로는 `saveAndFlush` 사용. flush는 SQL 동기화이지 트랜잭션 커밋이 아니며 외부 트랜잭션 롤백 경계 유지. 상속 `findById`의 `Optional`은 Kotlin `findByIdOrNull`로 변환해 조회 결과가 없을 때 `null`을 반환. `Optional.get()`이나 강제 non-null로 내부 조회 계약을 바꾸지 않음.

패키지는 기능을 먼저 구분하고 그 아래 역할별로 배치. 예: `post/domain`, `post/repository`, `post/service`. 공통 설정·오류·보안 구성은 `global` 아래에서 관리하며, 루트 패키지에는 애플리케이션 진입점만 배치. 실제 선언이 없는 빈 계층이나 패키지 생성 없음.

오류 응답은 `ProblemDetail` 기반으로 구성. `ApiErrorHandler`의 Spring 기본 예외 처리 흐름과 HTTP 상태·헤더 보존. 예상하지 못한 예외의 내부 메시지를 응답에 포함하지 않음. 도메인 입력 검증에 일반 `IllegalArgumentException` 사용 금지. 아직 없는 계층이나 기능을 완료된 것으로 설명하지 않음.

## 웹 자산과 정적 배포

루트 Gradle Kotlin DSL Spring Boot 프로젝트 안의 `src/main/resources/web`에 TypeScript·CSS 자산 관리. HTML은 `resources/templates`의 Thymeleaf 템플릿 사용. 관리자는 Spring `/manage/`에서 렌더링하고 공개 사이트는 빌드 시 HTML을 생성해 GitHub Pages에 배포. npm은 컴파일·Markdown 렌더링·정적사이트 생성 전용이며 Next/React/Node 운영 서버 없음. 웹 본문 편집기 없음. Wrapper는 `gradlew`, 빌드 산출물은 `build/`, 독립 Pages 생성기의 클래스패스는 `writeSiteClasspath` 작업으로 준비.

본문 원본은 `content/posts/{slug}.md`, 미발행·기존 편집본 자료는 Git에서 제외한 로컬 파일로 보존. 본문 작성은 MCP/코드 도구로 저장소 파일을 직접 수정하며 서버의 초안·revision·본문 발행 서비스 없음. MySQL은 메타데이터·세션과 이전 본문의 복구용 호환 열 유지. 첨부 원본은 명시한 영속 로컬 디렉터리 사용. 본문을 받지 않는 메타데이터 등록과 공개 상태 변경은 허용하며 파일 본문을 자동 생성·교체·삭제하지 않음.

배포는 GitHub Actions의 `main` push 또는 수동 `workflow_dispatch`로 실행. DB 메타데이터 변경 후 공개 화면 반영은 Pages workflow 수동 실행. Spring 배포 상태·GitHub dispatch·claim/complete/recover 콜백·배포 중 전역 쓰기 차단 없음. 관리자 화면은 Actions 실행 페이지 연결과 반영 안내 제공.

Pages는 단일 읽기 전용 공개 DB 스냅샷과 checkout Markdown·로컬 이미지로 생성. 스냅샷은 공개 범위·부모 출간 조건을 확인하고 본문·계정·파일 key를 응답에서 제외. 같은 DB 일관 읽기에서 계산한 revision을 이미지 수집 전후 대조하여 메타데이터·자산 변경 시 생성 중단. workflow에서 서버 원고·DB 본문을 덮어쓰지 않음. 분류 트리·메타데이터·첨부 연결의 트랜잭션과 DB 고유 제약·외래 키는 유지.

## 주석

새로 만들거나 수정하는 클래스·함수에 한국어 KDoc 또는 JSDoc/TSDoc 작성. 역할을 먼저 설명하고 실제 흐름·반환 의미·예외·필요한 인자를 보충. `Unit` 반환 같은 불필요한 태그와 타입 반복 제외. 실제 선언을 가리키는 심볼 링크 사용, IDE 직접 확인 여부는 검증 기록에 구분.

## 변경 기록

영어 `type: summary` 또는 `type(scope): summary` 사용. 구현·검증·설명을 한 목적의 단위로 묶고 관련 없는 정리는 분리. 한국어 설명은 문제·변경 결과·실제 검증 순서로 작성, 문서의 종결은 `없음`, `반환`, `확인` 등 명사형 사용.

## 참고

- [Kotlin KDoc](https://kotlinlang.org/docs/kotlin-doc.html)
- [TSDoc](https://tsdoc.org/)
- [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/)
- [Google 변경 설명 지침](https://google.github.io/eng-practices/review/developer/cl-descriptions.html)

## 인증 경계

인증은 Spring Security의 서버 세션과 Spring Session JDBC 사용. 계정·메타데이터·세션은 MySQL에 저장. Flyway 의존성과 과거 마이그레이션은 사용자 확정에 따라 제거. 개발 DB는 JPA `ddl-auto=update`로 생성하며 필요 시 `APP_JPA_DDL_AUTO`로 변경. JPA 밖 세션·인증 테이블과 분류 변경 잠금의 단일 행은 JPA 이후 `schema.sql`의 `IF NOT EXISTS`·`INSERT IGNORE`로 준비하여 재기동 시 기존 상태 보존. 배포·편집본 테이블의 신규 생성 없음, 기존 자료의 실제 DROP/삭제 없음. 로그인·로그아웃·CSRF·세션 ID 교체·권한 검사 유지. 비밀번호·세션 식별자·CSRF 토큰 원문은 로그나 객체 문자열에 노출하지 않음. Redis 캐시와 통계·비공개 출간 기능 제거. 기존 PRIVATE 자료는 공개 자동 전환 없이 보존.

## 검증 범위

단순 기능의 신규 테스트 코드는 추가하지 않음. 기존 테스트는 유지하며 패키지 이동에 필요한 참조만 수정. 빌드·기존 검사·실제 HTTP 확인 중 변경에 맞는 검증 수행. 실행 결과와 확인하지 않은 범위는 구분하여 기록.
