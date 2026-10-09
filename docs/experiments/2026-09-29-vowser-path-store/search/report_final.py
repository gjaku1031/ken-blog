#!/usr/bin/env python3
"""측정 후 원시 집계와 적재 실패 증거를 합쳐 최종 보고서를 작성한다."""

from __future__ import annotations

import argparse
from datetime import datetime
import json
from pathlib import Path
import shutil

from search.freeze import sha256
from search.report import pdf_escape


ROOT = Path(__file__).resolve().parent
SCHEDULES = (
    "official_1000_uniform_v3", "official_1000_skew_v3",
    "official_10000_uniform_v3", "official_10000_skew_v3",
    "official_30000_uniform_v3", "official_30000_uniform_mysql_only_v3",
    "official_30000_skew_mysql_only_v3", "official_30000_skew_neo_attempt_v3",
)


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def fmt(value: float | None, digits: int = 2) -> str:
    return "—" if value is None else f"{value:.{digits}f}"


def schedule_evidence() -> tuple[list[dict], float, float]:
    records = []
    for label in SCHEDULES:
        path = ROOT / "runs" / f"{label}.schedule.jsonl"
        lines = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]
        start = datetime.fromisoformat(lines[0]["utc"])
        end = datetime.fromisoformat(lines[-1]["utc"])
        records.append({"label": label, "start_utc": start.isoformat(),
                        "end_utc": end.isoformat(), "elapsed_seconds": (end - start).total_seconds(),
                        "sha256": sha256(path), "event_count": len(lines)})
    total = sum(record["elapsed_seconds"] for record in records)
    span = (max(datetime.fromisoformat(record["end_utc"]) for record in records) -
            min(datetime.fromisoformat(record["start_utc"]) for record in records)).total_seconds()
    return records, total, span


def outcome_evidence() -> list[dict]:
    outcomes = []
    for distribution in ("uniform", "skew"):
        evidence = ROOT / "evidence"
        oom_path = evidence / f"official_30000_{distribution}_neo_oom.json"
        partial_path = evidence / f"official_30000_{distribution}_neo_partial.json"
        oom = read_json(oom_path)
        partial = read_json(partial_path)
        assert oom["oom_killed"] and oom["exit_code"] == 137 and oom["search_attempt_count"] == 0
        assert not partial["complete_fixture"] and partial["search_attempts"] == 0
        outcomes.append({"n_paths": 30000, "distribution": distribution, "backend": "neo",
                         "status": "load_oom_before_search", "search_attempts": 0,
                         "oom": oom, "partial": partial,
                         "oom_evidence_sha256": sha256(oom_path),
                         "partial_evidence_sha256": sha256(partial_path)})
    return outcomes


