# 운영 연결 및 이메일 제거 — 2026-09-27

최종 주소 요구: 프런트는 GitHub Pages에만 배포. 아래 첫 연결 단계의 OCI 정적 미러·이동 검증은 이력이며 최종 구성에서 제거.

## 요청과 수용 기준

- 실제 서비스 연결까지 수행하라는 추가 요청 및 기존 Tailscale HTTPS 주소 사용 확정.
- 이메일 기능 전면 제외. 아이디·비밀번호 인증, 이름·아이디 기반 회원 관리, 직접 전달하는 일회용 초대 링크로 통일. 프로필 이메일 연락처 제거.
- 기존 앱의 Flyway V1과 새 앱의 V1 불일치 보존. 별도 전용 MySQL 스키마에 새 앱 배포.
- GitHub Pages를 공개·로그인·관리·초대 전체 프런트의 유일한 주소로 유지. OCI/Tailscale은 API 전용. 기존 OCI 화면 주소는 Pages 동일 경로로 이동.
- 신규 저장소 테스트 작성 없이 기존 검사와 실제 HTTPS HTTP·브라우저 흐름 검증.

## 실제 연결 확인

- OCI MySQL HeatWave의 새 전용 `ken_blog_live` 스키마 생성. 해당 스키마에 한정한 전용 계정과 현재 VM 사설 주소 제한·TLS 필수 적용.
- V1~V18 실제 적용 및 JPA 스키마 검증·API health UP 확인. 기존 `ken_blog` 스키마의 글/첨부 각각 0건 확인, 변경 없음.
- Tailscale HTTPS API 실제 관리자 로그인·세션 ID 교체·Secure 쿠키·로그아웃 후 401 확인.
- 앱을 통한 OCI Object Storage 업로드·바이트 일치 다운로드·삭제 확인. 익명 첨부 접근 401 확인.
- 앱을 통한 Redis Cloud 공개 본문 캐시 저장·조회·TTL 확인. 비공개 전환 시 익명 본문 제외 확인. 기존 제공자의 TLS 비활성 접속 설정 유지.
- 검증용 운영 글·첨부·캐시 키 삭제 완료. 새 DB 백업 파일 생성 및 SHA256 검증 완료. 비밀값·DB 덤프의 저장소 반입 없음.
- GitHub `NEXT_PUBLIC_API_BASE_URL` 실제 HTTPS 주소 설정 완료.

## 첫 연결 단계의 구현·검증 — 최종 주소 요구는 아래 절 기준

- 계정·초대·프로필 이메일 필드와 SMTP/메일 의존 완전 제거. V19에서 users/home_profile email 컬럼 삭제 및 초대 발급 시각 issued_at 전환. 적용 이력이 있는 V1~V18 체크섬 보존.
- 운영 MySQL V19·19개 마이그레이션 성공, email 컬럼 0개, TLS_AES_128_GCM_SHA256 연결 확인.
- 실제 HTTPS 관리자 로그인 → 이름/아이디로 초대 발급 → fragment를 주소에서 제거 → 비밀번호 설정 → 아이디 로그인 → 소비 토큰 410 → 계정 삭제 및 기존 브라우저 세션 폐기까지 통과. 검증 계정 삭제 완료.
- 새 API 이미지에서 MySQL 세션·OCI 업로드/바이트 일치 다운로드/삭제·Redis 캐시/TTL·비공개 차단 재검증 통과.
- 기존 API 검사 4개 suite·28개 모두 실패/오류/생략 0. 삭제된 클래스의 로컬 incremental 잔재를 제거한 `clean test` 기준. Docker 이미지 내부에 Mailer 클래스와 Mail starter 없음 확인.
- 웹 타입 검사·기존 검사 7개·정적 20개 경로 빌드 통과. 홈·로그인·회원·프로필 4개 실제 HTTPS 화면 WCAG AA 위반 0·360px 가로 넘침 0.
- nginx 정적 웹 18082와 API18081은 loopback 한정. Funnel443 → nginx, `/ken-blog/` 정적 파일·`/api/v1/` API·health만 공개. Swagger·환경 파일·나머지 actuator 404 확인.
- nginx에서 API 재생성 후 Docker DNS 재해석 지원, HTTP 내부 포트가 외부 redirect에 포함되지 않도록 상대 Location 사용.
- 공개 Pages 인증 화면은 동일 경로의 OCI HTTPS 화면으로 이동. Pages의 직접 초대 URL도 fragment를 삭제하기 전에 이동.
- main `dcdd504`의 Pages 배포 성공, 실제 Pages 공개 API 조회·로그인 이동·직접 관리자 URL·직접 초대 fragment 전달 및 주소 제거 검증 통과. 브라우저 오류 0.
- 동일 커밋 CI는 API 성공·웹 Google 글꼴 변환 오류 발생. Noto Sans KR와 IBM Plex Mono를 버전 고정 Fontsource 패키지로 제공하여 빌드 시 Google 글꼴 요청 제거. 글꼴 모양과 한국어/코드 폰트 구분 유지, 폰트 라이선스 고지 동봉.
- 폰트 수정 뒤 원격 CI/Pages의 실제 run ID와 최종 확인 결과는 로컬 인계에 기록.

## 별도 설정

- GA4 Data API 속성 ID·서비스계정 미제공 상태 유지. 샘플 통계 대체 없음. 공개 측정 활성화와 GA 관리 화면의 실제 통계 연결을 구분.
- Tailscale 백그라운드 공개 프록시는 재시작 시 유지되는 구성 사용. [공식 CLI 동작](https://tailscale.com/docs/reference/tailscale-cli/funnel) 확인.


## 최종 주소 요구 반영

- 사용자가 GitHub Pages 프런트 유지 재확인. 위 중간 단계의 OCI 동일 출처 미러 방식 폐기. Pages 익명 고정과 OCI 강제 이동 제거.
- Spring Boot 4.1.1 기본 `server.servlet.session.cookie.partitioned`를 사용하여 `Secure; HttpOnly; SameSite=None; Partitioned` JDBC 세션 제공. CORS의 인증 origin은 `https://gjaku1031.github.io`, 초대 URL도 Pages로 통일.
- [Spring Session CookieSerializer](https://docs.spring.io/spring-session/reference/api/java/org/springframework/session/web/http/DefaultCookieSerializer.html) 및 [분할 쿠키 동작](https://developer.mozilla.org/en-US/docs/Web/Privacy/Guides/Third-party_cookies/Partitioned_cookies) 확인. 브라우저 제3자 쿠키 차단을 켠 상태에서 실제 Pages 인증 검증 예정.
- 운영 이미지는 API와 nginx API 프록시만 실행. OCI `/ken-blog/` 이하 이전 URL은 같은 경로·query의 Pages로 302 이동. 프런트 정적 파일은 GitHub Pages에만 배포.
- 사용자 지정 초기 관리자 아이디 반영, 비밀번호는 BCrypt 저장·실제 HTTPS 로그인 확인. 원문 저장소·파일·문서 노출 없음. 기존 관리자 세션 폐기.
- 초기 관리자 bootstrap 설정은 빈 스키마의 최초 준비에만 사용. 운영 실행 환경에서는 제거하여 이후 회원이 추가돼도 재시작 가능. 별도 비공개 bootstrap 설정에는 해시만 보관.
