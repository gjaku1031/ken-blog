#!/usr/bin/env python3
"""합성 경로·평가 문장 원본 생성. 실행 전 freeze_manifest.json으로 고정한다."""

import hashlib
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent

# 각 경로는 검색 평가용 합성 등록 자료이며 실제 사이트에서 수집·검증한 클릭 경로가 아니다.
# 문장 다섯 개의 순서: 직접 표현, 바꿔 말하기 두 개, 간접 표현, 유사 작업과 혼동될 표현.
TASKS = [
    ("weather_today", "weather.naver.com", "오늘 날씨 확인", "현재 지역의 오늘 기온과 날씨 상태를 확인", [
        "오늘 날씨 확인해 줘", "지금 바깥 기온이 몇 도야?", "오늘 비 오는지 알려줘", "외출할 때 우산 챙겨야 할지 보고 싶어", "내일 말고 오늘 날씨만 보여줘"]),
    ("weather_tomorrow", "weather.naver.com", "내일 날씨 확인", "다음 날의 기온과 강수 예보를 확인", [
        "내일 날씨 확인해 줘", "다음 날 기온 예보 보여줘", "내일 비 예보가 있나?", "내일 나들이 가도 괜찮을지 알고 싶어", "오늘 말고 내일 예보를 열어 줘"]),
    ("news_headlines", "news.naver.com", "최신 뉴스 헤드라인 보기", "현재 주요 뉴스의 헤드라인 목록을 확인", [
        "최신 뉴스 헤드라인 보여줘", "지금 주요 기사 목록 띄워 줘", "오늘의 속보 제목들을 보고 싶어", "세상에 무슨 일이 있는지 첫 화면 기사부터 훑고 싶어", "특정 주제 검색 말고 주요 뉴스만 보여줘"]),
    ("news_topic_search", "news.naver.com", "주제별 뉴스 검색", "지정한 주제의 뉴스 기사를 검색", [
        "반도체 관련 뉴스 검색해 줘", "특정 키워드가 들어간 기사 찾아줘", "전기차 기사만 검색해서 보여줘", "관심 있는 사건에 관한 보도를 모아서 읽고 싶어", "주요 기사 목록 말고 부동산 뉴스 검색해 줘"]),
    ("train_book", "letskorail.com", "기차표 예매", "출발지와 도착지를 정해 열차 좌석을 예약", [
        "서울에서 부산 가는 기차표 예매해 줘", "KTX 좌석을 새로 예약하고 싶어", "이번 주말 열차 승차권 구매 화면 열어 줘", "고향 내려갈 자리를 미리 확보해야 해", "기존 예약 조회 말고 새 기차표를 잡아 줘"]),
    ("train_schedule", "letskorail.com", "열차 시간표 조회", "두 역 사이 열차 운행 시각과 편명을 조회", [
        "서울 부산 열차 시간표 조회해 줘", "오늘 KTX 출발 시간들을 보여줘", "대전행 기차가 몇 시에 있는지 알아봐 줘", "출발 전에 탈 수 있는 열차 시간대를 비교하고 싶어", "표 구매하지 말고 운행 시간만 확인해 줘"]),
    ("train_reservation", "letskorail.com", "기차 예약 내역 조회", "이미 예매한 열차의 예약 번호와 승차권 정보를 조회", [
        "기차 예약 내역 조회해 줘", "내가 예매한 KTX 표를 보여줘", "기존 승차권 예약 번호 확인하고 싶어", "내일 타는 기차의 좌석이 몇 번인지 기억이 안 나", "열차 시간표 말고 내 예약 기록을 열어 줘"]),
    ("train_cancel", "letskorail.com", "기차표 예매 취소", "기존 열차 승차권 예약을 취소하고 환불 절차로 이동", [
        "예매한 기차표 취소해 줘", "KTX 예약을 취소하고 싶어", "열차 승차권 환불 화면으로 가 줘", "여행을 안 가게 돼서 잡아 둔 자리를 반납해야 해", "예약 조회에서 끝내지 말고 표 취소 절차를 열어 줘"]),
    ("resident_copy", "gov.kr", "주민등록등본 발급", "세대 구성과 주소 이력이 표시되는 주민등록등본 신청", [
        "주민등록등본 발급해 줘", "등본 인터넷 발급 화면 열어 줘", "세대원 나오는 주민등록 서류가 필요해", "은행에 낼 가족이 함께 적힌 거주 증명서를 떼야 해", "초본 말고 주민등록등본을 신청해 줘"]),
    ("resident_extract", "gov.kr", "주민등록초본 발급", "개인의 주소 변동 내역이 중심인 주민등록초본 신청", [
        "주민등록초본 발급해 줘", "초본 온라인 발급 화면 보여줘", "내 주소 변동 기록이 있는 주민등록 서류 떼 줘", "이사 이력을 증빙할 개인 서류가 필요해", "등본 말고 주민등록초본 신청해 줘"]),
    ("family_certificate", "gov.kr", "가족관계증명서 발급", "가족 관계를 증명하는 문서의 발급 화면으로 이동", [
        "가족관계증명서 발급해 줘", "가족 관계 확인 서류를 떼고 싶어", "부모와 자녀 관계가 적힌 증명서 신청해 줘", "자녀와의 관계를 입증하는 문서가 필요해", "주민등록등본이 아니라 가족관계증명서를 발급해 줘"]),
    ("youtube_search", "youtube.com", "유튜브 영상 검색", "검색어로 유튜브 영상 목록을 찾기", [
        "유튜브에서 요리 영상 검색해 줘", "동영상 사이트에서 기타 강좌 찾아줘", "유튜브 검색창에 여행 브이로그 찾아줘", "볼 만한 운동 영상을 찾고 싶어", "좋아요 누르지 말고 영상 검색만 해 줘"]),
    ("youtube_like", "youtube.com", "유튜브 영상 좋아요", "현재 시청 중인 유튜브 영상의 좋아요 버튼을 누르기", [
        "유튜브 영상에 좋아요 눌러 줘", "지금 보는 동영상 추천 표시해 줘", "이 유튜브 영상 좋아요 버튼 클릭해 줘", "마음에 드는 이 영상에 반응을 남기고 싶어", "새 영상 검색하지 말고 현재 영상에 좋아요 눌러 줘"]),
    ("order_track", "coupang.com", "쇼핑 주문 배송 조회", "이미 구매한 상품의 배송 위치와 도착 예정일 확인", [
        "쿠팡 주문 배송 조회해 줘", "내 택배가 어디쯤 왔는지 보여줘", "구매한 물건의 도착 예정일 확인해 줘", "어제 산 상품이 언제 도착할지 궁금해", "주문 취소 말고 배송 상태를 알려줘"]),
    ("order_cancel", "coupang.com", "쇼핑 주문 취소", "이미 구매한 상품의 주문 취소 절차로 이동", [
        "쿠팡 주문 취소해 줘", "구매한 상품 결제 취소하고 싶어", "아직 배송 전인 주문을 철회해 줘", "잘못 산 물건을 받기 전에 돌려야 해", "배송 조회 말고 주문 취소 화면 열어 줘"]),
    ("map_route", "map.naver.com", "길찾기 경로 조회", "출발지에서 목적지까지 이동 경로와 소요 시간을 조회", [
        "강남역에서 서울역까지 길찾기 해 줘", "네이버 지도에서 목적지까지 경로 보여줘", "홍대입구 가는 대중교통 길 알려줘", "약속 장소까지 어떻게 가야 빨리 도착할까?", "열차 시간표 말고 지금 위치에서 서울역 가는 길 알려줘"]),
]