def result_markdown(rows: list[dict], provenance: dict, schedules: list[dict],
                    schedule_seconds: float, schedule_span: float, outcomes: list[dict]) -> str:
    lines = [
        "# 실험 1 — 합성 의도 벡터 검색부터 전체 경로 반환까지", "",
        "## 판정", "",
        "**이번 고정 조건에서 Neo4j의 검색 지연 우위는 확인되지 않았다.** 1천·1만 경로의 네 비교 셀에서 MySQL+FAISS는 세 군이 완료한 동일 조건 모두에서 p50이 더 낮았다. "
        "다만 같은 셀에서도 최종 경로 순서 품질이 항상 같지는 않으므로 지연 수치만으로 동등 품질 우위를 일반화하지 않는다. "
        "Neo4j 개선 어댑터는 이 네 셀의 top3 답 있는 질의에서 정확 순서 190/190을 유지했다. 원본 알고리즘 재현 어댑터는 벡터 후보 recall이 높아도 "
        "도메인 필터·LIMIT·재정렬 순서 때문에 정확 순서가 떨어졌다. 3만 경로는 Neo4j가 고정 3 GiB 설정의 적재 단계에서 두 분포 모두 OOM으로 종료되어 "
        "짝지은 검색 지연 비교가 성립하지 않는다.", "",
        "이 결과는 **1536차원 고정 합성 벡터와 검색 전용 투영**의 단일 클라이언트 어댑터 실험이다. "
        "원본 OpenAI 임베딩, 한국어 검색 정확도, LLM, STT, 전체 Vowser 응답 또는 처리량 결과가 아니다. "
        "`neo_original`도 원본 서비스 함수 호출 시간이 아니라 관측된 알고리즘을 재현한 어댑터이다.", "",
        "## 상위 3개 경로 조건", "",
        "각 행은 test 질의 200개를 3회 반복한 요청 600개다. 품질 분모는 첫 회차의 서로 다른 답 있는 질의 190개이며, "
        "정답 없는 10개는 무응답 정합으로 따로 표시한다. 후보 recall@3은 후보 단계의 지표이고 정확순서는 최종 반환 순서다. "
        "p50/p95는 성공 요청의 worker 측정 지연이다. RSS는 **worker 프로세스의 관측 최대 RSS**이며 DB 메모리를 포함하지 않는다.", "",
        "|분포|경로|힌트|군|p50 ms|p95 ms|정확순서/190|후보 recall@3|무응답/10|요청 실패/600|worker RSS MiB|",
        "|---|---:|---|---|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for row in sorted((r for r in rows if r["condition"].endswith("top3")),
                      key=lambda r: (r["n_paths"], r["distribution"], r["condition"], r["arm"])):
        hint = "있음" if row["condition"].startswith("hint") else "없음"
        lines.append(f"|{row['distribution']}|{row['n_paths']:,}|{hint}|{row['arm']}|{fmt(row['p50_ms'])}|"
                     f"{fmt(row['p95_ms'])}|{row['exact_order_count']}/{row['answerable_unique_queries']}|"
                     f"{fmt(row['candidate_recall_at3'], 3)}|{row['empty_correct_count']}/{row['empty_unique_queries']}|"
                     f"{row['failure_requests']}/600|{row['max_rss_bytes']/1048576:.1f}|")
    lines += [
        "", "3만 경로의 Neo4j 행은 600회 요청 실패 행이 아니라 **적재 실패·검색 시도 0회**이므로 위 지연표에 넣지 않았다. "
        "전체 56개 조건 행(Top10 진단 포함)의 Top1·정확순서 Wilson 95% 구간·무응답·왕복·반환 크기·warmup 정보는 "
        "[`conditions.csv`](conditions.csv)와 [`summary.json`](summary.json)에, 단계별 p50/p95는 [`phases.csv`](phases.csv)에 있다. "
        "모든 56행의 후보 recall@3은 0.95 이상이나, 최종 경로 순서 정합과 별개의 지표다. 힌트 있는 `neo_optimized`는 "
        "도메인 exact scan을 사용하므로 그 조건의 후보 recall은 ANN 품질 측정으로 읽지 않는다.", "",
        "## 실패·분모·자원", "",
        "- 완료된 네 비교 셀: 세 군의 총 28,800개 test 요청, 요청 오류 0. 3만 경로 MySQL 단독 두 셀: 총 4,800개 test 요청, 요청 오류 0. "
        "합계 **33,600개 요청, 오류 0**. 각 군·조건의 600회 warmup도 별도 실행했고 검색 지연 표본에서 제외했다.",
        "- 3만 uniform Neo4j: 로더 `session.execute_write` 배치 중 158.822초 후 exit 137/OOMKilled. 부분 자료 ROOT 30, HEAD 23,100, "
        "STEP 292,600, NEXT_STEP 269,500. 벡터 인덱스 구축 전, 검색 시도 0회.",
        "- 3만 skew Neo4j: 동일 1 CPU/3 GiB·로더 설정의 고정 재시도에서 `NEO_CREATE_HEADS` 중 169.263초 후 exit 137/OOMKilled. "
        "부분 자료 ROOT 30, HEAD 24,000, STEP 304,000, NEXT_STEP 280,000. 벡터 인덱스 구축 전, 검색 시도 0회.",
        "- 두 Neo4j 적재 실패는 이번 메모리 한도·로더 배치·재사용 볼륨이 포함된 환경의 관측이다. Neo4j의 일반적인 3만 경로 수용 불가를 뜻하지 않는다. "
        "3만 MySQL은 uniform/skew 모두 완료했지만 비교 상대가 없으므로 3만 성능 우위 주장에 사용하지 않는다.",
        "- 단독 DB 1 CPU/3 GiB + worker 1 CPU/1 GiB, 동시 자원 상한 합계 2 CPU/4 GiB. 3만 MySQL 검색 중 worker RSS 최대 "
        f"{max(r['max_rss_bytes'] for r in rows if r['n_paths']==30000)/1048576:.1f} MiB. "
        "DB 메모리 스냅숏과 worker 최대 RSS는 다른 시점의 관측이므로 합쳐서 동시 최대 메모리로 표현하지 않는다. "
        "FAISS 인덱스와 벡터 원본은 worker 메모리를 사용하므로 이 RSS만으로 전체 구성의 메모리 절약을 주장할 수 없다.", "",
        "## 저장·계획 증거", "",
        "저장 모델은 현재 검색에서 조회하지 않는 ROOT/STEP 임베딩을 양 DB에서 동일하게 생략한 투영이다. "
        "[`final_disk_snapshot.json`](../../evidence/final_disk_snapshot.json)의 물리 바이트는 1천·1만·3만 재적재에 사용한 볼륨의 종료 시점 값이다. "
        "Neo4j 쪽은 3만 경로 미완성 자료와 앞선 재설정의 트랜잭션 로그를 포함하므로 셀별 순수 논리 저장효율로 비교하지 않는다. "
        "완성된 3만 skew MySQL의 행 수·인덱스·`EXPLAIN`은 "
        "[`official_final_30000_skew_mysql.json`](../../evidence/official_final_30000_skew_mysql.json)에 보존했다. "
        "완료된 Neo4j 셀의 `EXPLAIN`/`PROFILE`은 수집하지 않았다. OOM 후 부분 자료의 계획을 완료된 셀의 실행계획으로 대체하지 않는다.", "",
        "## 실행 시간과 재현", "",
        "아래 값은 각 일정 파일의 첫·마지막 UTC 기록 차이다. 적재·재시작·보정·warmup·test가 섞인 **일정 경과 시간**이며 "
        "검색 요청 지연이나 처음부터 전체를 재현하는 총 시간이 아니다. 여덟 일정의 경과 합계 "
        f"**{schedule_seconds:.1f}초 ({schedule_seconds/60:.1f}분)**에는 일정 사이의 대기·검토, 사전 입력 생성·smoke, "
        "일정 밖 증거 수집이 들어가지 않는다. 첫 유효 일정 시작부터 마지막 3만 Neo 시도 종료까지의 달력상 간격은 "
        f"**{schedule_span/60:.1f}분**으로, 그 사이의 대기·검토 및 일정 사이에 진행된 작업을 포함한다. "
        "첫 일정 이전의 입력 생성·smoke와 마지막 일정 이후의 증거 수집은 이 달력상 간격에도 포함되지 않는다.", "",
        "|일정|경과 초|", "|---|---:|",
    ]
    for record in schedules:
        lines.append(f"|`{record['label']}`|{record['elapsed_seconds']:.1f}|")
    lines += [
        "", "입력·oracle·측정 코드는 사전 SHA로 동결했다. 최종 현재 경로의 `shared/environment.json`은 DB를 다음 실험용으로 재생성하며 갱신되었으나, "
        "측정 당시 동일 바이트를 [`environment-measured.json`](../../evidence/environment-measured.json)에 보존했다. "
        "그 SHA는 동결 manifest와 일치하고, 다른 19개 파일 및 입력·oracle은 모두 동결값과 일치한다. "
        "[`freeze_audit_final.json`](../../evidence/freeze_audit_final.json)에 차이를 기록했다. "
        "원본 원시 파일 30개의 개별 SHA는 `summary.json`의 `provenance.input_sha256`에 있다. "
        "로그·라운드 순서·train-only 보정·시작 준비 시간은 [`runs`](../../runs), [`logs`](../../logs), [`loads`](../../loads)에 보존했다. "
        "측정 시작 전 두 번의 오케스트레이션 실패(v1 이름 매핑, v2 Bolt 준비 경합)는 요청 표본에 들어가지 않았고 실패 일정도 보존했다.", "",
        "재현 시 [`PROTOCOL.md`](../../PROTOCOL.md), [`freeze_manifest.json`](../../freeze_manifest.json), "
        "[`environment-measured.json`](../../evidence/environment-measured.json)을 기준 증거로 먼저 확인한다. "
        "공유 DB는 후속 실험을 위해 재생성되어 당시 DB 상태가 현재 존재하지 않는다. 새 실험에는 전용 DB의 배타적 사용권과 빈 전용 볼륨이 필요하다. "
        "`shared/setup.sh`는 고정 컨테이너 이름·포트와 기존 볼륨을 다시 사용할 수 있으므로 기존 후속 실험 인스턴스에 그대로 실행하지 않는다. "
        "다음 절차는 **명령 예시이며 이번 보고서 작성 중 실행하지 않았다**. 원본 API 키 없이 합성 벡터만 사용한다.", "",
        "1. 측정 디렉터리를 별도 경로로 복사하고 새 경로의 `search/runs`, `logs`, `loads`, `reports`, `evidence`, `smoke`, "
        "`freeze_manifest.json`을 비운다. 원본 증거와 기존 manifest는 그대로 둔다. 새 DB 인스턴스/빈 볼륨을 "
        "공통 계약의 1 CPU/3 GiB, worker 1 CPU/1 GiB로 구성하고 비밀 파일은 저장소 밖 0600으로 보관한다. "
        "원본 `shared/environment.json`을 새 환경의 증거인 양 복사해 대체하지 않는다.",
        "2. 새 경로에서 아래 첫 검사를 실행해 원본 동결 manifest의 **환경 파일을 제외한** 소스 해시와 입력·oracle 내부 해시가 일치하는지 확인한다. "
        "그 뒤 새 컨테이너가 준비된 상태에서 새 환경을 실제로 캡처한다. 이미지 ID·패키지 버전·CPU/메모리 제한이 측정 당시 "
        "`environment-measured.json`과 같아야 동일 설정 재현이며, 차이가 있으면 새 조건으로 기록한다.", "",
        "```bash",
        "export SEARCH_ORIGINAL=/home/ubuntu/Develop/project/vowser/experiments/2026-09-29",
        "export SEARCH_REPLAY=/path/to/isolated-search-replay",
        "test ! -e \"$SEARCH_REPLAY\"",
        "mkdir -p \"$SEARCH_REPLAY\"",
        "cp -a \"$SEARCH_ORIGINAL/shared\" \"$SEARCH_ORIGINAL/search\" \"$SEARCH_REPLAY/\"",
        "rm -rf -- \"$SEARCH_REPLAY/search/runs\" \"$SEARCH_REPLAY/search/logs\" \"$SEARCH_REPLAY/search/loads\" \\",
        "  \"$SEARCH_REPLAY/search/reports\" \"$SEARCH_REPLAY/search/evidence\" \"$SEARCH_REPLAY/search/smoke\"",
        "rm -- \"$SEARCH_REPLAY/search/freeze_manifest.json\"",
        "cd \"$SEARCH_REPLAY\"",
        "# 전용 DB의 배타적 사용권을 확보한 빈 호스트/네임스페이스에서만 실행",
        "test ! -e /tmp/vowser-eval-v2",
        "! docker container inspect vowser-eval-v2-mysql >/dev/null 2>&1",
        "! docker container inspect vowser-eval-v2-neo4j >/dev/null 2>&1",
        "docker build -t vowser-eval-v2-client:py312 -f shared/Dockerfile.client shared",
        "bash shared/setup.sh",
        "bash shared/db-control.sh stop mysql",
        "bash shared/db-control.sh stop neo4j",
        "PYTHONPATH=. python3 - <<'PY'",
        "import json, os",
        "from pathlib import Path",
        "from search.freeze import ROOT, FILES, sha256, verify_assets",
        "old = json.loads((Path(os.environ['SEARCH_ORIGINAL'])/'search/freeze_manifest.json').read_text())",
        "verify_assets()",
        "changed = [p for p in FILES if p != 'shared/environment.json' and sha256(ROOT/p) != old['files_sha256'][p]]",
        "assert not changed, changed",
        "print('frozen source and input/oracle hashes match; environment checked separately')",
        "PY",
        "python3 shared/capture_environment.py",
        "PYTHONPATH=. python3 - <<'PY'",
        "import json, os",
        "from pathlib import Path",
        "old = json.loads((Path(os.environ['SEARCH_ORIGINAL'])/'search/evidence/environment-measured.json').read_text())",
        "new = json.loads(Path('shared/environment.json').read_text())",
        "assert new['image'] == old['image']",
        "assert new['worker_pip_freeze'] == old['worker_pip_freeze']",
        "for name in old['containers']:",
        "    for key in ('image_id', 'nano_cpus', 'memory_bytes', 'memory_swap_bytes', 'port_bindings'):",
        "        assert new['containers'][name][key] == old['containers'][name][key], (name, key)",
        "print('image, package and resource contract match')",
        "PY",
        "PYTHONPATH=. python3 -m search.freeze create",
        "PYTHONPATH=. python3 -m search.freeze verify",
        "PYTHONPATH=. python3 -m search.run_config --n 1000 --distribution uniform --label replay_1000_uniform --authorized-by-parent",
        "```", "",
        "3. 이후 다른 규모·분포도 고유 label로 동일 순서 실행하고 원시 JSONL을 새 보고서에 집계한다. "
        "현재 작업 폴더에서 옛 manifest를 유지한 채 `search.freeze verify`나 `search.run_config`를 호출하면 후속 DB 재생성으로 갱신된 "
        "`shared/environment.json` 때문에 실패하는 것이 정상이다. 기존 manifest의 해시를 고쳐 쓰거나 옛 환경 파일을 현재 환경으로 가장하지 않는다.", "",
        "## 원시 결과 파일", "",
    ]
    for path, digest in sorted(provenance["input_sha256"].items()):
        lines.append(f"- [`{Path(path).name}`](../../runs/{Path(path).name}): `{digest}`")
    return "\n".join(lines) + "\n"


