#!/usr/bin/env python3
import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = Path("/tmp/claude-1001/-home-ubuntu-Develop-project-ken-blog/c2ce2f06-7520-4f93-9149-d9a68ed4f1aa/scratchpad/perf-results-v2-report.md")
with (ROOT / "results-v2/summary.csv").open(encoding="utf-8", newline="") as f:
    summary_rows = list(csv.DictReader(f))
lookup = {(r["scenario"], r["profile"], r["cache"], r["implementation"]): r for r in summary_rows}
scenarios = ["project_home", "erd_document", "general_post", "home_list", "in_app_navigation"]
scenario_ko = {
    "project_home": "프로젝트 대문",
    "erd_document": "ERD 문서",
    "general_post": "일반 글",
    "home_list": "홈 목록",
    "in_app_navigation": "앱 안 ERD 이동",
}
implementations = ["csr", "hybrid", "static"]
implementation_ko = {"csr": "순수 CSR (f29ef35)", "hybrid": "하이브리드 (135169f)", "static": "정적 (Pages artifact)"}

def n(value):
    return "—" if value in (None, "") else f"{float(value):.1f}"

def triplet(row, prefix):
    return "/".join(n(row.get(f"{prefix}_{p}")) for p in ("med", "p75", "p95"))

def metric_cell(row):
    idle = triplet(row, "network_idle")
    cap = int(row["network_idle_cap_n"])
    idle_text = f"— (cap {cap}/15)" if row["network_idle_med"] == "" else f"{idle} (cap {cap}/15)"
    return (
        f'LCP {triplet(row, "lcp")}; TTFB {triplet(row, "ttfb")}; '
        f'DCL {triplet(row, "dcl")}; load {triplet(row, "load")}; idle {idle_text}'
    )

def request_cell(row):
    return (
        f'req {n(row["request_med"])} · API {n(row["api_request_med"])} '
        f'(서버 {n(row["api_server_med"])} · auth {n(row["auth_intercepts_med"])}) · '
        f'단계 {n(row["api_stages_med"])} · 응답 미관측 {row["api_missing_response_n"]}/15 · '
        f'bytes {n(row["encoded_bytes_med"])} · cache hit {n(row["cache_hits_med"])} · '
        f'304 {n(row["304_med"])}'
    )

