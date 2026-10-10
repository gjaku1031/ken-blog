# 정적 생성 전환 전후 글 열람 지연 측정 (2026-10-07)

공개 화면을 브라우저의 API 호출 방식에서 빌드 시 정적 생성으로 바꾼 효과를 측정한 실험의 스크립트와 요약 결과. 측정 질문·방법·해석은 블로그 글 [정적 생성 전환 전후의 글 열람 지연 측정](https://gjaku1031.github.io/ken-blog/post/post-c342d140-8026-4137-8761-b5c3eecddc2c/)에 정리함.

## 비교 대상

| 구조 | 소스 | 본문 위치 |
| --- | --- | --- |
| 순수 CSR | 커밋 `f29ef35` | API 응답으로만 수신 |
| 하이브리드 | 커밋 `135169f` | 빌드 시 HTML에 포함, 런타임 API 호출 유지 |
| 정적 생성 | Pages 실행 `37590862774`의 산출물(헤드 `811c95f`) | 빌드 시 HTML에 포함 |

## 폴더 구성

| 경로 | 내용 |
| --- | --- |
| `scripts/run-perf-v2.cjs` | Playwright Chromium 측정. 구조 3개 × 시나리오 5개 × 캐시 2조건 × 네트워크 2조건 × 15회 |
| `scripts/replay-load-v2.cjs`, `scripts/sample-api-cpu-v2.py` | 첫 방문 ERD 요청 목록을 초당 5회·60초 재생하고 API 컨테이너 CPU 표본 수집 |
| `scripts/cache-smoke-v2.cjs`, `scripts/capture-headers-v2.sh`, `scripts/verify-pages-v2.cjs` | 캐시 적중·응답 헤더·정적 산출물 확인 |
| `scripts/summarize-v2.py`, `scripts/summarize-cpu-v2.py`, `scripts/build-report-v2.py` | 원자료 집계와 보고서 생성 |
| `scripts/seed.py` | 운영 공개 스냅샷과 Git 원고로 옛 구조의 DB seed 생성 |
| `scripts/Caddyfile.v2`, `scripts/compose-v2.yaml` | 측정용 정적 파일 서버·API·DB 구성 |
| `results/summary.md`, `results/summary.csv` | 2차 측정 전체 지표 요약 |
| `results/runs.csv` | 2차 측정의 회차별 기록 900행(워밍업 제외). 본문 표시 시각과 요청 수 등 요약에 쓴 지표만 담음 |
| `results/load-cpu-summary.csv` | API 서버 CPU 요약 |
| `results/body-location.tsv`, `results/data-compatibility.txt` | 구조별 본문 위치, 두 옛 구조의 마이그레이션·seed 동일성 |
| `results/caddy-v1-headers.txt`, `results/caddy-v2-headers.txt`, `results/github-pages-headers.txt` | 1차·2차 측정 서버와 운영 GitHub Pages의 응답 헤더 |
| `results/mac-curl-summary.*`, `results/diagram-summary.*` | 맥에서의 네트워크 교차 확인, Mermaid 렌더링 완료 시각 |
| `results/environment.json` | 커밋·이미지·브라우저·네트워크 보정값 |
| `results/v1/` | 결론에 쓰지 않은 1차 측정의 요약과 제외 사유 |

## 재현에 필요한 것

이 폴더에는 요청 단위 원자료(회차마다의 요청 목록, 약 45MB)와 입력 데이터를 넣지 않음. 회차별 지표는 `results/runs.csv`에 있음. 재현하려면 다음을 별도로 준비함.

1. 옛 소스: `git archive f29ef35`, `git archive 135169f`로 빈 디렉터리에 추출해 각 구조의 API·화면을 빌드.
2. 정적 산출물: `gh run download 37590862774`로 Pages 산출물을 내려받음.
3. seed 입력: 운영 공개 스냅샷(`/api/v1/pages/snapshot`)과 `content/posts`의 원고. `scripts/seed.py`가 이를 읽어 SQL을 생성.
4. 네트워크 보정: 독자 위치의 장치에서 측정 서버까지 왕복 지연(`ping` 30회)과 다운로드 처리량(10MiB 파일 5회)을 재고 `run-perf-v2.cjs`의 프로필 값에 반영.

스크립트의 `/home/ubuntu/...` 절대 경로는 측정 당시 값이며 환경에 맞게 바꿔야 함. 사설 주소·DB 접속 문자열·개인 경로는 `<redacted>`로 가림.
