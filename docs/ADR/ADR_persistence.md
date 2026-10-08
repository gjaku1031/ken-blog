# JPA 중심 영속성과 jOOQ 코드 생성

2026-10-03 리뷰 후 `posts.edit_version`과 인증 출처 테이블의 명시 이관을 추가했다. 문서 끝의 **편집 버전과 운영 스키마 경계**가 이번 변경의 현재 계약이며, 이전 검증의 “스키마 변경 없음”은 당시 접근 제어 정리에 한정한다.

기준일: 2026-10-02. 상태: 채택.

## 결정과 배경

JPA는 저장·단일 조회·변경 잠금, jOOQ는 목록·집계·공개 스냅샷·공개 첨부 조회와 연결 검증용 첨부 행 잠금 담당. 영속 모델의 원본은 JPA 엔티티이며 jOOQ를 위해 별도 SQL 스키마를 수동 관리하지 않는 결정. 기존 `src/jooq/schema.sql`은 엔티티와 변경을 이중 관리해야 하므로 제거.

빌드 순서는 다음과 같음.

```text
원본 domain Java → compileJpaModelJava → generateJpaSchema
  → build/generated/jooq/schema.sql → jooqCodegen → compileJava
```

빌드 전용 `jpaModel` 소스셋에서 `src/main/java`의 원본 도메인 클래스와 도메인 예외의 공통 부모 `global/error/BusinessException`·문자열 공통 함수 `global/text/Text`만 먼저 컴파일. HTTP 응답 변환기와 서비스는 제외. 생성 로직은 `build.gradle`의 `generateJpaSchema` 태스크에 두고 별도 생성기 소스는 두지 않음. Gradle의 빌드용 Hibernate 의존성도 앱과 같은 Spring Boot BOM으로 관리. 앱과 동일한 Hibernate 버전·MySQL dialect·snake_case 물리 이름 정책으로 JPA 매핑을 읽어 DDL 출력. JDBC 메타데이터 접근과 DB schema action은 비활성화. jOOQ `DDLDatabase`가 생성된 DDL을 읽고 Java 테이블 타입 생성.

`build/`의 DDL과 테이블 코드는 재생성 가능한 Git 제외 산출물. 엔티티를 수정하면 Gradle 의존 관계에 따라 재생성하며 개발·CI에서 실제 DB 접속 불필요. 도메인을 별도 저장소나 모듈로 옮기지 않고 먼저 컴파일하여 앱 컴파일과 jOOQ 생성 간 순환 의존을 해소. 태스크는 전용 클래스 로더로 엔티티를 읽고 종료 시 레지스트리·로더 정리. Spring 앱을 기동하지 않으며 빌드 전용 클래스 출력은 API JAR에 포함하지 않음.

MySQL enum 열은 jOOQ 조회 경계에서 문자열 타입으로 매핑하여 JPA의 `EnumType.STRING` 저장 계약 유지. JOIN은 쿼리에 명시하며 자동 관계 경로 생성은 비활성화. 글 조회는 필요한 메타데이터 열을 명시적으로 선택함.

## 대안과 영향

