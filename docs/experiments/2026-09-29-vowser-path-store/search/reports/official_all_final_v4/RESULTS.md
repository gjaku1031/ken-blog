# 실험 1 — 합성 의도 벡터 검색부터 전체 경로 반환까지

[최신 한 장 요약 PDF](ONE_PAGE_LATEST.pdf) · [HTML](ONE_PAGE_LATEST.html). 기존 `ONE_PAGE.pdf`는 tmpfs 저장매체 확인 전 요약본으로 보존한다.

## 판정

**이번 고정 조건에서 Neo4j의 검색 지연 우위는 확인되지 않았다.** 1천·1만 경로의 네 비교 셀에서 MySQL+FAISS는 세 군이 완료한 동일 조건 모두에서 p50이 더 낮았다. 다만 같은 셀에서도 최종 경로 순서 품질이 항상 같지는 않으므로 지연 수치만으로 동등 품질 우위를 일반화하지 않는다. Neo4j 개선 어댑터는 이 네 셀의 top3 답 있는 질의에서 정확 순서 190/190을 유지했다. 원본 알고리즘 재현 어댑터는 벡터 후보 recall이 높아도 도메인 필터·LIMIT·재정렬 순서 때문에 정확 순서가 떨어졌다. 3만 경로는 Neo4j가 고정 3 GiB 설정의 적재 단계에서 두 분포 모두 OOM으로 종료되어 짝지은 검색 지연 비교가 성립하지 않는다.

이 결과는 **1536차원 고정 합성 벡터와 검색 전용 투영**의 단일 클라이언트 어댑터 실험이다. 원본 OpenAI 임베딩, 한국어 검색 정확도, LLM, STT, 전체 Vowser 응답 또는 처리량 결과가 아니다. `neo_original`도 원본 서비스 함수 호출 시간이 아니라 관측된 알고리즘을 재현한 어댑터이다.

## 상위 3개 경로 조건

각 행은 test 질의 200개를 3회 반복한 요청 600개다. 품질 분모는 첫 회차의 서로 다른 답 있는 질의 190개이며, 정답 없는 10개는 무응답 정합으로 따로 표시한다. 후보 recall@3은 후보 단계의 지표이고 정확순서는 최종 반환 순서다. p50/p95는 성공 요청의 worker 측정 지연이다. RSS는 **worker 프로세스의 관측 최대 RSS**이며 DB 메모리를 포함하지 않는다.

|분포|경로|힌트|군|p50 ms|p95 ms|정확순서/190|후보 recall@3|무응답/10|요청 실패/600|worker RSS MiB|
|---|---:|---|---|---:|---:|---:|---:|---:|---:|---:|
|skew|1,000|있음|mysql_faiss|1.90|2.43|190/190|1.000|10/10|0/600|115.8|
|skew|1,000|있음|neo_optimized|48.53|56.41|190/190|1.000|10/10|0/600|84.0|
|skew|1,000|있음|neo_original|27.05|32.23|186/190|1.000|10/10|0/600|84.0|
|skew|1,000|없음|mysql_faiss|2.04|2.53|190/190|1.000|10/10|0/600|115.4|
|skew|1,000|없음|neo_optimized|10.54|12.08|190/190|1.000|10/10|0/600|83.3|
|skew|1,000|없음|neo_original|29.33|33.20|180/190|1.000|10/10|0/600|83.3|
|uniform|1,000|있음|mysql_faiss|1.85|1.96|190/190|1.000|10/10|0/600|115.7|
|uniform|1,000|있음|neo_optimized|10.76|11.78|190/190|1.000|10/10|0/600|85.0|
|uniform|1,000|있음|neo_original|26.51|28.46|190/190|1.000|10/10|0/600|85.0|
|uniform|1,000|없음|mysql_faiss|2.05|2.46|190/190|1.000|10/10|0/600|115.2|
|uniform|1,000|없음|neo_optimized|10.52|12.02|190/190|1.000|10/10|0/600|83.8|
|uniform|1,000|없음|neo_original|28.58|32.22|178/190|1.000|10/10|0/600|83.8|
|skew|10,000|있음|mysql_faiss|2.04|2.60|189/190|0.998|10/10|0/600|386.7|
|skew|10,000|있음|neo_optimized|437.47|455.28|190/190|1.000|10/10|0/600|137.1|
|skew|10,000|있음|neo_original|27.90|29.86|150/190|0.972|10/10|0/600|137.1|
|skew|10,000|없음|mysql_faiss|2.10|2.63|190/190|1.000|10/10|0/600|383.7|
|skew|10,000|없음|neo_optimized|12.01|13.65|190/190|1.000|10/10|0/600|133.4|
|skew|10,000|없음|neo_original|29.91|33.83|150/190|1.000|10/10|0/600|133.4|
|uniform|10,000|있음|mysql_faiss|2.03|2.55|190/190|1.000|10/10|0/600|386.3|
|uniform|10,000|있음|neo_optimized|37.37|44.46|190/190|1.000|10/10|0/600|135.1|
|uniform|10,000|있음|neo_original|28.41|32.98|164/190|1.000|10/10|0/600|135.1|
|uniform|10,000|없음|mysql_faiss|2.15|2.67|189/190|0.998|10/10|0/600|382.3|
|uniform|10,000|없음|neo_optimized|11.87|13.52|190/190|1.000|10/10|0/600|132.4|
|uniform|10,000|없음|neo_original|29.81|34.23|161/190|1.000|10/10|0/600|132.4|
|skew|30,000|있음|mysql_faiss|2.17|2.71|183/190|0.988|10/10|0/600|985.4|
|skew|30,000|없음|mysql_faiss|2.23|2.67|185/190|0.988|10/10|0/600|981.0|
|uniform|30,000|있음|mysql_faiss|2.09|2.60|190/190|1.000|10/10|0/600|987.0|
|uniform|30,000|없음|mysql_faiss|2.19|2.70|185/190|0.984|10/10|0/600|970.0|

