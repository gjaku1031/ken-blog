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