- 수동 DDL 유지: 빌드는 단순하지만 엔티티와 스키마 불일치 가능성 때문에 제외.
- 실제 DB 역공학: 현재 운영 상태를 반영할 수 있으나 빌드에 접속 정보·네트워크·DB 준비 순서가 필요하므로 제외.
- jOOQ `JPADatabase`: 엔티티 기반 생성 방향은 같으나 현재 3.21.8 확장의 Hibernate 5 계열과 앱의 Hibernate 7.4, MySQL 전용 columnDefinition의 호환 비용을 피하기 위해 앱의 Hibernate로 직접 DDL 출력. [jOOQ JPA 코드 생성 안내](https://www.jooq.org/doc/latest/manual/code-generation/codegen-meta-sources/codegen-jpa/)

비용은 도메인의 빌드 전용 컴파일 단계와 Gradle 태스크 유지. jOOQ의 필수 폴더 구조가 아니라 JPA 엔티티를 원본으로 삼고 DB 없이 빌드하기 위한 프로젝트 선택. 도메인 코드가 서비스·컨트롤러·생성된 jOOQ 타입을 참조하면 이 단계가 깨지므로 독립성 유지. 엔티티 배치가 `domain` 밖으로 바뀌거나 Hibernate 이름 정책·dialect가 바뀌면 빌드 설정도 함께 갱신. Spring Boot 버전을 바꾸면 플러그인과 buildscript BOM 버전을 함께 변경. 생성 태스크가 Gradle JVM에서 도메인 클래스를 읽으므로 Gradle도 프로젝트 기준인 JDK 25로 실행. 이 방식은 엔티티 매핑에서 생성하므로 실제 DB와의 차이는 DB 통합 검증에서 확인.

런타임 `src/main/resources/schema.sql`은 JDBC 세션·인증 상태 등 JPA 외 테이블 초기화용이므로 유지. 앱의 기존 `ddl-auto` 정책과 운영 자료 이관 절차도 별도 책임이며, 코드 생성 DDL을 운영 DB에 실행하지 않음.

## 프로필 영속 모델 제거

홈 소개의 정적 HTML 전환으로 HomeProfileEntity와 Repository 제거. 다음 clean 빌드에서 프로필 테이블 DDL·jOOQ 타입도 생성 대상에서 제외. 기존 운영 테이블·행·사진은 DROP 또는 파일 삭제 없이 보존. 격리 DB에 기존 home_profile 행을 둔 상태로 새 JVM을 기동하여 행 보존 확인. 후속 운영 도구 제거 결정으로 DB/OCI 자료 추출 스크립트도 삭제. 기존 테이블·행·사진을 실제 삭제하는 변경 없음.

## 원고 접근 제거 후 보존 모델

MCP·RepositoryMarkdown 제거 후에도 옛 Post body/body_sha256 매핑과 PostBodyHash의 빈 값 초기화는 기존 스키마 호환을 위해 유지(2026-10-08 제거, 문서 끝 참조). 파일 접근·API 본문 조회·원고 해시 충돌 검사와 별개이며 기존 DB 열 삭제·본문 덮어쓰기 없음. 위키 선언 테이블과 관리자 교체 트랜잭션·조회 쿼리도 유지(2026-10-07 결정으로 제거, 문서 끝 참조). 아래 MCP 검증은 제거 전 이력이며 현재 API는 관리자 HTTP와 Node Pages 빌드로 검증.

## 첨부 쓰기 제거의 영속성 경계 — 2026-10-02

첨부 CRUD Repository와 엔티티 생성·상태 전환 메서드 제거(남은 상태·등록자 열은 2026-10-08 제거, 문서 끝 참조). 글 연결 교체 시 필요한 ID별 확인은 `PostQueries`의 첨부 행 `FOR UPDATE` 조회(현재 `lockAttachment`)로 이전. 부모 글→정렬된 첨부 ID 순서·Spring 공유 트랜잭션·JPA 연결 쓰기를 유지하여 외부 DB 상태 변경과 검증/연결 사이의 경합을 방지. 생성 DDL은 변경 전과 바이트 동일. 격리 DB의 외부 상태 변경 잠금에 대기한 연결 요청이 변경 상태를 확인해 409를 반환하며 기존 연결 보존 확인. 잘못된 첨부를 포함한 글 생성은 같은 트랜잭션에서 롤백 확인.

## JPA 엔티티의 프록시 상속 허용 — 2026-10-03

일반 클래스의 내부 상태는 `private`로 제한하되, JPA 엔티티는 Hibernate 프록시를 위해 클래스와 접근자를 `final`로 선언하지 않는 결정. 각 엔티티는 `protected` 기본 생성자와 `protected` setter, 필드 매핑을 유지하고, 복합 키 `@Embeddable`은 값 비교를 위해 `final`을 유지함. 작성 기준은 [CODE.md](../convention/CODE.md)에 기록.

- `PostPersistenceIntegrationTest`에 초기화 전 프록시의 getter·도메인 메서드 호출과 커밋 후 재조회 검증 추가.
- 생성 DDL의 변경 전후 바이트 동일. 테이블·열·FK·인덱스 변경 없음.

## 검증과 적용 범위

- 생성 로직을 `build.gradle`로 옮긴 뒤 생성 DDL의 SHA-256이 이전 독립 생성기 결과와 동일함을 확인. 저장소에 별도 생성기 소스나 수동 DDL 없음.
- `clean` 이후 엔티티 컴파일·오프라인 DDL·jOOQ 코드 생성·앱 컴파일·Spring AOT·bootJar 생성 성공. 재실행 시 생성 단계의 Gradle up-to-date 동작 확인.
- 기존 MySQL 통합 검사를 포함한 35개 검사 통과, 실패·오류·건너뜀 0. 로컬 파일 저장소의 권한 계약에 맞게 검증 프로세스에 `umask 0077` 적용.
- 별도 빈 MySQL의 JVM API에서 CI 기능 시나리오 통과: 비밀번호 로그인·로그아웃, MCP, Series/Post 등록·목록·검색·공개 대문·스냅샷 v2, PNG/JPEG·배지 및 enum 조건을 포함한 공개 첨부 JOIN.
- 해당 시나리오의 실제 jOOQ SQL 20개에서 옛 본문·본문 해시 열을 선택하지 않는 것 확인.
- API JAR에서 빌드 전용 생성기와 생성용 DDL 제외 확인. 런타임 초기화용 `schema.sql`만 유지.

이번 변경에서 Native 이미지를 다시 빌드하거나 서버를 재배포하지 않음. 기존 운영 DB·파일·Pages·시크릿은 변경하지 않은 상태.

## 기존 운영 DB의 Post·Series 이관 — 2026-10-02

운영 DB 백업·원고/편집본 추출 후 별도 복사 DB에서 이관과 API·Pages 조회 확인. 기존 `ck_posts_owner_shape`는 section과 옛 project/course 열의 조합을 강제하여 section의 TECH 정규화와 충돌. 통합 모델에서 폐기된 이 CHECK만 제거하고 기존 정의는 DB 백업에 보존. 다른 공개·상태·출간일 CHECK와 FK는 유지. 기존 분류와 부모 열 값은 `post_model_legacy_metadata`에도 보존하며 원본 테이블·옛 본문 열 삭제 없음.

원고·ID·slug·본문 해시와 기존 첨부·계정·기술·프로젝트·편집본 행 대조 후 운영 적용. 글 7개·프로젝트 시리즈 6개와 기술 연결 이관 확인. 생성된 시리즈 ID는 기존 프로젝트 ID 11~16으로 명시적으로 맞추고 글 소속·관련 프로젝트·기술 연결 FK도 함께 갱신. 격리 복사본 검증 후 운영 API 쓰기를 중지한 단일 트랜잭션에서 처리하고 고아 참조·ID·연결 순서 대조. 공개 글 7개만 Git 원고로 반영, 편집본 4개와 메타데이터 보존본은 저장소 밖 백업. 초기 실패의 DML은 롤백 확인 후 복사 DB 검증을 거쳐 재시도. 런타임 자동 이관이나 운영 CLI의 저장소 재도입 없음.

## 편집 버전과 운영 스키마 경계 — 2026-10-03

`posts.edit_version BIGINT NOT NULL`을 추가한다. 기존 행은 명시 마이그레이션에서 0으로 시작한다. 비관적 글 잠금 안의 서비스가 버전을 증가시키므로 JPA `@Version`과 일괄 JPQL 갱신을 혼용하지 않는다. 분류 삭제의 일괄 이동도 버전을 증가시키고 기존 body·body_sha256·series_order는 보존한다. 관리자 상세는 본문 열 없는 jOOQ projection으로 읽는다.

Series 생성자는 재정의 가능한 `replace` 호출 대신 필드를 직접 초기화한다. Post 버전 접근자·변경 메서드를 포함하여 앱·jpaModel 모두 상속 가능한 클래스·접근자와 protected setter 계약을 유지한다. 생성 DDL을 리뷰 기준 `7299253`과 대조하면 JPA 변경은 edit_version 열 하나이며 FK·인덱스는 동일하다. 비 JPA `admin_login_sources`와 인증 상태의 별도 bootstrap·복구는 검토 가능한 SQL로 관리한다.

운영은 `ddl-auto=validate`, `sql.init.mode=never`로 고정한다. 개발의 update/보조 테이블 초기화는 유지하지만 인증 상태 행은 최초 설치 때만 별도로 만든다. 기존 DB에는 한 번 실행하는 이관 SQL(2026-10-03 적용 완료 후 저장소에서 제거), 새 DB에는 검토한 전체 생성 DDL과 bootstrap을 사용한다([API 배포 절차](../../deploy/API-RELEASE.md)). MySQL DDL 전체가 하나의 롤백 가능한 트랜잭션이라고 가정하지 않으며 유지보수 창·백업·열 존재 확인을 먼저 수행한다.

격리 DB에서 실제 잠금 경쟁·태그 롤백·분류 일괄 이동·프록시 변경 감지와 300개 글의 공개·관리자 스냅샷을 검사한다. 공개 snapshot의 ORM+jOOQ SELECT 합계는 10개 이하, 300개 탐색 그룹의 JSON은 500KB 미만을 검사한다. 이 값은 해당 fixture의 회귀 기준이며 모든 운영 자료의 지연·메모리 상한을 실측한 값은 아니다. 전체 응답 상한에 이르면 조용히 자르지 않고 실패한다.


## IDE 소스 경로 — 2026-10-06

앱과 DDL 생성용 `jpaModel`이 같은 `src/main/java`를 사용하므로 Buildship의 기본
Eclipse 모델에서 도메인 전용 포함 필터가 앱 소스 경로에 적용되는 문제 확인.
Gradle 컴파일은 성공하지만 JDT LS는 앱 서비스·DTO를 찾지 못하는 상태였음.

`eclipse.classpath.sourceSets`에는 `main`·`test`만 등록하고, `beforeMerged`에서
이전에 가져온 `gradle_scope=jpaModel` 소스 항목을 제거. `synchronizationTasks`에는
`jooqCodegen`을 연결하여 첫 가져오기에도 생성 타입 준비. 실제 DDL 생성은 기존
`jpaModel`을 계속 사용. 생성 `.classpath`의 수동 수정이나 진단 억제 없음.

`eclipseClasspath` 반복 생성 후 앱 경로에 포함 필터와 `jpaModel` 항목이 없는 것 확인.
JDT LS 프로젝트 갱신·빌드 후 현재 Neovim에 수집된 오류·경고 0건 확인.
미사용 import를 제거하고 테스트 컨테이너는 지역 변수로 생성·설정한 뒤 반환하여
분석기가 자원 소유권의 이전을 추적할 수 있도록 정리. 시작·종료는 Spring 테스트
컨텍스트가 관리. 영속성 통합 테스트와 Javadoc 문서 생성 검사 통과.

## 위키 선언 테이블 제거 — 2026-10-07

관리자 위키 선언 기능 삭제([애플리케이션 ADR](ADR_application.md) 참조)에 따라 `PostWikiLinkEntity`와 `PostWikiLinkRepository`, 선언 교체·제목 검색 쿼리를 제거한다. 다음 빌드부터 생성 DDL과 jOOQ 타입에 `post_wiki_links`가 포함되지 않는다. 위키 링크·역링크는 DB에 저장하지 않고 Node 빌드가 원고에서 계산한다.

운영 테이블은 애플리케이션이 자동으로 삭제하지 않는다. 새 API 배포 후 2026-10-07 [정리 SQL](../../deploy/sql/drop-legacy-tables-2026-10-07.sql)로 `post_wiki_links`를 삭제했고, 같은 SQL로 이관 전 모델 테이블 12개와 `posts`의 이관 전 열 6개·관련 FK 3개·인덱스 4개도 정리했다. 사용자 결정으로 백업 없이 실행했으며, 운영 테이블은 27개에서 14개가 됐다. 글 삭제 시 연결 행을 지우던 `post_id` CASCADE도 테이블과 함께 사라진다.

## 옛 열 제거 — 2026-10-08

현재 기능에서 읽지 않는 열을 엔티티와 운영 DB에서 함께 제거한다. 대상은 `posts.body`·`body_sha256`(Git 원고가 정본이 된 뒤 새 글에는 빈 값만 저장하던 열), `posts.pin_order`·`view_count`와 `ix_posts_pin` 인덱스, `attachments.pending_cleanup`, 코드에 없던 `admin_auth_state.last_totp_step`. `PostBodyHash`는 관리자 설정 지문 계산만 남아 `AdminAuthSettings`로 옮겼다.

`ddl-auto=validate`는 DB에 남은 여분 열을 허용하지만 NOT NULL·기본값 없는 `body`·`body_sha256`은 새 엔티티의 INSERT를 막는다. 그래서 확장-축소 순서로 적용한다. ① [NULL 허용 SQL](../../deploy/sql/legacy-columns-nullable-2026-10-08.sql) ② 새 API 배포 ③ [열 삭제 SQL](../../deploy/sql/drop-legacy-columns-2026-10-08.sql). 옛 본문이 남아 있던 글 7개는 모두 Git 원고가 있어 사용자 결정으로 백업 없이 삭제한다. 앞선 ADR의 "옛 body/body_sha256 유지"는 이 결정으로 대체한다.

## 값이 고정된 열 제거 — 2026-10-08

쓰기 기능을 없앤 뒤 값이 하나로 고정되거나 아무도 읽지 않는 열을 제거한다. `attachments.status`(모두 READY), `attachments.original_filename`·`uploaded_by`(등록자는 관리자 한 명), `users.display_name`, `posts.section`(모두 TECH), `posts.visibility`·`series.visibility`(CHECK로 PUBLIC만 저장 가능), `series.legacy_source`·`legacy_id`와 `uk_series_legacy`(이관 완료). 공개 조건은 "출간된 글"과 "공개 글에 연결된 첨부"가 되고, 첨부 연결 교체는 상태 대신 첨부 행의 존재를 `FOR UPDATE`로 확인한다. 공개 스냅샷의 revision 입력에서도 첨부 상태 값이 빠진다.

같은 확장-축소 순서로 적용한다. ① [기본값 SQL](../../deploy/sql/fixed-columns-default-2026-10-08.sql)(기본값 없는 NOT NULL `series.visibility`) ② 새 API 배포 ③ [열 삭제 SQL](../../deploy/sql/drop-fixed-columns-2026-10-08.sql).
