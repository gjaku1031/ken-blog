JPA 엔티티를 스키마 원본으로 유지하고, 앱과 같은 Hibernate로 생성한 DDL에서 jOOQ 타입을 생성하는 결정.

| 항목 | 내용 |
| --- | --- |
| 상태 | 채택 |
| 결정일 | 2026-10-02 |
| 후속 반영 | 2026-10-03 엔티티 상속·편집 버전·운영 스키마 경계 |
| 대상 | JPA와 jOOQ가 공유하는 영속 모델·코드 생성 |

## 맥락

JPA는 저장·단일 조회·변경 잠금, jOOQ는 목록·검색·집계·공개 첨부 조회 담당. 같은 MySQL을 사용하므로 엔티티 매핑과 생성된 테이블 타입의 일치 필요.

수동 `src/jooq/schema.sql`을 유지하면 엔티티와 SQL을 함께 수정해야 하는 중복 발생. 실제 DB 역공학은 빌드에 접속 정보·네트워크·스키마 준비 의존 추가.

컴파일 순서도 제약. 앱은 jOOQ 생성 타입에 의존하지만, 타입 생성의 입력인 JPA 엔티티도 먼저 컴파일 필요. 전체 앱 컴파일을 선행하면 순환 의존 발생.

## 결정

**JPA 엔티티 선행 컴파일 → Hibernate DDL 출력 → jOOQ 타입 생성 → 애플리케이션 컴파일.**

| 단계 | 처리 |
| --- | --- |
| `compileJpaModelJava` | 원본 domain 클래스와 도메인 예외 공통 부모만 먼저 컴파일 |
| `generateJpaSchema` | 전용 클래스 로더에서 엔티티 매핑을 읽어 `build/generated/jooq/schema.sql` 출력 |
| `jooqCodegen` | DDLDatabase로 Java 테이블 타입 생성 |
| `compileJava` | 생성 타입을 포함해 앱 컴파일 |

서비스·HTTP 변환기는 선행 컴파일 대상에서 제외. 엔티티의 별도 복사본 없이 같은 원본 사용. DDL과 jOOQ 타입은 Git 제외·재생성 가능한 build 산출물.

Hibernate는 앱과 같은 Spring Boot BOM 사용. MySQL dialect와 snake_case 이름 정책 적용. JDBC 메타데이터 접근·DB schema action은 비활성화하고 파일만 출력. 성공·실패 후 클래스 로더·레지스트리 정리.

코드 생성에 실제 DB 접속 불필요. 의존성 다운로드까지 네트워크가 불필요하다는 의미는 아님.

## 대안

| 대안 | 이점 | 비용·판단 |
| --- | --- | --- |
| 수동 DDL | 입력이 단순하고 직접 검토 가능 | 엔티티와 스키마 이중 관리로 제외 |
| 실제 DB 역공학 | 반영된 DB 구조를 직접 읽음 | 접속·네트워크·준비 순서에 의존 |
| jOOQ JPADatabase | 엔티티를 코드 생성 입력으로 사용 | 당시 확장과 앱 Hibernate 계열·MySQL 매핑의 호환 비용 |
| 앱 Hibernate → DDL → jOOQ | 앱 매핑과 이름 정책 공유, DB 없는 생성 | 채택. 선행 컴파일·생성 태스크 유지 필요 |

JPADatabase 판단은 당시 jOOQ 3.21.8 확장과 Hibernate 7.4 조합의 기록. 이후 버전 전체에 같은 제약을 적용하지 않음.

## 조회·도메인 계약

MySQL enum은 jOOQ 조회 경계에서 문자열로 매핑. JOIN은 쿼리에 명시하고 필요한 메타데이터 열만 선택. 코드 생성에 옛 본문 열이 포함되어도 현재 조회에서 본문을 자동 선택하지 않음.

JPA 엔티티와 프록시 접근자에는 소스의 `open` 명시. 보호된 기본 생성자·setter 유지. 앱과 jpaModel은 같은 엔티티 원본 사용. 일반 타입과 복합 키까지 상속 범위를 확장하지 않음.

## 결과와 비용

엔티티 변경을 Gradle 의존 관계로 DDL·테이블 타입 재생성에 연결. 코드 생성용 수동 스키마와 운영 DB 접속 요구 제거.

도메인이 서비스·생성 jOOQ 타입에 의존하면 선행 컴파일 경계가 깨질 수 있음. 엔티티 위치·이름 정책·dialect·Spring Boot 변경 시 생성 설정 점검 필요. 생성 태스크가 도메인 클래스를 읽으므로 Gradle 실행 JDK도 프로젝트 기준에 맞춰야 함.

## 운영 스키마 경계

생성 DDL은 코드 생성의 입력. 운영 DB에 자동 실행하지 않음. JDBC 세션·인증 상태 같은 비 JPA 테이블은 별도 SQL 관리.

운영은 validate·SQL 초기화 비활성화로 기동. 기존 DB 이관과 최초 설치를 구분. `posts.edit_version`·`admin_login_sources`는 명시 SQL로 반영. 엔티티만으로 모든 운영 상태를 복구하는 구조는 아님.

## 검증

2026-10-02 생성 방식 전환 기록:

- 생성 로직 이동 전후 DDL SHA-256 일치.
- clean 이후 엔티티·DDL·jOOQ·앱 빌드 순서 확인.
- 재실행 시 생성 단계 up-to-date 동작.
- API JAR에서 빌드 전용 생성기·DDL 제외.
- 격리 MySQL에서 저장·조회·공개 첨부 JOIN 등 검증.

2026-10-03 명시적 open 전환은 앱·jpaModel 상속 계약, 보호된 setter·생성자 유지, 생성 DDL 동일성과 프록시 변경·재조회 확인. 해당 시점 기록은 전체 검사 41건 통과.

현재 영속성 회귀 검사는 고유 제약·실패 시 롤백·프록시 변경·동시 편집 충돌 포함. 코드 생성 성공과 실제 DB 동작 검증을 구분.

## 재검토 조건

- Hibernate·jOOQ·MySQL 변경으로 매핑을 올바르게 생성하지 못하는 경우.
- 도메인 선행 컴파일 대상이 서비스·웹까지 확대되는 경우.
- 명시 마이그레이션 파일을 스키마 원본으로 전환하는 경우.
- 실제 DB와 생성 DDL의 차이가 반복되는 경우.
- 대체 생성 방식의 호환성이 확인되어 유지 비용이 줄어드는 경우.

비교 기준은 생성 시간, 매핑 일치, DB 접속 의존, 원본 중복과 운영 이관 책임.

[영속성 결정 원문](https://github.com/gjaku1031/ken-blog/blob/3074d80/docs/ADR/ADR_persistence.md) · [Gradle 구현](https://github.com/gjaku1031/ken-blog/blob/3074d80/build.gradle) · [영속성 통합 검사](https://github.com/gjaku1031/ken-blog/blob/3074d80/src/test/java/io/github/gjaku1031/kenblog/PostPersistenceIntegrationTest.java)
