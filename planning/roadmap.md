# 현재 이행 상태와 후속 범위

## 완료

- 루트 Maven Spring Boot Kotlin 프로젝트 통합, 운영 MySQL V27 이행 및 기존 콘텐츠 보존.
- 관리자 CodeMirror 원문 편집·공통 Markdown 미리보기·웹/MCP 저장 서비스 통합.
- 공개 원문·이미지 수집과 GitHub Pages 정적 배포, 영속 배포 상태와 콘텐츠 변경 차단.
- 이전 소스/빌드 산출물 기준 공개·관리 디자인 복원, 내용 해시 자산으로 배포 전후 캐시 혼합 수정.
- Spring 직접 HTTPS·HTTP-01·SSL bundle 인증서 재로딩 전환. Nginx 운영 컨테이너 제거, 내부 MCP 경계와 기존 데이터 보존.

현재 근거: [이행 검증](issues/SINGLE-SPRING-2026-09-29.md), [수용표](issues/SINGLE-SPRING-ACCEPTANCE-2026-09-29.md), [화면·캐시 복원](issues/ASSET-CACHE-2026-09-29.md).

## 후속

- 사용자와 현재 작성·저장·발행 아키텍처 검토.
- 사용자 실제 QA에서 재현한 문제를 근거로 수정. 임의 화면/기능 추가 없음.
- 실제 macOS Safari/OS 한글 IME 확인은 미실행 항목으로 유지.

과거 Next/apps 단계별 로드맵은 현재 구조와 불일치하여 작업 폴더에서 제거. 변경 이력은 Git에 보존.