def write_monospace_pdf(path: Path, lines: list[str]) -> None:
    """36행 비교표를 인쇄 가능한 10pt 고정폭 A4 가로 PDF로 저장한다."""
    if len(lines) > 40:
        raise RuntimeError("one-page PDF line budget exceeded")
    stream = ["BT /F1 10 Tf 28 560 Td 13 TL"]
    for index, line in enumerate(lines):
        if index:
            stream.append("T*")
        stream.append(f"({pdf_escape(line)}) Tj")
    stream.append("ET")
    content = ("\n".join(stream) + "\n").encode("ascii")
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>",
        f"<< /Length {len(content)} >>\nstream\n".encode("ascii") + content + b"endstream",
    ]
    output = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for i, obj in enumerate(objects, 1):
        offsets.append(len(output))
        output.extend(f"{i} 0 obj\n".encode("ascii") + obj + b"\nendobj\n")
    xref = len(output)
    output.extend(f"xref\n0 {len(objects)+1}\n0000000000 65535 f \n".encode("ascii"))
    for offset in offsets[1:]:
        output.extend(f"{offset:010d} 00000 n \n".encode("ascii"))
    output.extend(f"trailer\n<< /Root 1 0 R /Size {len(objects)+1} >>\nstartxref\n{xref}\n%%EOF\n".encode("ascii"))
    path.write_bytes(output)