3만 경로의 Neo4j 행은 600회 요청 실패 행이 아니라 **적재 실패·검색 시도 0회**이므로 위 지연표에 넣지 않았다. 전체 56개 조건 행(Top10 진단 포함)의 Top1·정확순서 Wilson 95% 구간·무응답·왕복·반환 크기·warmup 정보는 [`conditions.csv`](conditions.csv)와 [`summary.json`](summary.json)에, 단계별 p50/p95는 [`phases.csv`](phases.csv)에 있다. 모든 56행의 후보 recall@3은 0.95 이상이나, 최종 경로 순서 정합과 별개의 지표다. 힌트 있는 `neo_optimized`는 도메인 exact scan을 사용하므로 그 조건의 후보 recall은 ANN 품질 측정으로 읽지 않는다.

## 실패·분모·자원

- 완료된 네 비교 셀: 세 군의 총 28,800개 test 요청, 요청 오류 0. 3만 경로 MySQL 단독 두 셀: 총 4,800개 test 요청, 요청 오류 0. 합계 **33,600개 요청, 오류 0**. 각 군·조건의 600회 warmup도 별도 실행했고 검색 지연 표본에서 제외했다.
- 3만 uniform Neo4j: 로더 `session.execute_write` 배치 중 158.822초 후 exit 137/OOMKilled. 부분 자료 ROOT 30, HEAD 23,100, STEP 292,600, NEXT_STEP 269,500. 벡터 인덱스 구축 전, 검색 시도 0회.
- 3만 skew Neo4j: 동일 1 CPU/3 GiB·로더 설정의 고정 재시도에서 `NEO_CREATE_HEADS` 중 169.263초 후 exit 137/OOMKilled. 부분 자료 ROOT 30, HEAD 24,000, STEP 304,000, NEXT_STEP 280,000. 벡터 인덱스 구축 전, 검색 시도 0회.
- 두 Neo4j 적재 실패는 이번 메모리 한도·로더 배치·재사용 볼륨이 포함된 환경의 관측이다. 전용 DB bind 경로인 `/tmp/vowser-eval-v2`는 이 VM에서 **tmpfs**에 놓였다([저장매체 증거](../../../operations/results/storage-medium.json)). tmpfs 사용이 OOM에 얼마나 기여했는지는 당시 cgroup 세부 계측이 없어 판정하지 않는다. Neo4j의 일반적인 3만 경로 수용 불가나 SSD 기반 운영 저장소의 성능을 뜻하지 않는다. 3만 MySQL은 uniform/skew 모두 완료했지만 비교 상대가 없으므로 3만 성능 우위 주장에 사용하지 않는다.
- 단독 DB 컨테이너 1 CPU/3 GiB와 worker 컨테이너 1 CPU/1 GiB를 설정했다. 두 **컨테이너 설정 상한의 단순 합**은 2 CPU/4 GiB이며 공유 호스트, tmpfs, 다른 서비스까지 포함한 전체 물리 RAM 4 GiB 상한을 뜻하지 않는다. 3만 MySQL 검색 중 worker RSS 최대 987.0 MiB. DB 메모리 스냅숏과 worker 최대 RSS는 다른 시점의 관측이므로 합쳐서 동시 최대 메모리로 표현하지 않는다. FAISS 인덱스와 벡터 원본은 worker 메모리를 사용하므로 이 RSS만으로 전체 구성의 메모리 절약을 주장할 수 없다.

