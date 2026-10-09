jOOQ가 쓸 테이블 타입을 어디서 만들지 정한 기록임. JPA 엔티티를 스키마의 원본으로 두고, 앱과 같은 Hibernate로 뽑은 DDL에서 jOOQ 타입을 만들기로 했음.

| 항목 | 내용 |
| --- | --- |
| 상태 | 채택 |
| 결정일 | 2026-10-02 |
| 후속 반영 | 2026-10-03 엔티티 상속·편집 버전·운영 스키마 경계 |
| 대상 | JPA와 jOOQ가 공유하는 영속 모델·코드 생성 |

## 맥락

JPA는 저장·단건 조회·변경 잠금을, jOOQ는 목록·집계·공개 스냅샷·공개 첨부 조회를 맡음. 둘이 같은 MySQL을 쓰므로 엔티티 매핑과 생성된 테이블 타입이 일치해야 함.

수동 `src/jooq/schema.sql`을 두면 엔티티와 SQL을 함께 고쳐야 하는 중복이 생김. 실제 DB를 역공학하면 빌드가 접속 정보·네트워크·스키마 준비에 의존하게 됨.

컴파일 순서도 제약이 됨. 앱은 jOOQ가 만든 타입에 의존하는데, 그 타입을 만들려면 JPA 엔티티를 먼저 컴파일해야 함. 앱 전체를 먼저 컴파일하면 순환 의존이 생김.

## 결정

**JPA 엔티티 선행 컴파일 → Hibernate DDL 출력 → jOOQ 타입 생성 → 애플리케이션 컴파일.**

| 단계 | 처리 |
| --- | --- |
| `compileJpaModelJava` | 원본 domain 클래스와 도메인 예외 공통 부모만 먼저 컴파일 |
| `generateJpaSchema` | 전용 클래스 로더에서 엔티티 매핑을 읽어 `build/generated/jooq/schema.sql` 출력 |
| `jooqCodegen` | DDLDatabase로 Java 테이블 타입 생성 |
| `compileJava` | 생성 타입을 포함해 앱 컴파일 |

서비스·HTTP 변환기는 선행 컴파일에서 뺌. 엔티티는 복사본 없이 같은 원본을 씀. DDL과 jOOQ 타입은 Git에 올리지 않고 빌드 때마다 다시 만드는 산출물임.

Hibernate는 앱과 같은 Spring Boot BOM으로 버전을 맞추고, MySQL dialect와 snake_case 이름 정책을 적용함. JDBC 메타데이터 접근과 DB schema action은 끄고 파일만 출력하며, 성공·실패와 관계없이 클래스 로더와 레지스트리를 정리함.

코드 생성에는 실제 DB 접속이 필요 없음. 의존성을 내려받는 데는 네트워크가 필요함.

## 대안

| 대안 | 이점 | 비용·판단 |
| --- | --- | --- |
| 수동 DDL | 입력이 단순하고 직접 검토 가능 | 엔티티와 스키마를 이중 관리해야 해서 제외 |
| 실제 DB 역공학 | 반영된 DB 구조를 직접 읽음 | 접속·네트워크·준비 순서에 의존 |
| jOOQ JPADatabase | 엔티티를 코드 생성 입력으로 사용 | 당시 확장과 앱 Hibernate 계열·MySQL 매핑의 호환 비용 |
| 앱 Hibernate → DDL → jOOQ | 앱 매핑과 이름 정책 공유, DB 없는 생성 | 채택. 선행 컴파일·생성 태스크 유지 필요 |

JPADatabase 판단은 당시 jOOQ 3.21.8 확장과 Hibernate 7.4 조합의 기록이며, 이후 버전에도 같은 제약이 있다고 보지 않음.

## 조회·도메인 계약

MySQL enum은 jOOQ 조회 경계에서 문자열로 매핑함. JOIN은 쿼리에 명시하고 필요한 메타데이터 열만 선택함.

JPA 엔티티와 프록시 접근자는 `final`로 선언하지 않고, 보호된 기본 생성자와 setter를 유지함. 앱과 jpaModel은 같은 엔티티 원본을 쓰며, 일반 타입과 복합 키는 상속을 열지 않음.

## 결과와 비용

엔티티를 바꾸면 Gradle 의존 관계에 따라 DDL과 테이블 타입이 다시 만들어짐. 코드 생성용 수동 스키마와 운영 DB 접속이 필요 없어짐.

도메인이 서비스나 생성된 jOOQ 타입에 의존하면 선행 컴파일 경계가 깨짐. 엔티티 위치, 이름 정책, dialect, Spring Boot 버전이 바뀌면 생성 설정을 다시 점검해야 함. 생성 태스크가 도메인 클래스를 읽으므로 Gradle 실행 JDK도 프로젝트 기준과 맞춰야 함.

## 운영 스키마 경계

생성 DDL은 코드 생성의 입력일 뿐 운영 DB에 자동 실행하지 않음. JDBC 세션·인증 상태 같은 비 JPA 테이블은 별도 SQL로 관리함.

운영은 validate와 SQL 초기화 비활성화로 기동하며, 기존 DB 이관과 최초 설치를 구분함. `posts.edit_version`·`admin_login_sources`는 검토한 이관 SQL로 반영했음. 엔티티만으로 모든 운영 상태를 복구할 수 있는 구조는 아님.

## 검증

2026-10-02 생성 방식을 바꿀 때 확인한 것:

- 생성 로직을 옮기기 전후의 DDL SHA-256이 같음
- clean 이후 엔티티·DDL·jOOQ·앱 순서로 빌드됨
- 다시 실행하면 생성 단계가 up-to-date로 건너뜀
- API JAR에 빌드 전용 생성기와 DDL이 들어가지 않음
- 격리 MySQL에서 저장·조회·공개 첨부 JOIN이 동작함

2026-10-03 프록시 상속 계약을 정리하면서 초기화 전 프록시의 getter·도메인 메서드 호출과 커밋 후 재조회를 영속성 통합 테스트에 추가했고, 생성 DDL이 바뀌지 않았음을 확인함.

현재 영속성 회귀 검사는 고유 제약, 실패 시 롤백, 프록시 변경, 동시 편집 충돌을 포함함. 코드 생성이 성공하는 것과 실제 DB에서 동작하는 것은 따로 검증함.

## 재검토 조건

- Hibernate·jOOQ·MySQL 변경으로 매핑을 올바르게 생성하지 못할 때
- 도메인 선행 컴파일 대상이 서비스·웹까지 넓어질 때
- 명시 마이그레이션 파일을 스키마 원본으로 바꿀 때
- 실제 DB와 생성 DDL의 차이가 반복될 때
- 다른 생성 방식의 호환성이 확인되어 유지 비용이 줄어들 때

다시 검토할 때는 생성 시간, 매핑 일치, DB 접속 의존, 원본 중복, 운영 이관 책임을 기준으로 비교함.

[영속성 결정 원문](https://github.com/gjaku1031/ken-blog/blob/b768152/docs/ADR/ADR_persistence.md) · [Gradle 구현](https://github.com/gjaku1031/ken-blog/blob/b768152/build.gradle) · [영속성 통합 검사](https://github.com/gjaku1031/ken-blog/blob/b768152/src/test/java/io/github/gjaku1031/kenblog/PostPersistenceIntegrationTest.java)