lines = [
    "# 정적·순수 CSR·하이브리드 성능 비교 v2",
    "",
    "- 총 900회(5 시나리오 × 3 구현 × 2 프로필 × 2 캐시 × 15회), 워밍업 120회. 직접 열기 720/720은 HTTP 200과 표식 확인, 앱 안 이동 180/180은 ERD 표식 확인에 성공했다.",
    "- 정적 구현은 표식 가시 중앙값에서 20개 시나리오·프로필·캐시 조합 모두 가장 낮았다. 차이는 로컬 브라우저·CDP 네트워크 프로필의 관측값이다.",
    "- CSR 원본 `f29ef35`의 본문 표식은 HTML에 없고, `135169f` 하이브리드와 정적 artifact에는 HTML에 포함됨을 확인했다.",
    "- 세 구현의 정적 파일에 Pages와 같은 `max-age=600`/ETag/Last-Modified 정책을 적용했다. 정적 ERD 재방문은 cache hit 53회, 전송량 약 1.06 MB에서 약 11 KB로 줄었다.",
    "- 5회/초 × 60초 로컬 ERD 재생에서 CSR API CPU 평균/최대 17.1/42.2%, 하이브리드 25.6/66.0%였다. 정적 구현은 서버 API 요청 0회(auth/me는 로컬 401 가로채기)다.",
    "",
    "## 비교 공정성 확인",
    "",
    "| 항목 | 확인 결과 | 근거 |",
    "|---|---|---|",
    "| 본문 위치 | CSR은 프로젝트·ERD 표식이 HTML에 없음; 하이브리드·정적은 HTML에 있음 | `results-v2/body-location.tsv` |",
    "| 데이터 | 두 API 구현의 migration 24개 동일; seed SHA-256 동일; 로컬 DB에 글 16·프로젝트 6·배지 11개 | `results-v2/data-compatibility.txt` |",
    "| 1차 Caddy | 정적 HTML/JS/CSS/이미지에는 Cache-Control 없음(ETag/Last-Modified, 텍스트 gzip); API JSON은 no-store. 구형 API badge 이미지는 public,max-age=300 | `results-v2/caddy-v1-headers.txt` |",
    "| 실제 GitHub Pages | HTML/JS/CSS/이미지의 curl -sI에서 max-age=600, ETag, Last-Modified, Vary 확인; HTML/JS/CSS gzip, 이미지는 비압축 | `results-v2/github-pages-headers.txt` |",
    "| 2차 Caddy | 세 구현의 정적 HTML/JS/CSS/이미지에 Cache-Control max-age=600, ETag, Last-Modified, Vary를 동일 적용; 텍스트 압축; API JSON no-store 유지. 조건부 If-None-Match HEAD 304 확인 | `results-v2/caddy-v2-headers.txt`, `Caddyfile.v2` |",
    "| 실행 경계 | Caddy만 127.0.0.1:18444 및 Tailscale <redacted>:18444에 바인드; API/MySQL 호스트 포트 없음 | `results-v2/environment.json` |",
    "",
    "## 구현·데이터·측정 방식",
    "",
    "| 구현 | 소스 | 본문 HTML 여부 |",
    "|---|---|---|",
    "| 순수 CSR | `f29ef3500f7af5723581d6cd6de5305dba8d8e45` (`git archive`) | 표식 없음; API에서 본문을 받아 렌더 |",
    "| 하이브리드 | `135169fa080ec6b331e0e1f289323e4ee578748f` | 프로젝트/ERD 본문 표식이 빌드 HTML에 포함 |",
    "| 정적 | GitHub Pages artifact run `37590862774`, head `811c95f0efa89ae4117d756b89ae17031648434f` | 프로젝트/ERD 본문 표식이 정적 HTML에 포함 |",
    "",
    "두 옛 구현은 migration 24개와 seed SQL SHA-256 `b6caa6f1b6569c9eed3f33b39049f85561ced0dfc743d2518356f1ee683606e1`가 같고, 격리 MySQL 8.4.11 DB에 같은 seed를 로드했다(글 16, 프로젝트 6, 배지 11). API 컨테이너 제한은 각 1 CPU·1536 MiB였다. Redis·OCI·운영 API는 사용하지 않았다.",
    "",
    "R 프로필은 38.610 ms RTT 평균 및 10 MiB 다운로드 중앙값 16,329,500 B/s를 사용했고 업로드도 같은 값으로 두었다. M은 지연 150 ms, 다운로드 200,000 B/s, 업로드 93,750 B/s다. CDP throttling은 TCP/TLS handshake를 그대로 재현하지 않는 브라우저 측 근사다. cold는 새 context, warm은 같은 context에서 조합당 2회 워밍업 후 15회 측정했다. 구현 순서는 교차했다.",
    "",
    "모든 측정 URL은 로컬 Caddy를 통해 열었다. 정적 artifact에 빌드된 외부 API 요청은 보내지 않고 `/api/v1/auth/me`만 CORS 응답을 갖춘 로컬 401로 가로챘다. 다른 외부 요청 차단은 0건이었다. 로컬 API 호출의 `POST /posts/{id}/view` 외 운영 쓰기는 없었다. Mac은 기존 SSH로 public Pages 헤더를 조회했으며 설치·파일 변경은 없었다. 제품 코드도 수정하지 않았다. 첫 두 파일럿은 브라우저 cache 차단 및 auth stub CORS 결함으로 제외하고 원자료와 사유를 `results-v2/discarded/`에 보존했다.",
    "",
    "## 경로와 표식",
    "",
    "| 시나리오 | CSR | 하이브리드 | 정적 | 표식 |",
    "|---|---|---|---|---|",
    "| 프로젝트 대문 | `/project/?slug=ken-blog` | `/project/ken-blog/` | `/ken-blog/post/project-06840552-43a2-4870-83a9-d3e848c71d7e/` | `개발 배경` |",
    "| ERD 문서 | `/project/?slug=ken-blog&doc=post-f9235d74-4d5b-4705-8f59-ba3511bd50e9` | `/project/ken-blog/docs/post-f9235d74-4d5b-4705-8f59-ba3511bd50e9/` | `/ken-blog/post/post-f9235d74-4d5b-4705-8f59-ba3511bd50e9/` | `전체 ERD` |",
    "| 일반 글 | `/post/?slug=post-f95ad3b1-cfc3-4e4f-8c57-06ddbfd87d9d` | `/post/?slug=post-f95ad3b1-cfc3-4e4f-8c57-06ddbfd87d9d` | `/ken-blog/post/post-f95ad3b1-cfc3-4e4f-8c57-06ddbfd87d9d/` | `증상과 재현` |",
    "| 홈 목록 | `/` | `/` | `/ken-blog/` → `/ken-blog/posts/` | `이미지 응답의 간헐적 연결 종료와 동기 스트리밍 전환` |",
    "| 앱 안 이동 | 프로젝트 대문에서 ERD 링크 클릭 | 프로젝트 대문에서 ERD 링크 클릭 | 프로젝트 대문에서 정적 ERD 링크 클릭 | `전체 ERD` |",
    "",
    "## 본문 표식 가시 시간 (ms, 중앙값/p75/p95; n=15/15)",
    "",
    "앱 안 이동 행은 프로젝트 대문을 연 뒤 화면 링크를 누른 시점부터 ERD 표식이 보일 때까지의 `click_to_content_ms`다. 그 외 행은 navigation 시작부터 표식 가시까지다. 백분위는 nearest-rank 방식이다.",
    "",
    "| 시나리오 | 프로필 | 캐시 | 순수 CSR | 하이브리드 | 정적 |",
    "|---|---:|---|---:|---:|---:|",
]
for scenario in scenarios:
    for profile in ("R", "M"):
        for cache in ("cold", "warm"):
            cells = [triplet(lookup[(scenario, profile, cache, impl)], "visible") for impl in implementations]
            lines.append(f"| {scenario_ko[scenario]} | {profile} | {cache} | {cells[0]} | {cells[1]} | {cells[2]} |")

