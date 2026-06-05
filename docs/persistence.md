# 게시글 저장 기반

P1-01은 Spring API 내부에서만 초안을 저장·조회하는 기반. 당시에는 공개 글 작성 HTTP 경로, 출간, 에디터 블록, OCI Object Storage 첨부 기능이 없었음. 이후 관리자 인증과 MySQL 세션은 [별도 계약](authentication.md)으로, 관리자 첨부 기능은 [P1-03 계약](attachments.md)으로 추가. 게시글 쓰기 API와 첨부의 게시글 연결은 아직 없음.

Kotlin 게시글 코드는 `post/domain`의 엔티티·도메인 오류, `post/repository`의 Spring Data JPA 인터페이스, `post/service`의 구체 서비스·입력 검증·트랜잭션으로 분리. Flyway SQL은 기존 `db/migration`에 유지하며 데이터 표와 공개 HTTP 계약은 저장소 구현 변경으로 달라지지 않음.

## 저장 계약

Flyway의 `V1__create_posts.sql`이 MySQL 8.4의 `posts` 표 생성. `id`는 증가하는 `BIGINT` 기본키, `title`은 최대 200자, `slug`는 최대 160자의 ASCII 고유 키, `body`는 `LONGTEXT`, `created_at`·`updated_at`은 마이크로초 단위 `DATETIME(6)`. 표는 InnoDB·UTF-8(`utf8mb4`) 사용. slug 열은 소문자 ASCII 주소를 정확히 구분하도록 `ascii_bin` 사용.

`PostService.createDraft`는 제목의 양끝 공백을 제거하고 Unicode 코드 포인트 1~200자 및 공백만 있는 입력 거부. slug는 양끝 공백 제거 후 `Locale.ROOT` 소문자로 바꾸고, 영문 소문자·숫자를 단일 하이픈으로 연결한 1~160자만 허용. 예: `  My-First-Post  ` → `my-first-post`. 본문은 원문 그대로 저장하며 UTF-8 인코딩 결과가 1 MiB를 넘으면 거부. Java/Kotlin의 `String.length`는 일부 문자를 두 단위로 세므로 제목에는 코드 포인트 수를 적용; MySQL `VARCHAR(200)`의 문자 한도와 맞춤. 본문은 바이트 한도를 따로 적용.

생성 시 두 시각은 같은 UTC 값. 수정 기능이 없으므로 `updated_at`은 생성 시각과 동일. `DATETIME`에는 시간대 정보가 들어 있지 않으므로 코드가 UTC로 해석해야 함. 이 초기 초안 형식은 후속 에디터 본문 구조의 결정이 아님.

`PostRepository`는 `JpaRepository<PostEntity, Long>`을 확장하고 정규화된 slug의 `findBySlug`만 파생 쿼리로 선언. 새 초안은 ID가 `null`인 엔티티로 만들고, `PostService.createDraft`의 `try/catch` 안에서 상속받은 `saveAndFlush`를 호출. 이 경로에서 Spring Data JPA는 새 엔티티를 `persist`하고 저장 메서드가 반환한 엔티티를 서비스가 사용. 즉시 flush하여 MySQL의 `uk_posts_slug` 고유 제약 위반을 서비스 트랜잭션 안에서 확인하지만, flush는 커밋이 아니며 같은 영속성 컨텍스트의 다른 변경도 동기화될 수 있음. 서비스는 해당 MySQL 중복 키 오류만 `DuplicatePostSlugException`으로 바꾸고 호출자에게 전파하여 외부 트랜잭션의 앞선 저장까지 롤백. 다른 DB 오류는 그대로 전파하며 모든 오류가 커밋 전에 발생한다고 보장하지 않음. 잘못된 입력에는 `InvalidPostDraftException` 사용. 두 예외는 현재 내부 서비스 계약이며 HTTP 오류 응답이나 쓰기 API는 없음. ID 조회는 상속 `findById`의 `Optional`을 Kotlin `findByIdOrNull`로 변환하고, slug 조회는 파생 쿼리 결과를 사용. 잘못된 ID·slug나 없는 행은 `null` 반환.

계정의 `AccountRepository`도 `JpaRepository<UserEntity, Long>`을 확장하고 `findByUsername`만 파생 쿼리로 선언. 구체 `AccountService`는 기존 계정 수와 이름을 확인해 이미 저장된 관리자 해시를 보존하고, 새 관리자 생성에서 `saveAndFlush`로 제약 검사 시점을 유지. `PostService`의 저장과 `AccountService.ensureInitialAdmin`은 기존 `@Transactional`, 게시글 조회와 인증용 계정 조회는 `readOnly = true` 경계 안에서 실행. Spring Session JDBC의 세션 테이블에는 별도 JPA Repository를 만들지 않음.