AMBIGUOUS = [
    ("날씨 좀 봐줘", ["weather_today", "weather_tomorrow"], "조회 날짜 없음"),
    ("뉴스 찾아줘", ["news_headlines", "news_topic_search"], "최신 목록과 주제 검색 모두 가능"),
    ("기차표 확인해 줘", ["train_schedule", "train_reservation"], "운행표와 내 예약 모두 가능"),
    ("열차 예약 관련 화면 열어 줘", ["train_book", "train_reservation", "train_cancel"], "예매·조회·취소 구분 없음"),
    ("주민등록 서류 발급해 줘", ["resident_copy", "resident_extract"], "등본·초본 구분 없음"),
    ("정부 증명서 신청하고 싶어", ["resident_copy", "resident_extract", "family_certificate"], "문서 종류 없음"),
    ("유튜브에서 영상 처리해 줘", ["youtube_search", "youtube_like"], "찾기·좋아요 구분 없음"),
    ("쿠팡 주문 처리해 줘", ["order_track", "order_cancel"], "배송 조회·취소 구분 없음"),
]

UNANSWERABLE = [
    "비행기 표 예약해 줘", "호텔 숙박 예약해 줘", "은행 계좌 이체해 줘", "주민등록증 재발급 신청해 줘",
    "택시 호출해 줘", "음악 재생 목록 만들어 줘", "이메일 한 통 보내 줘", "온라인 병원 진료 예약해 줘",
]


