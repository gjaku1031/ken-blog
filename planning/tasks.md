# 현재 작업

## 2026-10-01 Actions 배포와 미사용 코드 정리

- 사용자 승인: GitHub Actions에 배포 관리 이관, Spring 배포 상태·콜백·복구·전역 변경 차단과 현재 미사용 코드 정리.
- 배포 트리거는 main push 또는 Actions 수동 실행. DB 메타데이터 저장 후 공개 반영은 Actions에서 실행, 관리자 화면은 해당 실행 페이지로 연결.
- Pages는 읽기 전용 공개 DB 스냅샷·checkout Markdown·로컬 이미지로 생성. 수집 전후 revision 대조, Spring 원고 동기화 쓰기 제거.
- 본문 직접 파일 수정 흐름에 맞춰 서버 MCP 초안 작성/수정/발행과 편집본 관리 계층 정리. 원고·메타데이터 등록·로컬 이미지·인증 보존.
- 구현·통합 검증 완료. Gradle clean build·기존35개 검사, 실제 API/MCP·4섹션 Pages·변경 감지·브라우저·재기동·기존 원고 추출 보존 검증 성공. [변경·검증 기록](issues/ACTIONS-CLEANUP-2026-10-01.md) 참조.
- 기존 DB/파일과 별도 작업 자료 보존. 실제 운영 이관·배포·push 미수행, 운영 이관 전 push 보류 유지.

## 2026-10-01 누락된 Gradle·컨트롤러·DB 정리 통합

- 별도 작업의 Gradle 전환·Swagger/Api 인터페이스·Flyway 제거를 현재 TS·Thymeleaf 후보에 통합하라는 사용자 확정.
- Gradle9.3.0 Wrapper와 Kotlin DSL, CI·Docker·Pages 산출물 `build/` 경로 사용. Maven 파일 제거.
- HTTP 매핑58개와 입력·반환 계약을 구체 Controller로 이전. 웹 본문 편집 REST 재도입 없음, Markdown workflow 동기화와 관리자 MFA 유지.
- Swagger UI·문서 설정·애너테이션과 `*Api.kt` 제거. Flyway27개와 직접 의존성 제거, JPA·최소 SQL 개발 초기화로 통합.
- 기존 별도 작업의 로컬 저장소 검사7개와 DB 제약·재초기화 검사2개 복원. 로컬 파일 구조는 현재 영속 `assets`와 공유 `content` 계약으로 통합.
- Gradle 빌드·기존/복원 검사35개, 빈/전체 섹션 Pages 생성, 실제 격리 API→Markdown·이미지→Thymeleaf 생성 성공.
- 비밀번호+TOTP·CSRF·메타데이터 수정·MCP·배포 잠금·원고 동기화와 재기동 후 세션/파일 보존 확인. [통합·검증 기록](issues/INTEGRATION-2026-10-01.md) 참조.
- 소스 통합 완료. 실제 운영 DB 변경·원고/첨부 이관·배포·push 미수행.

## 2026-10-01 TS·Thymeleaf와 저장소 원고 중심 축소

- 사용자 확정: 공개 Pages 유지, 웹 본문 편집기 제거, 저장소 Markdown을 본문 원본으로 사용.
- 관리자 기능은 DB 메타데이터 수정과 페이지 생성으로 축소. 기존 비밀번호+MFA 유지.
- Kotlin·Thymeleaf 공개 HTML 생성, TS 브라우저 자산을 resources/web으로 이관.
- OCI Object Storage SDK 제거와 영속 로컬 파일 저장 전환. 기존 파일·원고 보존 이행 필요.
- MCP 본문 변경은 소스 커밋·push 후 Pages 배포. 미반영 원고의 해시가 checkout과 다르면 생성 중단.
- 구현·격리 검증 완료, 기존 검사28개 성공. [변경·검증·운영 보류 기록](issues/TS-THYMELEAF-2026-10-01.md) 참조.
- 운영 VM 연결 오류로 기존 DB 원고 추출·OCI 객체 이관·새 런타임 배포 미수행. 기존 공개 사이트 보존을 위해 push 보류.

## 2026-09-30 직접 HTTPS 전환과 미리보기 보완

