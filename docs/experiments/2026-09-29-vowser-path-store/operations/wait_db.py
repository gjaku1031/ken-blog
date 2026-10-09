#!/usr/bin/env python3
"""컨테이너 TCP 수신 뒤 인증·쿼리 준비까지 재시도(계측 밖)."""

from __future__ import annotations

import argparse
import time

from shared.connect import mysql_connection, neo4j_driver


def wait_authenticated(backend: str, timeout_seconds: int = 90):
    deadline = time.monotonic() + timeout_seconds
    attempts = 0
    last_error = "not_attempted"
    while time.monotonic() < deadline:
        attempts += 1
        try:
            if backend == "mysql":
                connection = mysql_connection()
                try:
                    with connection.cursor() as cursor:
                        cursor.execute("SELECT 1")
                        assert cursor.fetchone()[0] == 1
                finally:
                    connection.close()
            else:
                driver = neo4j_driver()
                try:
                    with driver.session(database="neo4j") as session:
                        assert session.run("RETURN 1 AS ok").single()["ok"] == 1
                finally:
                    driver.close()
            print(f"{backend} authenticated query ready after {attempts} attempts")
            return
        except Exception as exc:
            # 연결 문자열/자격증명 값이 예외 메시지에 실릴 수 있어 유형만 기록.
            last_error = type(exc).__name__
            time.sleep(2)
    raise TimeoutError(f"{backend} authenticated query not ready in {timeout_seconds}s; "
                       f"attempts={attempts}, last_error_type={last_error}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--backend", choices=("mysql", "neo4j"), required=True)
    parser.add_argument("--timeout", type=int, default=90)
    args = parser.parse_args()
    wait_authenticated(args.backend, args.timeout)
