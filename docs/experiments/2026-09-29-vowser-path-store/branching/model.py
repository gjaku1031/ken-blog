"""실험 3의 등록 경로 원장과 독립 정답. 제품 코드는 사용하지 않는다."""

from __future__ import annotations

import hashlib
import json
import random
from collections import Counter, defaultdict

from shared.data import create_step_id, path_record

SEED = 20260929
CELLS = [(1000, share, cap) for share in (0, 25, 50) for cap in (1, 2, 4)] + [
    (10000, 0, 1),
    *[(10000, share, cap) for share in (25, 50) for cap in (1, 2, 4)],
]
STRESS_CELLS = [(1000,depth,share,cap) for depth in (50,100)
                for share,cap in ((0,1),(50,4))]
FIELDS = (
    "path_id", "domain", "intent", "auth", "depth", "ordinal",
    "step_id", "url", "action", "selector", "description",
)


def cell_id(total: int, share: int, cap: int, depth_override: int | None = None) -> str:
    depth = f"-d{depth_override}" if depth_override else ""
    return f"n{total}{depth}-s{share}-b{cap}"


def stable_json(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()


def digest(value: object) -> str:
    return hashlib.sha256(stable_json(value)).hexdigest()


def semantic_id(cell: str, key: tuple) -> str:
    return hashlib.md5(stable_json((cell, key))).hexdigest()


class Model:
    def __init__(self, total: int, share: int, cap: int, depth_override: int | None = None):
        stress = (total,depth_override,share,cap) in STRESS_CELLS
        stress_smoke = (total,depth_override,share,cap) == (360,100,50,4)
        if (total, share, cap) not in CELLS and total not in (360, 720) and not stress and not stress_smoke:
            raise ValueError("condition outside frozen matrix")
        if total in (360, 720) and (share not in (0, 25, 50) or cap not in (1, 2, 4)):
            raise ValueError("bad smoke condition")
        if depth_override is not None and not (stress or stress_smoke):
            raise ValueError("depth override outside stress matrix")
        self.total, self.share, self.cap = total, share, cap
        self.depth_override = depth_override
        self.depth_limit = depth_override or 20
        self.cell = cell_id(total, share, cap, depth_override)
        self.paths: dict[int, dict] = {}
        self.steps: dict[str, dict] = {}
        self.members: list[tuple[int, int, str]] = []
        self.next_edges: list[tuple[int, int, str, str]] = []
        self.path_steps: dict[int, list[str]] = {}
        self.contexts: dict[tuple[str, str, int], list[int]] = defaultdict(list)
        self._build()
        self._validate()

    def _build(self) -> None:
        groups: dict[tuple[str, str, int, int], list[int]] = defaultdict(list)
        source_paths = []
        for path_id in range(self.total):
            record = path_record(path_id)
            if self.depth_override:
                record["depth"] = self.depth_override
                record["steps"] = []
                for ordinal in range(self.depth_override+1):
                    action = ("navigate", "click", "input", "submit")[ordinal % 4]
                    url = f"https://{record['domain']}/task/{path_id}/step/{ordinal}"
                    selectors = [f"#step-{ordinal}"]
                    record["steps"].append({
                        "step_id":create_step_id(record["session_id"],url,selectors,action),
                        "url":url,"selectors":selectors,"action":action,
                        "description":f"{record['intent']} {ordinal}번째 단계",
                    })
            family = f"task-family-{record['intent_id'] % 4}"
            auth = (path_id // 90) % 2
            context = (record["domain"], family, auth)
            source_paths.append(record)
            self.contexts[context].append(path_id)
            groups[(*context, record["depth"])].append(path_id)

        clusters = {}
        if self.cap > 1:
            for group_key, path_ids in groups.items():
                for index, path_id in enumerate(path_ids):
                    clusters[path_id] = index // self.cap

        for record in source_paths:
            path_id = record["path_id"]
            depth = record["depth"]
            context = (record["domain"], f"task-family-{record['intent_id'] % 4}", (path_id // 90) % 2)
            planned = round(self.share * (depth + 1) / 100)
            ids: list[str] = []
            for ordinal, base in enumerate(record["steps"]):
                key: tuple | None = None
                kind = "unique"
                if self.share:
                    if ordinal == depth:
                        key, kind = (*context, "auth-gate"), "terminal"
                    elif self.cap == 1 and ordinal >= depth + 1 - planned:
                        key, kind = (*context, depth, "tail", ordinal), "suffix"
                    elif self.cap > 1 and ordinal < max(0, planned - 1):
                        key, kind = (*context, depth, clusters[path_id], "head", ordinal), "prefix"
                step_id = semantic_id(self.cell, key) if key else base["step_id"]
                if kind == "terminal":
                    url = f"https://{context[0]}/branch/{context[1]}/auth/{context[2]}"
                    action, selector, description = "authenticate", "#auth-gate", "공통 인증 단계"
                elif key:
                    cluster_suffix = f"/cluster/{clusters[path_id]}" if kind == "prefix" else ""
                    url = f"https://{context[0]}/branch/{context[1]}/auth/{context[2]}/{kind}/{depth}/{ordinal}{cluster_suffix}"
                    action = base["action"]
                    selector = f"#shared-{ordinal}"
                    description = f"{context[1]} {kind} {ordinal}{cluster_suffix}"
                else:
                    url = base["url"]
                    action = base["action"]
                    selector = base["selectors"][0]
                    description = base["description"]
                payload = {
                    "step_id": step_id, "url": url, "action": action,
                    "selector": selector, "description": description, "kind": kind,
                }
                existing = self.steps.setdefault(step_id, payload)
                if existing != payload:
                    raise AssertionError(f"shared STEP payload mismatch: {step_id}")
                ids.append(step_id)
                self.members.append((path_id, ordinal, step_id))
                if ordinal:
                    self.next_edges.append((path_id, ordinal - 1, ids[-2], step_id))
            self.path_steps[path_id] = ids
            self.paths[path_id] = {
                "path_id": path_id, "domain": context[0], "intent": context[1],
                "auth": context[2], "depth": depth,
                "original_intent": record["intent"], "start_step_id": ids[0],
            }

    def _validate(self) -> None:
        if len(self.paths) != self.total:
            raise AssertionError("path count")
        if len(self.members) != sum(p["depth"]+1 for p in self.paths.values()):
            raise AssertionError("member count")
        if len(self.next_edges) != sum(p["depth"] for p in self.paths.values()):
            raise AssertionError("edge count")
        context_by_step: dict[str, set[tuple]] = defaultdict(set)
        for path_id,ordinal,step_id in self.members:
            if self.path_steps[path_id][ordinal] != step_id:
                raise AssertionError("membership ordinal")
            path = self.paths[path_id]
            context_by_step[step_id].add((path["domain"],path["intent"],path["auth"]))
        if any(len(contexts) != 1 for contexts in context_by_step.values()):
            raise AssertionError("cross-context shared STEP")
        for path_id,ordinal,source,target in self.next_edges:
            ids = self.path_steps[path_id]
            if ids[ordinal] != source or ids[ordinal+1] != target:
                raise AssertionError("edge outside registered path")
        if self.stats()["max_outdegree"] > self.cap:
            raise AssertionError("branch cap exceeded")

    def rows_for(self, path_ids: list[int]) -> list[dict]:
        rows = []
        for path_id in path_ids:
            path = self.paths[path_id]
            for ordinal, step_id in enumerate(self.path_steps[path_id]):
                step = self.steps[step_id]
                rows.append({
                    "path_id": path_id, "domain": path["domain"],
                    "intent": path["intent"], "auth": path["auth"],
                    "depth": path["depth"], "ordinal": ordinal,
                    "step_id": step_id, "url": step["url"],
                    "action": step["action"], "selector": step["selector"],
                    "description": step["description"],
                })
        return rows

    def oracle(self, case: dict) -> list[dict]:
        context = (case["domain"], case["intent"], case["auth"])
        blocked = set(case["blocked"])
        valid = [p for p in self.contexts.get(context, ()) if not blocked.intersection(self.path_steps[p])]
        valid.sort(key=lambda p: (self.paths[p]["depth"], p))
        return self.rows_for(valid[:3])

    def cases(self) -> list[dict]:
        # 같은 N의 구조 셀에서 문맥·source path 순서를 고정해 쌍대 비교.
        rng = random.Random(SEED + self.total * 10000)
        contexts = sorted(k for k, p in self.contexts.items() if len(p) >= 4)
        if not contexts:
            raise ValueError("no context with alternatives")
        uses = Counter(step_id for ids in self.path_steps.values() for step_id in ids)
        private_step = {
            path_id: next(s for s in ids if uses[s] == 1)
            for path_id,ids in self.path_steps.items()
        }
        depths = sorted({p["depth"] for p in self.paths.values()})
        cases = []
        for i in range(200):
            context = contexts[(i * 37 + rng.randrange(len(contexts))) % len(contexts)]
            paths = self.contexts[context]
            if i < 160:
                target_depth = depths[i % len(depths)]
                candidates = [p for p in paths if self.paths[p]["depth"] == target_depth]
                source = candidates[(i + rng.randrange(len(candidates))) % len(candidates)]
                blocked = [private_step[p] for p in paths if self.paths[p]["depth"] < target_depth]
                blocked.append(private_step[source])
                scenario = "alternate"
            elif i < 180:
                source = None
                target_depth = None
                blocked = [private_step[path_id] for path_id in paths]
                scenario = "none"
            else:
                source = None
                target_depth = None
                blocked = sorted({self.path_steps[p][-1] for p in paths})
                scenario = "common_auth" if self.share else "all_auth_steps"
            case = {
                "case_id": i, "scenario": scenario, "domain": context[0],
                "intent": context[1], "auth": context[2],
                "source_path": source, "target_depth": target_depth,
                "blocked": sorted(set(blocked)),
            }
            expected = self.oracle(case)
            if source is not None and source in {r["path_id"] for r in expected}:
                raise AssertionError("blocked source in oracle")
            if scenario != "alternate" and expected:
                raise AssertionError("negative case has a result")
            case["oracle_sha256"] = digest(expected)
            case["oracle_rows"] = len(expected)
            case["oracle_paths"] = len({row["path_id"] for row in expected})
            cases.append(case)
        return cases

    def stats(self) -> dict:
        uses = Counter(step_id for _, _, step_id in self.members)
        successors: dict[str, set[str]] = defaultdict(set)
        predecessors: dict[str, set[str]] = defaultdict(set)
        physical_out = Counter()
        physical_in = Counter()
        unique_edges = set()
        for _, _, source, target in self.next_edges:
            successors[source].add(target)
            predecessors[target].add(source)
            physical_out[source] += 1
            physical_in[target] += 1
            unique_edges.add((source, target))
        reused = sum(count for count in uses.values() if count > 1)
        prefix_reused = sum(uses[s] for s, v in self.steps.items() if v["kind"] == "prefix" and uses[s] > 1)
        return {
            "cell": self.cell, "registered_paths": len(self.paths),
            "depth_counts": dict(Counter(p["depth"] for p in self.paths.values())),
            "membership_occurrences": len(self.members), "unique_steps": len(self.steps),
            "shared_membership_occurrences": reused,
            "actual_shared_percent": 100 * reused / len(self.members),
            "compression_percent": 100 * (1 - len(self.steps) / len(self.members)),
            "prefix_reused_occurrences": prefix_reused,
            "physical_next_edges": len(self.next_edges), "unique_next_pairs": len(unique_edges),
            "max_outdegree": max(map(len, successors.values()), default=0),
            "max_indegree": max(map(len, predecessors.values()), default=0),
            "max_physical_outdegree": max(physical_out.values(), default=0),
            "max_physical_indegree": max(physical_in.values(), default=0),
            "outdegree_histogram": dict(sorted(Counter(len(successors.get(s, ())) for s in self.steps).items())),
            "indegree_histogram": dict(sorted(Counter(len(predecessors.get(s, ())) for s in self.steps).items())),
            "physical_outdegree_histogram": dict(sorted(Counter(physical_out.get(s,0) for s in self.steps).items())),
            "physical_indegree_histogram": dict(sorted(Counter(physical_in.get(s,0) for s in self.steps).items())),
            "contexts": len(self.contexts),
        }
