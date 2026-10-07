# 운영 API 이미지 교체

CI가 만든 ARM64 JVM 이미지를 운영 서버(`oci-blog`, `/srv/ken-blog-live`)에 반영하는 반복 절차. 스키마 이관이 함께 필요한 전환은 [리뷰 변경의 운영 전환](REVIEW-ROLLOUT.md)을 먼저 따른다.

## Compose 명령의 기준

운영 DB는 사설 CA의 TLS로 연결하므로 API는 truststore 마운트가 필요하다. 모든 Compose 명령에 두 파일을 함께 지정한다.

```bash
cd /srv/ken-blog-live
docker compose --env-file production.env \
  -f deploy/compose.production.yaml \
  -f deploy/compose.mysql-tls.yaml \
  up -d --no-deps api
```

`compose.production.yaml` 하나로 API를 재생성하면 `/run/ken-blog/mysql-truststore.p12`가 없어 JPA 초기화 단계에서 기동이 실패하고 재시작을 반복한다. 2026-10-07 Java 이미지 배포와 롤백에서 이 누락으로 API가 약 6분간 중단됐다. 실행 중인 컨테이너의 `com.docker.compose.project.config_files` 라벨로 두 파일이 모두 적용됐는지 확인한다.

## 절차

1. 배포 전 기록: 현재 `KEN_BLOG_API_IMAGE` 태그와 이미지 ID, 공개 스냅샷의 `version`·`revision`.
2. CI artifact의 아카이브 SHA-256 대조 후 서버로 전송, `docker load`, 이미지 ID 대조.
3. `production.env`의 `KEN_BLOG_API_IMAGE`만 새 태그로 변경.
4. 위 기준 명령으로 API만 재생성. Caddy·DB·다른 환경 값은 변경하지 않는다.
5. 호스트의 API 포트(`API_PORT`, 현재 18084)에서 `/actuator/health`가 UP이 될 때까지 대기.
6. 확인: 공개 주소의 health UP, 스냅샷 `version`과 `revision`이 배포 전과 같음, `/api/v1/auth/csrf` 200, 기술 아이콘 이미지 200, 기동 이후 로그의 ERROR 없음.
7. 하나라도 실패하면 1에서 기록한 태그로 `KEN_BLOG_API_IMAGE`를 되돌리고 같은 기준 명령으로 재생성한 뒤 health를 확인한다.
