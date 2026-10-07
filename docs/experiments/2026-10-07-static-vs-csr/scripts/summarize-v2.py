#!/usr/bin/env python3
import csv
import json
import math
import re
from collections import defaultdict
from pathlib import Path

source = Path("results-v2/perf-runs.jsonl")
raw = [json.loads(line) for line in source.read_text(encoding="utf-8").splitlines() if line.strip()]
measured = [row for row in raw if not row["discarded"]]
implementations = ["csr", "hybrid", "static"]
scenarios = ["project_home", "erd_document", "general_post", "home_list", "in_app_navigation"]
profiles = ["R", "M"]
caches = ["cold", "warm"]
timing_key = lambda row: "click_to_content_ms" if row["scenario"] == "in_app_navigation" else "content_visible_ms"

def percentile(values, p):
    values = sorted(x for x in values if isinstance(x, (int, float)))
    return values[max(0, math.ceil(p * len(values)) - 1)] if values else None

def fmt(value):
    return "—" if value is None else f"{value:.1f}"

def app_api_item(item):
    path = item["path"].split("?", 1)[0]
    is_media = bool(re.fullmatch(r"/api/v1/stack-badges/\d+/image", path) or
                    re.fullmatch(r"/api/v1/posts/\d+/attachments/\d+/content", path))
    return item.get("api", False) and not is_media

def response_based_stages(row):
    items = sorted((x for x in row.get("requests", []) if app_api_item(x) and x.get("response_ms") is not None), key=lambda x: x["start_ms"])
    stages, stage_end = 0, float("-inf")
    for item in items:
        if stages == 0 or item["start_ms"] > stage_end + 1:
            stages += 1
            stage_end = item["response_ms"]
        else:
            stage_end = max(stage_end, item["response_ms"])
    return stages

def missing_api_responses(row):
    return sum(1 for x in row.get("requests", []) if app_api_item(x) and x.get("response_ms") is None)

def click_api_items_until_marker(row):
    if row["scenario"] != "in_app_navigation" or row.get("click_to_content_ms") is None:
        return []
    boundary = row["click_to_content_ms"]
    return [x for x in row.get("click_api_requests", [])
            if x.get("api", False) and x.get("start_ms") is not None and x["start_ms"] <= boundary]

def click_response_stages(row):
    boundary = row.get("click_to_content_ms")
    items = [x for x in click_api_items_until_marker(row)
             if app_api_item(x) and x.get("response_ms") is not None and x["response_ms"] <= boundary]
    items.sort(key=lambda x: x["start_ms"])
    stages, stage_end = 0, float("-inf")
    for item in items:
        if stages == 0 or item["start_ms"] > stage_end + 1:
            stages += 1
            stage_end = item["response_ms"]
        else:
            stage_end = max(stage_end, item["response_ms"])
    return stages

def click_pending_api_responses(row):
    boundary = row.get("click_to_content_ms")
    return sum(1 for item in click_api_items_until_marker(row)
               if app_api_item(item) and (item.get("response_ms") is None or item["response_ms"] > boundary))

corrected = []
for row in raw:
    item = dict(row)
    item["api_response_missing_count_recomputed"] = missing_api_responses(row)
    item["api_serial_steps_response_based_recomputed"] = response_based_stages(row)
    item["click_api_requests_until_content_recomputed"] = click_api_items_until_marker(row)
    item["click_api_request_count_until_content_recomputed"] = len(item["click_api_requests_until_content_recomputed"])
    item["click_api_server_request_count_until_content_recomputed"] = sum(bool(x.get("server_api")) for x in item["click_api_requests_until_content_recomputed"])
    item["click_api_serial_steps_until_content_recomputed"] = click_response_stages(row)
    item["click_api_pending_responses_until_content_recomputed"] = click_pending_api_responses(row)
    corrected.append(item)