def final_pdf(rows: list[dict], path: Path) -> None:
    lines = [
        "VOWSER EXPERIMENT 1 - synthetic vector to complete path (single-client adapter)",
        "Fixed 1536-d synthetic vectors. Not Korean / OpenAI / LLM / STT / end-to-end latency.",
        "DB 1 CPU / 3 GiB + worker 1 CPU / 1 GiB; one DB active at a time.",
        "Dist    N    Hint  Arm             p50   p95  Ordered  CandR3  Empty  Fail  WorkerRSSMiB",
    ]
    for row in sorted((r for r in rows if r["condition"].endswith("top3")),
                      key=lambda r: (r["n_paths"], r["distribution"], r["condition"], r["arm"])):
        arm = {"neo_original": "Neo original", "neo_optimized": "Neo optimized", "mysql_faiss": "MySQL+FAISS"}[row["arm"]]
        hint = "Y" if row["condition"].startswith("hint") else "N"
        lines.append(f"{row['distribution'][:1].upper():<4} {row['n_paths']:>5}  {hint:>4}   {arm:<14} "
                     f"{row['p50_ms']:>6.1f} {row['p95_ms']:>6.1f} "
                     f"{row['exact_order_count']:>3}/{row['answerable_unique_queries']:<3} "
                     f"{row['candidate_recall_at3']:>6.3f}  "
                     f"{row['empty_correct_count']:>2}/{row['empty_unique_queries']:<2} "
                     f"{row['failure_requests']:>2}/600 {row['max_rss_bytes']/1048576:>7.1f}")
    lines += [
        "30k Neo uniform and skew: load OOMKilled / exit 137 / search attempts 0; no paired latency.",
        "33,600 completed test requests, 0 request failures. 30k Neo failures are load failures.",
        "Worker RSS excludes DB. Physical disk uses reused volumes and incomplete Neo 30k fixture.",
        "Candidate recall >=.95 does not ensure exact final order; inspect full CSV and failure evidence.",
    ]
    write_monospace_pdf(path, lines)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", type=Path, default=ROOT / "reports/official_all_raw_v3")
    parser.add_argument("--output", type=Path, default=ROOT / "reports/official_all_final_v4")
    args = parser.parse_args()
    if args.output.exists() and any(args.output.iterdir()):
        raise RuntimeError("final report output already exists")
    args.output.mkdir(parents=True, exist_ok=True)
    original = read_json(args.base / "summary.json")
    rows = original["rows"]
    assert len(rows) == 56 and sum(row["requests"] for row in rows) == 33600
    assert all(row["failure_requests"] == 0 for row in rows)
    schedules, schedule_seconds, schedule_span = schedule_evidence()
    outcomes = outcome_evidence()
    final = {**original, "load_failures": outcomes, "schedules": schedules,
             "schedule_elapsed_sum_seconds": schedule_seconds,
             "schedule_calendar_span_seconds": schedule_span,
             "schedule_elapsed_sum_scope": "eight schedule first-to-last UTC intervals summed; excludes inter-schedule gaps and work outside schedules",
             "schedule_calendar_span_scope": "first valid schedule start to last Neo load attempt end; includes inter-schedule waits/review but excludes earlier preparation and later evidence collection",
             "freeze_audit": read_json(ROOT / "evidence/freeze_audit_final.json"),
             "disk_evidence": read_json(ROOT / "evidence/final_disk_snapshot.json"),
             "report_postprocessor_sha256": sha256(Path(__file__))}
    for name in ("conditions.csv", "phases.csv"):
        shutil.copy2(args.base / name, args.output / name)
    (args.output / "summary.json").write_text(json.dumps(final, indent=2, ensure_ascii=False, sort_keys=True) + "\n", encoding="utf-8")
    (args.output / "RESULTS.md").write_text(result_markdown(rows, original["provenance"], schedules,
                                                              schedule_seconds, schedule_span, outcomes), encoding="utf-8")
    final_pdf(rows, args.output / "ONE_PAGE.pdf")
    print(json.dumps({"status": "reported", "output": str(args.output), "rows": len(rows),
                      "requests": sum(row["requests"] for row in rows),
                      "load_failures": len(outcomes), "schedule_elapsed_sum_seconds": schedule_seconds}, sort_keys=True))


if __name__ == "__main__":
    main()