## 저장·계획 증거

저장 모델은 현재 검색에서 조회하지 않는 ROOT/STEP 임베딩을 양 DB에서 동일하게 생략한 투영이다. [`final_disk_snapshot.json`](../../evidence/final_disk_snapshot.json)의 물리 바이트는 tmpfs인 `/tmp` 아래 같은 볼륨에 1천·1만·3만을 재적재한 뒤 종료 시점의 점유량이다. Neo4j 쪽은 3만 경로 미완성 자료와 앞선 재설정의 트랜잭션 로그를 포함하므로 셀별 순수 논리 저장효율로 비교하지 않는다. 완료된 3만 skew MySQL의 행 수·인덱스·`EXPLAIN`은 [`official_final_30000_skew_mysql.json`](../../evidence/official_final_30000_skew_mysql.json)에 보존했다. 완료된 Neo4j 셀의 `EXPLAIN`/`PROFILE`은 수집하지 않았다. OOM 후 부분 자료의 계획을 완료된 셀의 실행계획으로 대체하지 않는다.

## 실행 시간과 재현

아래 값은 각 일정 파일의 첫·마지막 UTC 기록 차이다. 적재·재시작·보정·warmup·test가 섞인 **일정 경과 시간**이며 검색 요청 지연이나 처음부터 전체를 재현하는 총 시간이 아니다. 여덟 일정의 경과 합계 **3725.3초 (62.1분)**에는 일정 사이의 대기·검토, 사전 입력 생성·smoke, 일정 밖 증거 수집이 들어가지 않는다. 첫 유효 일정 시작부터 마지막 3만 Neo 시도 종료까지의 달력상 간격은 **73.0분**으로, 그 사이의 대기·검토 및 일정 사이에 진행된 작업을 포함한다. 첫 일정 이전의 입력 생성·smoke와 마지막 일정 이후의 증거 수집은 이 달력상 간격에도 포함되지 않는다.

|일정|경과 초|
|---|---:|
|`official_1000_uniform_v3`|472.3|
|`official_1000_skew_v3`|585.3|
|`official_10000_uniform_v3`|744.1|
|`official_10000_skew_v3`|1253.0|
|`official_30000_uniform_v3`|186.4|
|`official_30000_uniform_mysql_only_v3`|154.0|
|`official_30000_skew_mysql_only_v3`|159.9|
|`official_30000_skew_neo_attempt_v3`|170.4|

입력·oracle·측정 코드는 사전 SHA로 동결했다. 최종 현재 경로의 `shared/environment.json`은 DB를 다음 실험용으로 재생성하며 갱신되었으나, 측정 당시 동일 바이트를 [`environment-measured.json`](../../evidence/environment-measured.json)에 보존했다. 그 SHA는 동결 manifest와 일치하고, 다른 19개 파일 및 입력·oracle은 모두 동결값과 일치한다. [`freeze_audit_final.json`](../../evidence/freeze_audit_final.json)에 차이를 기록했다. 원본 원시 파일 30개의 개별 SHA는 `summary.json`의 `provenance.input_sha256`에 있다. 로그·라운드 순서·train-only 보정·시작 준비 시간은 [`runs`](../../runs), [`logs`](../../logs), [`loads`](../../loads)에 보존했다. 측정 시작 전 두 번의 오케스트레이션 실패(v1 이름 매핑, v2 Bolt 준비 경합)는 요청 표본에 들어가지 않았고 실패 일정도 보존했다.

재현 시 [`PROTOCOL.md`](../../PROTOCOL.md), [`freeze_manifest.json`](../../freeze_manifest.json), [`environment-measured.json`](../../evidence/environment-measured.json)을 기준 증거로 먼저 확인한다. 공유 DB는 후속 실험을 위해 재생성되어 당시 DB 상태가 현재 존재하지 않는다. 새 실험에는 전용 DB의 배타적 사용권과 빈 전용 볼륨이 필요하다. `shared/setup.sh`는 고정 컨테이너 이름·포트와 기존 볼륨을 다시 사용할 수 있으므로 기존 후속 실험 인스턴스에 그대로 실행하지 않는다. 다음 절차는 **명령 예시이며 이번 보고서 작성 중 실행하지 않았다**. 원본 API 키 없이 합성 벡터만 사용한다.

