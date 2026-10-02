# JPA 중심 영속성과 jOOQ 코드 생성

기준일: 2026-10-02. 상태: 채택.

## 결정과 배경

JPA는 저장·단일 조회·변경 잠금, jOOQ는 목록·검색·집계·위키·공개 첨부 조회와 연결 검증용 첨부 상태 잠금 담당. 영속 모델의 원본은 JPA 엔티티이며 jOOQ를 위해 별도 SQL 스키마를 수동 관리하지 않는 결정. 기존 `src/jooq/schema.sql`은 엔티티와 변경을 이중 관리해야 하므로 제거.

빌드 순서는 다음과 같음.

```text
원본 domain Kotlin → compileJpaModelKotlin → generateJpaSchema
  → build/generated/jooq/schema.sql → jooqCodegen → compileKotlin
```

빌드 전용 `jpaModel` 소스셋에서 `src/main/kotlin`의 원본 도메인 클래스와 도메인 예외의 공통 부모 `global/error/BusinessException`만 먼저 컴파일. HTTP 응답 변환기와 서비스는 제외. 생성 로직은 `build.gradle.kts`의 `generateJpaSchema` 태스크에 통합하고 별도 `src/jooq/kotlin` 생성기 파일은 제거. Gradle의 빌드용 Hibernate 의존성도 앱과 같은 Spring Boot BOM으로 관리. 앱과 동일한 Hibernate 버전·MySQL dialect·snake_case 물리 이름 정책으로 JPA 매핑을 읽어 DDL 출력. JDBC 메타데이터 접근과 DB schema action은 비활성화. jOOQ `DDLDatabase`가 생성된 DDL을 읽고 Kotlin 테이블 타입 생성.

`build/`의 DDL과 테이블 코드는 재생성 가능한 Git 제외 산출물. 엔티티를 수정하면 Gradle 의존 관계에 따라 재생성하며 개발·CI에서 실제 DB 접속 불필요. 도메인을 별도 저장소나 모듈로 옮기지 않고 먼저 컴파일하여 앱 컴파일과 jOOQ 생성 간 순환 의존을 해소. 태스크는 전용 클래스 로더로 엔티티를 읽고 종료 시 레지스트리·로더 정리. Spring 앱을 기동하지 않으며 빌드 전용 클래스 출력은 API JAR에 포함하지 않음.

MySQL enum 열은 jOOQ 조회 경계에서 문자열 타입으로 매핑하여 JPA의 `EnumType.STRING` 저장 계약 유지. JOIN은 쿼리에 명시하며 자동 관계 경로 생성은 비활성화. 전체 엔티티에서 생성된 테이블에는 옛 본문 열도 있으므로, 글 조회는 필요한 메타데이터 열을 명시적으로 선택하고 본문을 읽지 않는 계약 유지.

## 대안과 영향

