# 아키텍처 도면 재생성

`architecture.py`는 Python Diagrams와 Graphviz의 고정 좌표로 같은 배치의 라이트·다크 SVG 생성. CairoSVG로 Graphviz SVG를 PNG로 변환. SVG의 글자는 경로, 아이콘은 데이터 URI로 포함해 외부 글꼴·이미지 요청 없이 표시.

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

도면의 MySQL은 OCI ARM64 VM의 개발·로컬 검증용 Docker Compose 범위에 포함. Compose의 `mysql:8.4.11` 이미지와 별도 데이터 볼륨을 사용하고, 호스트 접근은 기본 `127.0.0.1:13306`에 한정. Spring 컨테이너는 Compose 네트워크의 `mysql:3306`으로 JDBC 연결. Flyway가 게시글 스키마를 적용한 뒤 JPA가 스키마를 검증. 이 선은 게시글 영속화의 내부 연결이며 공개 게시글 API나 운영 DB를 뜻하지 않음.

Redis는 같은 Compose의 `redis:7.4.11-alpine` 이미지로 Spring Session 서버 세션을 저장. Spring은 내부 `redis:6379`로 접근하고 Redis에는 호스트 공개 포트·영속 볼륨 없음. 공개 글 캐시는 아직 미구현이며 도면 Redis 카드의 ‘캐시 후속’은 사용 예정 기능만 표시. 갈색 파선의 공개 HTTPS API 연결은 주소 미정·미연결. OCI Object Storage는 별도 파선 영역의 후속 미구현 자원. 정적 Pages 화면에 로그인 화면은 없으며 로컬 인증 경계는 [아키텍처 설명](../docs/architecture.md)에 기록.
