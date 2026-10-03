# 전체 리뷰의 운영 배포 — 2026-10-03

[리뷰 적용 내역](review-remediation-2026-10-03.md)과 [운영 전환 절차](../../deploy/REVIEW-ROLLOUT.md)의 실제 실행 기록이다. 시각은 KST 기준이다.

- 배포 소스: `4cd1c960ec3c40c9c24cc4751816301e16cc0857`. 최신 `main`의 분류 이름·정렬·삭제, 글·시리즈 삭제, 프로젝트 연관 글과 원고를 함께 보존했다.
- [검증·ARM64 이미지 CI](https://github.com/gjaku1031/ken-blog/actions/runs/37123922969)에서 빌드·통합 검사, TLS 경계, 이관·장애·복구, 실제 HTTPS 사이트 간 인증, 이미지의 관리자 HTTP 동작을 통과했다. [Pages 발행](https://github.com/gjaku1031/ken-blog/actions/runs/37124446494)도 같은 소스로 완료했다.
- 운영 서버의 `/srv/ken-blog-live/releases/review-20261003/`에 교체 전 환경·Compose·Caddy·이미지 식별자, DB·이미지 파일 백업, 이관 SQL, 배포·검증 기록을 보관했다. DB 백업을 격리 MySQL에 복원한 뒤 같은 이관 SQL을 실행하여 건수와 기존 본문·해시 값 보존을 확인했다.
- 최종 쓰기 중지는 **21:54:30–21:55:08 KST, 38초**였다. 중지 후 다시 백업하고 이관 SQL을 한 번 적용했다. 글 45개, 분류 67개, 시리즈 10개, 첨부 7개, 관리자·필수 상태 행과 기존 세션을 보존했다. 이관 후 백업도 따로 남겼다.
- 운영 이미지: `ken-blog-api:jvm-4cd1c960ec3c40c9c24cc4751816301e16cc0857`, 이미지 ID `sha256:2e469f24f88fc0ac8865e35fd974032525fd855aed0b4a56e1b0b7ec613fb8d7`. UID/GID `10001:1001`, 첨부 저장소·truststore 읽기 전용 마운트, `validate`/`never`, 공유 프록시 키, 0600 운영 환경 파일을 실행 중 컨테이너에서 확인했다.
- 공개 스냅샷 v3의 글 44개와 시리즈 10개를 보존했다. 운영 HTTPS의 공개 이미지 11개는 교체 전 SHA-256과 같으며 GET/HEAD·길이·MIME·Pages CORS를 확인했다. 발행된 `deployment.json`의 공개 글 44개 메타데이터 지문이 현재 API와 일치했다. 이 지문만으로 원고·이미지 일치까지 판단하지 않았고 실제 빌드·이미지 바이트 검사를 별도로 실행했다.
- 실제 Chromium에서 운영 글 목록→본문 이동, 관리자 로그인 화면, 모바일 가로 넘침 부재, 처리되지 않은 브라우저 오류 부재를 확인했다. 인증서 오류를 무시하지 않은 상태에서 실제 Pages origin의 credentialed CSRF 요청과 `Secure`·`HttpOnly`·`SameSite=None`·Partitioned 쿠키 저장도 확인했다. 운영 계정의 비밀번호 로그인·편집은 실행하지 않았다. 해당 전체 흐름은 같은 이미지의 격리 CI 검사로 검증했다.

## 운영 MySQL 인증서

OCI 기본 인증서는 전용 사설 CA가 서명한 가져온 인증서로 교체했다. OCI Certificates 이름은 `ken-blog-mysql-review-20261003-rsa4096`이며 RSA4096, SAN은 `DNS:ken-blog-mysql.internal`과 기존 DB의 `IP:10.0.0.47`이다. JDBC는 기존 사설 IP를 유지하고 인증서의 IP SAN과 대조한다. 호스트 검증을 생략하는 설정은 사용하지 않는다.

CA만 담은 PKCS12를 `/srv/ken-blog-live/mysql-truststore.p12`에 보관하고 `compose.mysql-tls.yaml`을 함께 적용했다. 운영에서 같은 Connector/J로 정상 `VERIFY_IDENTITY`·TLS 연결, 다른 호스트 거부, 미신뢰 CA 거부를 확인했다. DB 한 개만 포함한 동적 그룹에 해당 인증서 한 개의 조회 권한을 부여했으며, 키·비밀번호·환경 파일·DB 백업은 Git에 포함하지 않았다.

서버 인증서 만료는 **2027-10-03 21:48:35 KST**다. 만료 전에 OCI 인증서 갱신과 DB 적용을 완료하고 CA·SAN 검사를 다시 실행해야 한다. 자동 갱신은 구성하지 않았다. 인증서 변경 시 DB 재시작 가능성은 [Oracle 운영 문서](https://docs.oracle.com/en-us/iaas/mysql-database/doc/updating-security-certificate.html)를 따른다.

이 서버를 다시 기동할 때는 기본 Compose와 TLS 오버레이를 함께 지정한다.

```sh
cd /srv/ken-blog-live
docker compose --env-file production.env \
  -f deploy/compose.production.yaml -f deploy/compose.mysql-tls.yaml up -d
```

앱 롤백에는 보관한 이전 환경·Compose·Caddy와 `2ee9e9f` 이미지를 함께 사용한다. 추가 열·테이블과 새 DB 인증서는 삭제하지 않는다. Pages도 이전 소스로 함께 발행해야 관리자 계약이 맞는다.