1. 측정 디렉터리를 별도 경로로 복사하고 새 경로의 `search/runs`, `logs`, `loads`, `reports`, `evidence`, `smoke`, `freeze_manifest.json`을 비운다. 원본 증거와 기존 manifest는 그대로 둔다. 새 DB 인스턴스/빈 볼륨을 공통 계약의 1 CPU/3 GiB, worker 1 CPU/1 GiB로 구성하고 비밀 파일은 저장소 밖 0600으로 보관한다. 원본 `shared/environment.json`을 새 환경의 증거인 양 복사해 대체하지 않는다.
2. 새 경로에서 아래 첫 검사를 실행해 원본 동결 manifest의 **환경 파일을 제외한** 소스 해시와 입력·oracle 내부 해시가 일치하는지 확인한다. 그 뒤 새 컨테이너가 준비된 상태에서 새 환경을 실제로 캡처한다. 이미지 ID·패키지 버전·CPU/메모리 제한이 측정 당시 `environment-measured.json`과 같아야 동일 설정 재현이며, 차이가 있으면 새 조건으로 기록한다.

```bash
export SEARCH_ORIGINAL=/home/ubuntu/Develop/project/vowser/experiments/2026-09-29
export SEARCH_REPLAY=/path/to/isolated-search-replay
test ! -e "$SEARCH_REPLAY"
mkdir -p "$SEARCH_REPLAY"
cp -a "$SEARCH_ORIGINAL/shared" "$SEARCH_ORIGINAL/search" "$SEARCH_REPLAY/"
rm -rf -- "$SEARCH_REPLAY/search/runs" "$SEARCH_REPLAY/search/logs" "$SEARCH_REPLAY/search/loads" \
  "$SEARCH_REPLAY/search/reports" "$SEARCH_REPLAY/search/evidence" "$SEARCH_REPLAY/search/smoke"
rm -- "$SEARCH_REPLAY/search/freeze_manifest.json"
cd "$SEARCH_REPLAY"
# 전용 DB의 배타적 사용권을 확보한 빈 호스트/네임스페이스에서만 실행
test ! -e /tmp/vowser-eval-v2
! docker container inspect vowser-eval-v2-mysql >/dev/null 2>&1
! docker container inspect vowser-eval-v2-neo4j >/dev/null 2>&1
docker build -t vowser-eval-v2-client:py312 -f shared/Dockerfile.client shared
bash shared/setup.sh
bash shared/db-control.sh stop mysql
bash shared/db-control.sh stop neo4j
PYTHONPATH=. python3 - <<'PY'
import json, os
from pathlib import Path
from search.freeze import ROOT, FILES, sha256, verify_assets
old = json.loads((Path(os.environ['SEARCH_ORIGINAL'])/'search/freeze_manifest.json').read_text())
verify_assets()
changed = [p for p in FILES if p != 'shared/environment.json' and sha256(ROOT/p) != old['files_sha256'][p]]
assert not changed, changed
print('frozen source and input/oracle hashes match; environment checked separately')
PY
python3 shared/capture_environment.py
PYTHONPATH=. python3 - <<'PY'
import json, os
from pathlib import Path
old = json.loads((Path(os.environ['SEARCH_ORIGINAL'])/'search/evidence/environment-measured.json').read_text())
new = json.loads(Path('shared/environment.json').read_text())
assert new['image'] == old['image']
assert new['worker_pip_freeze'] == old['worker_pip_freeze']
for name in old['containers']:
    for key in ('image_id', 'nano_cpus', 'memory_bytes', 'memory_swap_bytes', 'port_bindings'):
        assert new['containers'][name][key] == old['containers'][name][key], (name, key)
print('image, package and resource contract match')
PY
PYTHONPATH=. python3 -m search.freeze create
PYTHONPATH=. python3 -m search.freeze verify
PYTHONPATH=. python3 -m search.run_config --n 1000 --distribution uniform --label replay_1000_uniform --authorized-by-parent
```

3. 이후 다른 규모·분포도 고유 label로 동일 순서 실행하고 원시 JSONL을 새 보고서에 집계한다. 현재 작업 폴더에서 옛 manifest를 유지한 채 `search.freeze verify`나 `search.run_config`를 호출하면 후속 DB 재생성으로 갱신된 `shared/environment.json` 때문에 실패하는 것이 정상이다. 기존 manifest의 해시를 고쳐 쓰거나 옛 환경 파일을 현재 환경으로 가장하지 않는다.