def write_jsonl(path: Path, rows: list[dict]) -> None:
    path.write_text("".join(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n" for row in rows), encoding="utf-8")


def main() -> None:
    paths = []
    gold = []
    categories = ["direct", "paraphrase", "paraphrase", "indirect", "confusable"]
    for task_id, domain, intent, description, queries in TASKS:
        assert len(queries) == 5
        registration = {
            "sessionId": "eval-20260928-" + task_id,
            "taskIntent": intent,
            "domain": domain,
            "steps": [
                {"url": f"https://{domain}/", "domain": domain, "selectors": [f'[data-eval="{task_id}-start"]'], "action": "click", "description": description, "textLabels": [intent], "contextText": description},
                {"url": f"https://{domain}/", "domain": domain, "selectors": [f'[data-eval="{task_id}-end"]'], "action": "wait", "description": intent + " 결과 확인", "textLabels": [intent], "contextText": description},
            ],
        }
        paths.append({"id": task_id, "taskDescription": description, "synthetic_non_executable": True, "submission": registration})
        for n, (category, query) in enumerate(zip(categories, queries), 1):
            gold.append({"id": f"{task_id}-{n}", "query": query, "kind": "answerable", "expression_type": category, "expected_id": task_id})
    for n, (query, candidates, reason) in enumerate(AMBIGUOUS, 1):
        gold.append({"id": f"ambiguous-{n}", "query": query, "kind": "ambiguous", "expression_type": "underspecified", "acceptable_ids": candidates, "reason": reason})
    for n, query in enumerate(UNANSWERABLE, 1):
        gold.append({"id": f"unanswerable-{n}", "query": query, "kind": "unanswerable", "expression_type": "out_of_catalog", "expected_id": None})
    assert len(paths) == 16 and len(gold) == 96
    write_jsonl(HERE / "registered_paths.jsonl", paths)
    write_jsonl(HERE / "gold.jsonl", gold)
    manifest = {
        "created_utc": "2026-09-28",
        "authoring": "AI agent가 평가를 위해 직접 작성한 합성 문장과 합성 경로. 실제 이용자 발화·STT 결과·수집 클릭 경로가 아님.",
        "pre_execution_freeze": True,
        "source_agent_server_commit": "d94eaf5f30f734952838528d7045e0eab8891509",
        "paths": len(paths), "queries_total": len(gold), "answerable": 80, "ambiguous": 8, "unanswerable": 8,
        "files_sha256": {name: hashlib.sha256((HERE / name).read_bytes()).hexdigest() for name in ("registered_paths.jsonl", "gold.jsonl")},
    }
    (HERE / "freeze_manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