- [변경·검증·운영 전환 기록](issues/DIRECT-HTTPS-2026-09-29.md) 참조.
- 위키 미리보기, 명시적 콘텐츠 변경 경계, Spring 직접 HTTPS 반영. 기존 검사 28개 통과.
- 격리 실제 TLS·HTTP-01·MFA/CSRF·인증서 무중단 교체·JDBC 세션 재시작 보존 30개 및 배포 잠금 2개 검증 통과.
- 운영 Spring이 80/443 및 loopback 18081 제공. Nginx 컨테이너와 18082 포트 제거, 기존 인증서·콘텐츠·계정·첨부·Flyway 해시 보존 확인.
- 실제 인증기관 staging 갱신 시험과 새 systemd 갱신 서비스 실행 성공, timer active 복구.

## 2026-09-29 정리와 아키텍처 확인

- 사용자 요청에 따른 구 폴더·불필요한 문서·임시파일 정리. 동작 변경과 추가 기능 구현 없음.
- 빈 `apps/`, `.agents/`, `.codex/` 제거. 현재 구조와 다른 단계별 계획·구 체크리스트·중복 계약 문서62개 삭제. 과거 내용은 Git 이력으로 조회 가능.
- 현재 전환 수용 기록3개, 작업 규칙·현재 계획·로컬 인계, 사용 중인 위키 재색인 안내 유지. 별도 PORT/CLEANUP 작업과 전달받은 전환 설계 유지.
- 원고·첨부·계정·프로필·운영 환경·복구자료·아키텍처 원본 보존. 현재 소스와 빌드/운영 스크립트 변경 없음.
- 임시 검증 서버4개 종료, `/tmp` 검증 사본·로그225개 항목과 `target/` 생성 산출물 제거(약3GB). 현재 빌드 의존성 `node_modules` 유지.
- 현재 소스·빌드/운영 파일·원본 도면·별도 작업·마이그레이션 설계·로컬 인증 자료281개 파일의 정리 전후 SHA256 일치 확인.
- 작성 흐름은 실제 웹/MCP → 공통 Spring 서비스 → 편집본 저장/발행 → Actions → Pages 코드로 확인. 설명은 대화로 전달, 별도 학습 문서 추가 없음.

## 완료된 이행과 검증

- 단일 Spring Boot 및 DB V27 전환 완료: [이행 기록](issues/SINGLE-SPRING-2026-09-29.md), [수용 검증](issues/SINGLE-SPRING-ACCEPTANCE-2026-09-29.md).
- 캐시 혼합 수정 및 원본 관리자 복원 완료: [원인과 검증](issues/ASSET-CACHE-2026-09-29.md).
- 소스 `fa990c2`의 운영 API·Pages36565465133·CI36565465241 성공 확인. 기존 검사28개 통과, 원고·첨부·계정 등 보존18테이블 해시 일치.
- 사용자 추가 QA는 후속 과제. 실제 macOS Safari/OS 한글 IME 확인은 미실행 상태 유지. 이전 합성 이벤트·Chromium 검증과 구별.

## 유지할 경계

- 공개 사이트는 GitHub Pages 정적 HTML·이미지, 관리자는 Spring `/manage/`의 같은 출처 세션 인증.
- 본문 원본은 저장소 Markdown, 메타데이터·세션은 MySQL, 첨부 원본은 영속 로컬 디렉터리. TS는 빌드 후 JS, Next/React·Node 운영 서버·Redis·통계 미사용.
- MCP는 메타데이터 등록·변경과 원고 조회·이미지를 담당. 본문은 Markdown 파일 직접 수정 후 커밋·push. 서버 편집본과 원고 동기화 쓰기 없음.
- 배포는 main push 또는 Actions 수동 실행. DB 메타데이터 저장 후 Pages 수동 실행으로 반영, 공개 수집 전후 revision 변경 시 실패. Spring 배포 상태·콜백·복구·전역 변경 차단 없음. 단일 Spring JVM 유지.
- 신규 저장소 테스트 추가 없음. 변경에 맞는 기존 검사·빌드·격리 검증 수행, 실제 실행한 결과만 기록.