lines += [
    "",
    "## LCP·TTFB·DCL·load·network idle (ms, 중앙값/p75/p95)",
    "",
    "직접 페이지 열기 4개 시나리오만 포함한다. `idle —`는 2.5초 관측 상한까지 network idle 이벤트가 없었음을 뜻하며 괄호는 해당 셀의 상한 도달 표본 수다.",
    "",
    "| 시나리오 | 프로필 | 캐시 | 순수 CSR | 하이브리드 | 정적 |",
    "|---|---:|---|---:|---:|---:|",
]
for scenario in scenarios[:-1]:
    for profile in ("R", "M"):
        for cache in ("cold", "warm"):
            cells = [metric_cell(lookup[(scenario, profile, cache, impl)]) for impl in implementations]
            lines.append(f"| {scenario_ko[scenario]} | {profile} | {cache} | {cells[0]} | {cells[1]} | {cells[2]} |")

lines += [
    "",
    "## 요청·API·전송 바이트 (직접 페이지 열기, 셀별 중앙값)",
    "",
    "요청은 브라우저 전체 요청, API는 `/api/v1` 요청, 서버 API는 실제 API 컨테이너까지 간 요청이다. auth는 로컬 가로채기 401 수다. 단계는 JSON API 응답 이벤트만으로 계산했고 badge/첨부 media는 제외했다. `응답 미관측`은 15회 합계이며 표식 렌더링 실패를 뜻하지 않는다.",
    "",
    "| 시나리오 | 프로필 | 캐시 | 순수 CSR | 하이브리드 | 정적 |",
    "|---|---:|---|---:|---:|---:|",
]
for scenario in scenarios[:-1]:
    for profile in ("R", "M"):
        for cache in ("cold", "warm"):
            cells = [request_cell(lookup[(scenario, profile, cache, impl)]) for impl in implementations]
            lines.append(f"| {scenario_ko[scenario]} | {profile} | {cache} | {cells[0]} | {cells[1]} | {cells[2]} |")

lines += [
    "",
    "## 앱 안 ERD 이동: 클릭부터 표식까지",
    "",
    "API 요청 수는 Playwright click 동작을 시작한 뒤 표식이 보이기 전에 시작된 전체 `/api/v1` 요청의 중앙값이다. 단계 수는 같은 구간에서 응답 이벤트까지 관측된 JSON API만으로 다시 계산했다. 이미지 API는 단계에서 제외했다. 마지막 값은 15회 전체 중 표식 시점까지 JSON API 응답이 관측되지 않은 요청 합계다. auth/me는 서버 API와 분리했다.",
    "",
    "| 프로필 | 캐시 | 순수 CSR | 하이브리드 | 정적 |",
    "|---|---|---:|---:|---:|",
]
for profile in ("R", "M"):
    for cache in ("cold", "warm"):
        cells = []
        for impl in implementations:
            row = lookup[("in_app_navigation", profile, cache, impl)]
            time = triplet(row, "visible")
            cells.append(
                f'{time}; API {n(row["click_api_request_med"])} '
                f'(서버 {n(row["click_api_server_med"])} · auth {n(row["click_auth_intercepts_med"])}) · '
                f'단계 {n(row["click_api_stages_med"])} · 응답 미관측 {row["click_api_pending_n"]}'
            )
        lines.append(f"| {profile} | {cache} | {cells[0]} | {cells[1]} | {cells[2]} |")

with (ROOT / "results-v2/load-replay-results.jsonl").open(encoding="utf-8") as f:
    load_runs = [json.loads(line) for line in f if line.strip()]