## 원시 결과 파일

- [`official_10000_skew_v3_mysql_skew_10000_r0.jsonl`](../../runs/official_10000_skew_v3_mysql_skew_10000_r0.jsonl): `e4990edeb94c90cea861a7e0884b828cdcab6dac88b37201246fe9774ae29d58`
- [`official_10000_skew_v3_mysql_skew_10000_r1.jsonl`](../../runs/official_10000_skew_v3_mysql_skew_10000_r1.jsonl): `4f4dcf16569422faa52a2911fda445374a601db2339306c9b0f28aa7035a5cfe`
- [`official_10000_skew_v3_mysql_skew_10000_r2.jsonl`](../../runs/official_10000_skew_v3_mysql_skew_10000_r2.jsonl): `9e3136eb8d98b20031484709ae563f4a15bdb2433ccc361763b9e4c61dd8844f`
- [`official_10000_skew_v3_neo_skew_10000_r0.jsonl`](../../runs/official_10000_skew_v3_neo_skew_10000_r0.jsonl): `f4cf49032ecd53a9f90b44575133cd7ec25cc1da63639b99668b546ee5340a00`
- [`official_10000_skew_v3_neo_skew_10000_r1.jsonl`](../../runs/official_10000_skew_v3_neo_skew_10000_r1.jsonl): `bb74406055c735b4306f5910b50c6f725bafa260230e21a04d405b99d914504e`
- [`official_10000_skew_v3_neo_skew_10000_r2.jsonl`](../../runs/official_10000_skew_v3_neo_skew_10000_r2.jsonl): `0e17d1ea040a3db94d692ce093f24ff2bc4a433493992d8ed564ad13c76719ca`
- [`official_10000_uniform_v3_mysql_uniform_10000_r0.jsonl`](../../runs/official_10000_uniform_v3_mysql_uniform_10000_r0.jsonl): `07070dc78fbd70dd8a5d53383e58dee95f4fb0835e2e555ba14afe9653056484`
- [`official_10000_uniform_v3_mysql_uniform_10000_r1.jsonl`](../../runs/official_10000_uniform_v3_mysql_uniform_10000_r1.jsonl): `4d97cf00b948b4e0def59c473529555b5b72e9cd64c8b43c2eb6546c83c27141`
- [`official_10000_uniform_v3_mysql_uniform_10000_r2.jsonl`](../../runs/official_10000_uniform_v3_mysql_uniform_10000_r2.jsonl): `0ba3e11eade7b1b93424142a90ecc3e3737552bf7feb7580485ee0525bcbd837`
- [`official_10000_uniform_v3_neo_uniform_10000_r0.jsonl`](../../runs/official_10000_uniform_v3_neo_uniform_10000_r0.jsonl): `3abb21f30e8b286e87703f00558d109528b4ab1283d07f4ecfdb7af1094bc3b2`
- [`official_10000_uniform_v3_neo_uniform_10000_r1.jsonl`](../../runs/official_10000_uniform_v3_neo_uniform_10000_r1.jsonl): `672213a13435667fcdeaa5a9cdf4629b778f2d1a3febd07d72421ee80c13a4fa`
- [`official_10000_uniform_v3_neo_uniform_10000_r2.jsonl`](../../runs/official_10000_uniform_v3_neo_uniform_10000_r2.jsonl): `dbd9998a993171b66c5d748368bd87ceb7c4402f3f542f6ca989683f9735bce9`
- [`official_1000_skew_v3_mysql_skew_1000_r0.jsonl`](../../runs/official_1000_skew_v3_mysql_skew_1000_r0.jsonl): `7a820552dad859332d6cb3635e583389daebcf4a994c18b36bdeac4db8a4e618`
- [`official_1000_skew_v3_mysql_skew_1000_r1.jsonl`](../../runs/official_1000_skew_v3_mysql_skew_1000_r1.jsonl): `1503df5da0059a2aed167c28ad71026a19a875313b30abc64ea4257919d3bfeb`
- [`official_1000_skew_v3_mysql_skew_1000_r2.jsonl`](../../runs/official_1000_skew_v3_mysql_skew_1000_r2.jsonl): `88462582539847b5bb618afd55a7bde0172fbee26e557638c5314169ccd69819`
- [`official_1000_skew_v3_neo_skew_1000_r0.jsonl`](../../runs/official_1000_skew_v3_neo_skew_1000_r0.jsonl): `8c115234a0aa18c6a8cb7ad214a14f9b7b5eddb4278dffba105e010dab08db61`
- [`official_1000_skew_v3_neo_skew_1000_r1.jsonl`](../../runs/official_1000_skew_v3_neo_skew_1000_r1.jsonl): `3607f04002acbcd2ef5772cef31679f15e7cdb0978e2758dd6a2749f5d386d23`
- [`official_1000_skew_v3_neo_skew_1000_r2.jsonl`](../../runs/official_1000_skew_v3_neo_skew_1000_r2.jsonl): `1cca6c3dc136b4b076c0dee1be6646b2502fc9dcaf7c9529563226c292433244`
- [`official_1000_uniform_v3_mysql_uniform_1000_r0.jsonl`](../../runs/official_1000_uniform_v3_mysql_uniform_1000_r0.jsonl): `d133482b15ef352ca384fec1afac8a9d58d14123601871f33b5614c9a5c28ea6`
- [`official_1000_uniform_v3_mysql_uniform_1000_r1.jsonl`](../../runs/official_1000_uniform_v3_mysql_uniform_1000_r1.jsonl): `7483e749832da6dd7a3eaaeb198e31932036a50cde3303662cae714bb34021b3`
- [`official_1000_uniform_v3_mysql_uniform_1000_r2.jsonl`](../../runs/official_1000_uniform_v3_mysql_uniform_1000_r2.jsonl): `1ac152cf7ac327918558d200454857e66ccd075662e7c992680b2e893d7ae2ad`
- [`official_1000_uniform_v3_neo_uniform_1000_r0.jsonl`](../../runs/official_1000_uniform_v3_neo_uniform_1000_r0.jsonl): `96f44008bbe9cfa49efee7b6e018ecafa4a4c334d04a8726a8529553118c33ad`
- [`official_1000_uniform_v3_neo_uniform_1000_r1.jsonl`](../../runs/official_1000_uniform_v3_neo_uniform_1000_r1.jsonl): `1700195bd6c39afdf3985c74eaed7d818afd23b32c7fb3438e594c54dd7316af`
- [`official_1000_uniform_v3_neo_uniform_1000_r2.jsonl`](../../runs/official_1000_uniform_v3_neo_uniform_1000_r2.jsonl): `b9f84a67de32e11d9b2e8181c9d33f4d9b6f8a771d28d2cd75692bdfe231601c`
- [`official_30000_skew_mysql_only_v3_mysql_skew_30000_r0.jsonl`](../../runs/official_30000_skew_mysql_only_v3_mysql_skew_30000_r0.jsonl): `f9e43603d31deef4f5bdc451de011beb19fe39a7b1baa0bbf6e72c4f30ca49b0`
- [`official_30000_skew_mysql_only_v3_mysql_skew_30000_r1.jsonl`](../../runs/official_30000_skew_mysql_only_v3_mysql_skew_30000_r1.jsonl): `7e39759bd6ae3442dcac577d7f08c05b77980765fe8812379dc2013549d244c9`
- [`official_30000_skew_mysql_only_v3_mysql_skew_30000_r2.jsonl`](../../runs/official_30000_skew_mysql_only_v3_mysql_skew_30000_r2.jsonl): `a7219470155aa93da0f3c0fd7192b532089b5fc0584fc2b14e9a208d5a8edb0f`
- [`official_30000_uniform_mysql_only_v3_mysql_uniform_30000_r0.jsonl`](../../runs/official_30000_uniform_mysql_only_v3_mysql_uniform_30000_r0.jsonl): `e8bcd35ee3f7d8bc9bdc9f28c733cef39bec91d2c10c9500e0e0e096e8646cbd`
- [`official_30000_uniform_mysql_only_v3_mysql_uniform_30000_r1.jsonl`](../../runs/official_30000_uniform_mysql_only_v3_mysql_uniform_30000_r1.jsonl): `4f6dd7cfb20ffb82954024cc219eff82588b1f8e7d84996f9eb9b5dd979557f2`
- [`official_30000_uniform_mysql_only_v3_mysql_uniform_30000_r2.jsonl`](../../runs/official_30000_uniform_mysql_only_v3_mysql_uniform_30000_r2.jsonl): `ecf3d40fecac1581130a4af897a7b5c30206598dee6ba0c73cbcda43760a5e7a`
