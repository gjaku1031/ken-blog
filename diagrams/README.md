# 아키텍처 도면 재생성

`architecture.py`는 Python Diagrams와 Graphviz의 고정 좌표로 같은 배치의 라이트·다크 SVG 생성. CLI 내부에서 테마마다 별도 Python 프로세스로 렌더하여 Graphviz 이미지 캐시의 테마 간 아이콘 잘림 방지. CairoSVG로 Graphviz SVG를 PNG로 변환. SVG의 글자는 경로, 아이콘은 데이터 URI로 포함해 외부 글꼴·이미지 요청 없이 표시.

저장소 루트에서 다음 명령 실행. Graphviz와 `Noto Sans CJK KR` 글꼴 필요. `icons/`에는 렌더링용 정규화 PNG 포함.

```sh
python3 -m venv /tmp/ken-blog-diagrams-venv
/tmp/ken-blog-diagrams-venv/bin/pip install -r diagrams/requirements.txt
/tmp/ken-blog-diagrams-venv/bin/python diagrams/architecture.py --icons diagrams/icons --output diagrams
cp diagrams/architecture.svg diagrams/architecture.dark.svg diagrams/architecture.png diagrams/architecture.dark.png apps/web/public/architecture/
```

`source-icons/`는 원본 자산 보관용. `icons/`는 흰색 바탕에 종횡비를 유지하며 256×256 PNG로 정규화한 렌더링 자산. 아이콘 상표권은 각 소유자에게 있으며 이 저장소의 도면 코드와 별개. 제품과 서비스의 출처를 알리기 위한 용도로만 사용.

| 아이콘 | 원본 출처 | 사용 파일 |
| --- | --- | --- |
| GitHub | [GitHub 공식 favicon](https://github.githubassets.com/favicons/favicon.svg), [로고 사용 지침](https://github.com/logos) | `source-icons/github.svg` |
| Next.js | [Next.js 공식 favicon](https://nextjs.org/favicon.ico), [브랜드 지침](https://nextjs.org/governance) | `source-icons/nextjs.png` (ICO에서 추출) |
| Spring | [Spring 공식 SVG](https://spring.io/img/spring.svg), [상표 지침](https://spring.io/trademarks/) | `source-icons/spring.svg` |
| Docker | [Docker 공식 마크](https://www.docker.com/app/uploads/2026/05/docker-mark-deep-blue.svg), [상표 지침](https://www.docker.com/legal/trademark-guidelines/) | `source-icons/docker.svg` |
| Redis | [Redis 공식 favicon](https://redis.io/favicon.ico), [브랜드 지침](https://redis.io/wp-content/uploads/2024/09/Redis_BrandGuidelines_Partners_Vol01_20240903_SM.pdf) | `source-icons/redis.png` (ICO에서 추출) |
| MySQL | [MySQL 공식 로고](https://www.mysql.com/common/logos/logo-mysql-170x115.png), [로고 지침](https://www.mysql.com/about/legal/logos.html) | `source-icons/mysql.png` |
| OCI Compute VM·OCI Object Storage | Python Diagrams 0.25.1의 `resources/oci/compute/vm.png`·`resources/oci/storage/object-storage.png`; [Oracle 아키텍처 아이콘 안내](https://docs.oracle.com/en-us/iaas/Content/General/Reference/graphicsfordiagrams.htm) | `source-icons/oci-vm.png`, `source-icons/oci-object-storage.png` |

도면의 MySQL은 새 프로젝트의 OCI ARM64 VM 개발·격리 로컬 검증용 Docker Compose 범위에 포함. Compose의 `mysql:8.4.11` 이미지와 별도 데이터 볼륨을 사용하고, 호스트 접근은 기본 `127.0.0.1:13306`에 한정. Spring 컨테이너는 Compose 네트워크의 `mysql:3306`으로 JDBC 연결. Flyway V1~V8은 게시글·계정·Spring Session JDBC·첨부 메타데이터·출간 상태·본문 SHA-256·분류/태그·별도 관리자 편집본을 관리하며 main 반영 완료. V9의 글/편집본 이미지 연결 관계는 P2-03A에서 격리 검증 완료했으며 main 반영 전. JPA는 애플리케이션 엔티티의 스키마를 검증. 이 선은 새 프로젝트의 원본 저장·권한 판단·세션 접근이며 공개 인터넷의 DB 접속이나 운영 DB를 뜻하지 않음.

Spring Security의 서버 세션은 Spring Session JDBC를 통해 같은 MySQL에 저장. 관리자 첨부 API는 기존 비공개 OCI Object Storage 버킷의 S3 호환 HTTPS endpoint에 접근하고 첨부 처리 상태는 MySQL에 남김. 도면의 Spring→버킷 실선은 현재 관리자 업로드·읽기와 P2-03A에서 격리 검증한 Spring 경유 권한별 이미지 읽기를 구분해 설명하며 브라우저의 버킷 직접 접근을 뜻하지 않음. 권한별 읽기는 현재 DB의 글 상태·범위·첨부 연결을 요청마다 확인. Spring→Redis Cloud 실선은 P1-04의 **설정 시에만** 사용되는 익명 PUBLIC 상세 본문 캐시 경로이며 기본 비활성. 공개 판단과 본문 해시는 매번 MySQL에서 확인; 비공개·회원 글/목록·계정·세션·CSRF·첨부는 캐시 대상 아님. 외부 Redis Cloud는 Compose 서비스/호스트 포트/볼륨에 포함되지 않음. 실제 연결 설정·검증 경계는 [캐시 안내](../docs/cache.md)에 기록. 기존 VM 앱과 기존 Redis 서비스는 별개의 실행 자원으로, 이 새 프로젝트 도면이 기존 앱의 교체나 자동 배포를 뜻하지 않음. 갈색 파선의 공개 HTTPS API 연결은 주소 미정·미연결. 정적 Pages에는 로그인·관리자 편집 화면이 있지만 공개 API 주소 미설정으로 실사이트 인증·이미지 연결은 되지 않음. 로컬 인증 경계는 [아키텍처 설명](../docs/architecture.md)에 기록.
