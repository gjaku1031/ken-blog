"""세 실험이 공유하는 경로 식별자·도메인·단계 결정식.

파일 전체를 메모리에 올리지 않도록 경로를 한 건씩 생성. 임베딩과 검색 질의는 실험 1에서 별도 동결.
"""

from __future__ import annotations

import hashlib
from collections.abc import Iterator

DEPTHS = (5, 10, 20)
SCALES = (1_000, 10_000, 30_000)
DOMAIN_COUNT = 30
INTENT_COUNT = 96
DISTRIBUTIONS = ("uniform", "skew")


def create_step_id(session_id: str, url: str, selectors: list[str], action: str) -> str:
    """원본 neo4j_service.create_step_id와 같은 MD5 입력 계약."""
    primary_selector = selectors[0] if selectors else "no_selector"
    value = f"{session_id}_{url}_{primary_selector}_{action}"
    return hashlib.md5(value.encode()).hexdigest()


def domain_index(path_id: int, distribution: str) -> int:
    """3개 깊이를 한 묶음으로 배치해 도메인·깊이 상관을 피함."""
    if distribution not in DISTRIBUTIONS:
        raise ValueError(f"unknown distribution: {distribution}")
    group = path_id // len(DEPTHS)
    if distribution == "uniform":
        return group % DOMAIN_COUNT
    return 0 if group % 2 == 0 else 1 + (group // 2) % (DOMAIN_COUNT - 1)


def domain_id(path_id: int, distribution: str = "uniform") -> int:
    """검색 벡터 생성기에서 사용할 0..29 도메인 정수 ID."""
    return domain_index(path_id, distribution)


def intent_id(path_id: int) -> int:
    """검색 벡터 생성기에서 사용할 0..95 의도 정수 ID."""
    if path_id < 0 or path_id >= max(SCALES):
        raise ValueError("path_id outside 0..29999")
    return (path_id // len(DEPTHS)) % INTENT_COUNT


def path_record(path_id: int, distribution: str = "uniform") -> dict:
    """정수 path_id의 원본형 단방향 선형 작업 경로를 결정적으로 생성."""
    if path_id < 0 or path_id >= max(SCALES):
        raise ValueError("path_id outside 0..29999")
    depth = DEPTHS[path_id % len(DEPTHS)]
    group = path_id // len(DEPTHS)
    domain = f"d{domain_index(path_id, distribution):02d}.example.test"
    session_id = f"v2-session-{path_id:06d}"
    intent_number = intent_id(path_id)
    intent = f"task-{intent_number:02d}"
    steps = []
    for ordinal in range(depth + 1):
        action = ("navigate", "click", "input", "submit")[ordinal % 4]
        url = f"https://{domain}/task/{path_id}/step/{ordinal}"
        selectors = [f"#step-{ordinal}"]
        steps.append({
            "ordinal": ordinal,
            "step_id": create_step_id(session_id, url, selectors, action),
            "url": url,
            "domain": domain,
            "selectors": selectors,
            "action": action,
            "description": f"{intent} {ordinal}번째 단계",
            "isInput": action == "input",
            "shouldWait": False,
            "textLabels": [intent],
            "successRate": 1.0,
        })
    return {
        "path_id": path_id,
        "session_id": session_id,
        "domain_id": domain_id(path_id, distribution),
        "intent_id": intent_number,
        "domain": domain,
        "distribution": distribution,
        "intent": intent,
        "depth": depth,
        "steps": steps,
    }


def iter_paths(total: int, distribution: str = "uniform") -> Iterator[dict]:
    """1k·10k·30k 입력을 동일 30k 생성 순서의 prefix로 제공."""
    if total not in SCALES:
        raise ValueError(f"total must be one of {SCALES}")
    for path_id in range(total):
        yield path_record(path_id, distribution)