Path("results-v2/perf-runs-response-corrected.jsonl").write_text(
    "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in corrected), encoding="utf-8")

def group_for(scenario, profile, cache, implementation):
    return [row for row in measured if row["scenario"] == scenario and row["profile"] == profile and row["cache"] == cache and row["implementation"] == implementation]

summary = []
for scenario in scenarios:
    for profile in profiles:
        for cache in caches:
            for implementation in implementations:
                rows = group_for(scenario, profile, cache, implementation)
                measure = timing_key(rows[0]) if rows else ("click_to_content_ms" if scenario == "in_app_navigation" else "content_visible_ms")
                result = {
                    "scenario": scenario,
                    "profile": profile,
                    "cache": cache,
                    "implementation": implementation,
                    "n": len(rows),
                    "success_n": sum(r["navigation_status"] == 200 and r[measure] is not None and r["navigation_error"] is None for r in rows),
                    "visible_med": percentile([r[measure] for r in rows], .50),
                    "visible_p75": percentile([r[measure] for r in rows], .75),
                    "visible_p95": percentile([r[measure] for r in rows], .95),
                    "lcp_med": percentile([r["lcp_ms"] for r in rows], .50),
                    "lcp_p75": percentile([r["lcp_ms"] for r in rows], .75),
                    "lcp_p95": percentile([r["lcp_ms"] for r in rows], .95),
                    "ttfb_med": percentile([r["ttfb_ms"] for r in rows], .50),
                    "ttfb_p75": percentile([r["ttfb_ms"] for r in rows], .75),
                    "ttfb_p95": percentile([r["ttfb_ms"] for r in rows], .95),
                    "dcl_med": percentile([r["dcl_ms"] for r in rows], .50),
                    "dcl_p75": percentile([r["dcl_ms"] for r in rows], .75),
                    "dcl_p95": percentile([r["dcl_ms"] for r in rows], .95),
                    "load_med": percentile([r["load_ms"] for r in rows], .50),
                    "load_p75": percentile([r["load_ms"] for r in rows], .75),
                    "load_p95": percentile([r["load_ms"] for r in rows], .95),
                    "network_idle_med": percentile([r["network_idle_ms"] for r in rows], .50),
                    "network_idle_p75": percentile([r["network_idle_ms"] for r in rows], .75),
                    "network_idle_p95": percentile([r["network_idle_ms"] for r in rows], .95),
                    "network_idle_cap_n": sum(r["network_idle_ms"] is None for r in rows),
                    "request_med": percentile([r["request_count"] for r in rows], .50),
                    "api_request_med": percentile([r["api_request_count"] for r in rows], .50),
                    "api_server_med": percentile([r["api_server_request_count"] for r in rows], .50),
                    "api_stages_med": percentile([response_based_stages(r) for r in rows], .50),
                    "api_missing_response_med": percentile([missing_api_responses(r) for r in rows], .50),
                    "api_missing_response_n": sum(missing_api_responses(r) for r in rows),
                    "encoded_bytes_med": percentile([r["encoded_bytes"] for r in rows], .50),
                    "cache_hits_med": percentile([r["cache_hits"] for r in rows], .50),
                    "304_med": percentile([r["cdp_304_count"] for r in rows], .50),
                    "disk_cache_med": percentile([r["cdp_disk_cache_count"] for r in rows], .50),
                    "auth_intercepts_med": percentile([r["auth_intercepts"] for r in rows], .50),
                    "blocked_external_med": percentile([r["blocked_external_requests"] for r in rows], .50),
                    "click_api_request_med": percentile([len(click_api_items_until_marker(r)) for r in rows], .50) if scenario == "in_app_navigation" else None,
                    "click_api_server_med": percentile([sum(bool(x.get("server_api")) for x in click_api_items_until_marker(r)) for r in rows], .50) if scenario == "in_app_navigation" else None,
                    "click_auth_intercepts_med": percentile([sum(bool(x.get("intercepted")) for x in click_api_items_until_marker(r)) for r in rows], .50) if scenario == "in_app_navigation" else None,
                    "click_api_stages_med": percentile([click_response_stages(r) for r in rows], .50) if scenario == "in_app_navigation" else None,
                    "click_api_pending_n": sum(click_pending_api_responses(r) for r in rows) if scenario == "in_app_navigation" else None,
                }
                summary.append(result)

columns = list(summary[0]) if summary else []
with Path("results-v2/summary.csv").open("w", newline="", encoding="utf-8") as stream:
    writer = csv.DictWriter(stream, fieldnames=columns)
    writer.writeheader()
    writer.writerows(summary)

lookup = {(x["scenario"], x["profile"], x["cache"], x["implementation"]): x for x in summary}
lines = [
    "# v2 측정 요약",
    "",
    f"측정 {len(measured)}회, 제외 워밍업 {len(raw) - len(measured)}회. 각 셀은 n=15 목표, 성공 수는 `summary.csv`에 기록.",
    "API 단계는 배지·첨부 이미지가 아닌 API JSON 요청 중 `response` 이벤트가 관측된 요청만으로 다시 계산했다. 무응답 취소는 별도 집계한다.",
    "",
    "## 본문 표식 가시 시간 (ms, 중앙값/p75/p95)",
    "",
    "| 시나리오 | 프로필 | 캐시 | CSR (`f29ef35`) | 하이브리드 (`135169f`) | 정적 |",
    "|---|---:|---|---:|---:|---:|",
]
scenario_names = {"project_home": "프로젝트 대문", "erd_document": "ERD 문서", "general_post": "일반 글", "home_list": "홈 목록", "in_app_navigation": "앱 안 ERD 이동"}
for scenario in scenarios:
    for profile in profiles:
        for cache in caches:
            cells = []
            for implementation in implementations:
                x = lookup[(scenario, profile, cache, implementation)]
                cells.append("—" if not x["n"] else f'{fmt(x["visible_med"])}/{fmt(x["visible_p75"])}/{fmt(x["visible_p95"])} (n={x["success_n"]}/{x["n"]})')
            lines.append(f"| {scenario_names[scenario]} | {profile} | {cache} | {cells[0]} | {cells[1]} | {cells[2]} |")

lines += ["", "## 요청·API·캐시·전송 바이트 (중앙값)", "", "| 시나리오 | 프로필 | 캐시 | CSR | 하이브리드 | 정적 |", "|---|---:|---|---:|---:|---:|"]
for scenario in scenarios:
    for profile in profiles:
        for cache in caches:
            cells = []
            for implementation in implementations:
                x = lookup[(scenario, profile, cache, implementation)]
                if not x["n"]:
                    cells.append("—")
                else:
                    cells.append(f'req {fmt(x["request_med"])} · API {fmt(x["api_request_med"])} · 서버 API {fmt(x["api_server_med"])} · auth 401 {fmt(x["auth_intercepts_med"])} · 단계 {fmt(x["api_stages_med"])} · 무응답 {fmt(x["api_missing_response_med"])} · bytes {fmt(x["encoded_bytes_med"])} · cache {fmt(x["cache_hits_med"])} / 304 {fmt(x["304_med"])}')
            lines.append(f"| {scenario_names[scenario]} | {profile} | {cache} | {cells[0]} | {cells[1]} | {cells[2]} |")

lines += ["", "## 앱 안 ERD 이동: 클릭부터 표식까지 (ms, 중앙값/p75/p95)", "",
          "API 요청 수는 클릭 동작 시작 뒤 표식 시점 전에 시작된 전체 `/api/v1` 요청이다. 단계 수는 같은 구간에서 응답 이벤트까지 관측된 JSON API만으로 계산하며 이미지 응답은 제외한다. 마지막 수는 15회 전체에서 표식 시점까지 응답 이벤트가 오지 않은 JSON API 수이며 정적의 가로챈 auth/me는 서버 API와 분리했다.", "",
          "| 프로필 | 캐시 | CSR (`f29ef35`) | 하이브리드 (`135169f`) | 정적 |",
          "|---|---|---:|---:|---:|"]
for profile in profiles:
    for cache in caches:
        cells = []
        for implementation in implementations:
            x = lookup[("in_app_navigation", profile, cache, implementation)]
            rows = group_for("in_app_navigation", profile, cache, implementation)
            times = [r["click_to_content_ms"] for r in rows]
            time_text = "/".join(fmt(percentile(times, p)) for p in (.50, .75, .95))
            if not x["n"]:
                cells.append("—")
            else:
                cells.append(f'{time_text}; API {fmt(x["click_api_request_med"])} (서버 {fmt(x["click_api_server_med"])} · auth {fmt(x["click_auth_intercepts_med"])}) · 단계 {fmt(x["click_api_stages_med"])} · 미응답 {x["click_api_pending_n"]}')
        lines.append(f"| {profile} | {cache} | {cells[0]} | {cells[1]} | {cells[2]} |")

Path("results-v2/summary.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
print(f"raw={len(raw)} measured={len(measured)} warmups={len(raw)-len(measured)} summary_groups={len(summary)}")
