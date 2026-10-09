#!/usr/bin/env python3
"""실험 1 입력·정답·측정 코드 SHA-256 동결/검증."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SEARCH = ROOT / "search"
MANIFEST = SEARCH / "freeze_manifest.json"
FILES = (
    "search/PROTOCOL.md", "search/build_inputs.py", "search/build_oracle.py",
    "search/load_data.py", "search/search_adapters.py", "search/smoke.py",
    "search/run_measure.py", "search/run_config.py", "search/report.py", "search/freeze.py",
    "search/preflight_memory.py",
    "shared/data.py", "shared/connect.py", "shared/run-client.sh",
    "shared/db-control.sh", "shared/Dockerfile.client", "shared/CONTRACT.md",
    "shared/environment.json", "search/assets/manifest.json",
    "search/assets/oracle_manifest.json",
)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def expected_files() -> dict[str, str]:
    return {name: sha256(ROOT / name) for name in FILES}


def verify_assets() -> None:
    inputs = json.loads((SEARCH / "assets/manifest.json").read_text(encoding="utf-8"))
    oracle = json.loads((SEARCH / "assets/oracle_manifest.json").read_text(encoding="utf-8"))
    for name, expected in inputs["files_sha256"].items():
        if sha256(SEARCH / "assets" / name) != expected:
            raise RuntimeError(f"input asset changed: {name}")
    for name, expected in oracle["files_sha256"].items():
        if sha256(SEARCH / "assets" / name) != expected:
            raise RuntimeError(f"oracle asset changed: {name}")
    if sha256(SEARCH / "build_inputs.py") != inputs["generator_sha256"]:
        raise RuntimeError("input generator differs from frozen assets")
    if sha256(ROOT / "shared/data.py") != inputs["shared_data_sha256"]:
        raise RuntimeError("shared generator differs from frozen assets")
    if sha256(SEARCH / "build_oracle.py") != oracle["generator_sha256"]:
        raise RuntimeError("oracle generator differs from frozen assets")
    if sha256(SEARCH / "assets/manifest.json") != oracle["inputs_manifest_sha256"]:
        raise RuntimeError("oracle was built against different input manifest")


def create() -> None:
    if MANIFEST.exists():
        raise RuntimeError("freeze manifest exists; use a new version for changed code")
    verify_assets()
    manifest = {"scope": "2026-09-29 experiment 1 search-only synthetic-vector measurement",
                "files_sha256": expected_files(),
                "frozen_input_files": 6, "frozen_oracle_files": 6,
                "official_measurement_started": False}
    MANIFEST.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({"status": "frozen", "manifest": str(MANIFEST), "sha256": sha256(MANIFEST)}, sort_keys=True))


def verify() -> None:
    verify_assets()
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    actual = expected_files()
    if actual != manifest["files_sha256"]:
        differences = [name for name in FILES if actual[name] != manifest["files_sha256"].get(name)]
        raise RuntimeError(f"frozen source changed: {differences}")
    print(json.dumps({"status": "verified", "manifest_sha256": sha256(MANIFEST)}, sort_keys=True))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("phase", choices=("create", "verify"))
    args = parser.parse_args()
    create() if args.phase == "create" else verify()