- 수동 DDL 유지: 빌드는 단순하지만 엔티티와 스키마 불일치 가능성 때문에 제외.
- 실제 DB 역공학: 현재 운영 상태를 반영할 수 있으나 빌드에 접속 정보·네트워크·DB 준비 순서가 필요하므로 제외.
- jOOQ `JPADatabase`: 엔티티 기반 생성 방향은 같으나 현재 3.21.8 확장의 Hibernate 5 계열과 앱의 Hibernate 7.4, MySQL 전용 columnDefinition의 호환 비용을 피하기 위해 앱의 Hibernate로 직접 DDL 출력. [jOOQ JPA 코드 생성 안내](https://www.jooq.org/doc/latest/manual/code-generation/codegen-meta-sources/codegen-jpa/)

비용은 도메인의 빌드 전용 컴파일 단계와 Gradle 태스크 유지. jOOQ의 필수 폴더 구조가 아니라 JPA 엔티티를 원본으로 삼고 DB 없이 빌드하기 위한 프로젝트 선택. 도메인 코드가 서비스·컨트롤러·생성된 jOOQ 타입을 참조하면 이 단계가 깨지므로 독립성 유지. 엔티티 배치가 `domain` 밖으로 바뀌거나 Hibernate 이름 정책·dialect가 바뀌면 빌드 설정도 함께 갱신. Spring Boot 버전을 바꾸면 플러그인과 buildscript BOM 버전을 함께 변경. 생성 태스크가 Gradle JVM에서 도메인 클래스를 읽으므로 Gradle도 프로젝트 기준인 JDK 25로 실행. 이 방식은 엔티티 매핑에서 생성하므로 실제 DB와의 차이는 DB 통합 검증에서 확인.

런타임 `src/main/resources/schema.sql`은 JDBC 세션·인증 상태 등 JPA 외 테이블 초기화용이므로 유지. 앱의 기존 `ddl-auto` 정책과 운영 자료 이관 절차도 별도 책임이며, 코드 생성 DDL을 운영 DB에 실행하지 않음.

## 프로필 영속 모델 제거

홈 소개의 정적 HTML 전환으로 HomeProfileEntity와 Repository 제거. 다음 clean 빌드에서 프로필 테이블 DDL·jOOQ 타입도 생성 대상에서 제외. 기존 운영 테이블·행·사진은 DROP 또는 파일 삭제 없이 보존. 격리 DB에 기존 home_profile 행을 둔 상태로 새 JVM을 기동하여 행 보존 확인. 후속 운영 도구 제거 결정으로 DB/OCI 자료 추출 스크립트도 삭제. 기존 테이블·행·사진을 실제 삭제하는 변경 없음.

## 원고 접근 제거 후 보존 모델

MCP·RepositoryMarkdown 제거 후에도 옛 Post body/body_sha256 매핑과 PostBodyHash의 빈 값 초기화는 기존 스키마 호환을 위해 유지. 파일 접근·API 본문 조회·원고 해시 충돌 검사와 별개이며 기존 DB 열 삭제·본문 덮어쓰기 없음. 위키 선언 테이블과 관리자 교체 트랜잭션·조회 쿼리도 유지. 아래 MCP 검증은 제거 전 이력이며 현재 API는 관리자 HTTP와 Node Pages 빌드로 검증.

## 첨부 쓰기 제거의 영속성 경계 — 2026-10-02

첨부 CRUD Repository와 엔티티 생성·상태 전환 메서드 제거. `AttachmentEntity`와 `PostAttachmentEntity`의 기존 열·상태 enum·FK는 읽기와 코드 생성의 원본으로 유지하며 운영 자료/스키마 삭제 없음. 글 연결 교체 시 필요한 ID별 READY 확인은 기존 `PostQueries.lockAttachmentStatus`의 단일 상태 열 `FOR UPDATE` 조회로 이전. 부모 글→정렬된 첨부 ID 순서·Spring 공유 트랜잭션·JPA 연결 쓰기를 유지하여 외부 DB 상태 변경과 검증/연결 사이의 경합을 방지. 생성 DDL은 변경 전과 바이트 동일. 격리 DB의 외부 상태 변경 잠금에 대기한 연결 요청이 변경 상태를 확인해 409를 반환하며 기존 연결 보존 확인. 잘못된 첨부를 포함한 글 생성은 같은 트랜잭션에서 롤백 확인.

## 검증과 적용 범위

- 생성 로직을 `build.gradle.kts`로 옮긴 뒤 생성 DDL의 SHA-256이 이전 독립 생성기 결과와 동일함을 확인. 저장소에 별도 생성기 소스나 수동 DDL 없음.
- `clean` 이후 엔티티 컴파일·오프라인 DDL·jOOQ 코드 생성·앱 컴파일·Spring AOT·bootJar 생성 성공. 재실행 시 생성 단계의 Gradle up-to-date 동작 확인.
- 기존 MySQL 통합 검사를 포함한 35개 검사 통과, 실패·오류·건너뜀 0. 로컬 파일 저장소의 권한 계약에 맞게 검증 프로세스에 `umask 0077` 적용.
- 별도 빈 MySQL의 JVM API에서 CI 기능 시나리오 통과: 비밀번호 로그인·로그아웃, MCP, Series/Post 등록·목록·검색·공개 대문·스냅샷 v2, PNG/JPEG·배지 및 enum 조건을 포함한 공개 첨부 JOIN.
- 해당 시나리오의 실제 jOOQ SQL 20개에서 옛 본문·본문 해시 열을 선택하지 않는 것 확인.
- API JAR에서 빌드 전용 생성기와 생성용 DDL 제외 확인. 런타임 초기화용 `schema.sql`만 유지.

이번 변경에서 Native 이미지를 다시 빌드하거나 서버를 재배포하지 않음. 기존 운영 DB·파일·Pages·시크릿은 변경하지 않은 상태.