Flyway가 앱 기동 시 버전 이력을 확인해 미적용 SQL만 실행. V1 게시글, V2 계정, V3 Spring Session JDBC 표·인덱스·속성 외래 키를 관리. Hibernate의 `ddl-auto=validate`는 엔티티와 표를 검증하며 표를 만들거나 고치지 않음. 마이그레이션 실패나 DB 접속 실패 시 API 기동 실패. `/actuator/health`에는 DB 연결 상태 반영.

## 개발 DB 실행

루트의 `.env.example`을 Git 제외 대상 `.env`로 복사하고 `DB_PASSWORD`와 `MYSQL_ROOT_PASSWORD`에 **서로 다른 로컬 비밀번호**를 입력. 예제 파일에는 비밀번호가 비어 있으며 빈 값으로는 Compose 시작 불가. 외부 MySQL이나 운영 DB 비밀번호를 재사용하지 않음.

```sh
cp .env.example .env
# 편집기로 .env의 두 비밀번호 입력
docker compose -p ken-blog-p101 up -d mysql
docker compose -p ken-blog-p101 ps
```

MySQL은 `mysql:8.4.11` 이미지와 `ken_blog_mysql_data` 전용 이름 볼륨 사용. 호스트에서는 기본 `127.0.0.1:13306`으로만 연결되며 기존 앱의 8080 포트와 다른 Docker Compose 프로젝트의 컨테이너·볼륨에 접근하지 않음. API 컨테이너는 같은 Compose 네트워크에서 `jdbc:mysql://mysql:3306/ken_blog` 사용. 직접 `./mvnw spring-boot:run` 또는 jar를 호스트에서 실행할 때에는 `DB_URL=jdbc:mysql://127.0.0.1:13306/ken_blog`, `DB_USERNAME`, `DB_PASSWORD` 환경변수 공급 필요. 비밀번호를 명령 기록·공유 로그에 남기지 않도록 로컬 환경 관리. 설정 누락 시 API 기동 실패.

API 이미지는 [실행 안내](runtime.md)의 Buildpacks 명령으로 현재 소스에서 다시 생성한 뒤 기동. 기존 `ken-blog-p004-api:local` 이름은 앞 단계에서 사용한 로컬 이미지 태그이며 새 DB 의존성을 포함하려면 반드시 재빌드 필요. `docker compose -p ken-blog-p101 down`은 이 프로젝트의 컨테이너·네트워크만 종료하고 데이터 볼륨 유지. 이 개발 DB를 삭제하려는 경우에만 해당 프로젝트의 볼륨을 명시적으로 정리.

## 검증

현재 `cd apps/api && ./mvnw -B -ntp clean verify`는 Testcontainers가 별도의 임시 MySQL 8.4.11을 시작해 MVC·영속화·인증 테스트를 실행하도록 구성. 테스트 DB는 개발 Compose의 DB·볼륨과 격리. Docker 접근 필요, H2 사용 없음. 게시글 테스트는 빈 DB에 V1~V3 적용 및 Hibernate 검증, 제목/slug/본문 경계, ID·slug 재조회, 고유 제약 충돌, 여러 저장을 묶은 트랜잭션 롤백, 같은 DB에 두 번째 `migrate()` 실행 시 적용 건수 0을 확인. CI는 이 테스트 뒤 일회용 MySQL 서비스에 패키징한 jar를 연결해 HTTP health를 검사. [P1-02A 원격 CI](https://github.com/gjaku1031/ken-blog/actions/runs/36151614912)에서는 기존 28개 테스트가 실패·오류·건너뜀 없이 완료. 이 CI 결과와 아래 P1-01 기록은 이력 정정 전 `EntityManager` 저장소의 실제 검증 증거이며, 새 `JpaRepository` 구현의 검증 결과로 바꾸어 해석하지 않음.

이전 P1-01 단계에서 2026-09-25 ARM64·Docker 29.8.1의 `clean verify` 21개(기존 MVC 15개, 저장 6개) 모두 통과. `spring-boot:build-image -DskipTests`로 당시 API 이미지 빌드 성공. 별도 `ken-blog-p101-verify` Compose 프로젝트의 MySQL·API를 기동해 `/actuator/health` `UP` 확인. 개발 볼륨에 확인용 행 1개를 넣고 `down` 후 재기동했을 때 행 1개와 성공한 Flyway V1 이력 1개가 유지되고, 앱 로그에 `Schema ... is up to date. No migration necessary.` 표시. 검증 프로젝트의 컨테이너·네트워크·전용 볼륨은 검증 후 제거; 기존 8080 앱과 Redis는 유지. [원격 CI](https://github.com/gjaku1031/ken-blog/actions/runs/36137705283)에서도 API·Web 작업 성공 확인.

참고: [Spring Boot SQL 데이터와 JPA](https://docs.spring.io/spring-boot/reference/data/sql.html), [Spring Boot DB 초기화](https://docs.spring.io/spring-boot/how-to/data-initialization.html), [Testcontainers MySQL](https://java.testcontainers.org/modules/databases/mysql/), [MySQL 공식 이미지](https://hub.docker.com/_/mysql).