load_cpu = {r["implementation"]: r for r in csv.DictReader((ROOT / "results-v2/load-cpu-summary.csv").open(encoding="utf-8", newline=""))}
baseline = {r["container"]: r for r in csv.DictReader((ROOT / "results-v2/api-cpu-baseline.csv").open(encoding="utf-8", newline=""))}
load_by_impl = {r["implementation"]: r for r in load_runs}
lines += [
    "",
    "## API 서버 부하 재현",
    "",
    "cold ERD 한 번 열기 요청 목록은 `R` 프로필 첫 유효 표본에서 얻었다. 실제 요청 목록의 간격을 유지하면서 독자 시작만 200 ms 간격으로 300회 예약했고, 각 요청은 로컬 API로 전송했다. `POST /view`는 격리 DB에만 반영됐다. CPU는 cgroup 누적 사용량 차이를 1초 간격으로 측정한 1 CPU 기준 백분율이다.",
    "",
    "| 구현 | 1회 cold ERD의 API 요청 (서버 API) | 재생 | HTTP 결과 | API CPU 평균/최대 | 재생 구간 |",
    "|---|---:|---|---|---:|---|",
]
for impl, container in (("csr", "kenblog-v2-api-csr"), ("hybrid", "kenblog-v2-api-hybrid")):
    run, cpu, base = load_by_impl[impl], load_cpu[impl], baseline[container]
    one = lookup[("erd_document", "R", "cold", impl)]
    api_req = int(float(one["api_server_med"]))
    result = f'{run["status_counts"].get("200", 0)} × 200, {run["status_counts"].get("401", 0)} × 401, 실패 {run["failed"]}'
    cpu_text = f'{float(cpu["average_cpu_percent"]):.2f}% / {float(cpu["maximum_cpu_percent"]):.2f}%'
    base_text = f'기준 {float(base["average_cpu_percent"]):.2f}% / {float(base["maximum_cpu_percent"]):.2f}% (n={base["sample_count"]})'
    lines.append(f'| {implementation_ko[impl]} | {api_req} | 300회/60초, {run["requests_sent"]} 요청 | {result} | {cpu_text} | {base_text}; 부하 표본 n={cpu["sample_count"]} |')
lines.append("| 정적 | API 서버 0 (브라우저 auth/me 1회 401 가로채기) | 300회/60초에 서버 API 재생 없음 | 서버 요청 0 | 서버 API CPU 0 (구조상) | 로컬 인증 가로채기라 API 컨테이너 부하 없음 |")

lines += [
    "",
    "## 해석·한계 및 원자료",
    "",
    "- M cold 표식 중앙값은 프로젝트 대문 CSR/하이브리드/정적 3062/1579/851 ms, ERD 3536/1582/869 ms, 일반 글 2966/2990/779 ms, 홈 2572/2976/816 ms, 앱 안 ERD 이동 1215/490/443 ms였다. 구조별 HTML 본문 포함 여부와 JS·라우팅 구현이 다르므로 이를 단일 기능의 순수 효과로 해석할 수는 없다.",
    "- 10개 API 요청에서 응답 이벤트 전에 취소가 기록됐다(모두 하이브리드 M 프로필: 프로젝트 대문 cold 5, warm 1; ERD cold 3; 앱 안 cold 1). 본문 표식과 200 탐색은 성공했다. API stage 수는 응답 이벤트가 확인된 요청만 포함한다.",
    "- network idle 값은 2.5초 상한 안에 도달한 표본만 표시했다. 상한 도달 수를 각 셀에 함께 기록했으며, —를 0 ms로 해석하면 안 된다.",
    "- 정적 ERD cache smoke는 두 번 모두 HTTP 200이었다. 첫 방문 1,061,212 bytes/0 hit, 두 번째 11,202 bytes/53 hit. 실제 브라우저 캐시에서 304가 없어도 fresh max-age 응답은 로컬 캐시로 처리된다. 별도 조건부 HEAD는 304를 반환했다.",
    "- 원자료·집계·도구는 `/home/ubuntu/Develop/perf/ken-blog-static-vs-csr/` 아래에 있다: `results-v2/perf-runs.jsonl`, `results-v2/perf-runs-response-corrected.jsonl`, `results-v2/summary.csv`, `results-v2/summary.md`, `results-v2/docker-stats-1s.csv`, `results-v2/load-replay-results.jsonl`, `scripts-v2/run-perf-v2.cjs`, `scripts-v2/summarize-v2.py`, `scripts-v2/replay-load-v2.cjs`, `scripts-v2/summarize-cpu-v2.py`.",
    "",
]
OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text("\n".join(lines), encoding="utf-8")
print(f"wrote {OUT} ({len(lines)} lines)")
