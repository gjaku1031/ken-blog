"""전용 실험 DB 연결. 비밀번호는 마운트된 0600 파일에서만 읽음."""

from __future__ import annotations

import os
from pathlib import Path

import neo4j
import pymysql


def password() -> str:
    path = Path(os.environ.get("EVAL_CREDENTIALS_PATH", "/tmp/vowser-eval-v2/credentials.env"))
    key, value = path.read_text().strip().split("=", 1)
    if key != "EVAL_DB_PASSWORD" or not value:
        raise RuntimeError("Malformed credential file")
    return value


def mysql_connection(*, autocommit: bool = False):
    """PyMySQL 연결; 호출자가 commit/rollback과 close를 담당."""
    return pymysql.connect(
        host="127.0.0.1", port=19506, user="root", password=password(),
        database="vowser_eval_v2", charset="utf8mb4", autocommit=autocommit,
        connect_timeout=10, read_timeout=30, write_timeout=30,
    )


def neo4j_driver():
    """Neo4j Bolt 드라이버; 호출자가 close를 담당."""
    driver = neo4j.GraphDatabase.driver(
        "bolt://127.0.0.1:19587", auth=("neo4j", password()),
        max_connection_pool_size=20, connection_acquisition_timeout=30,
        max_transaction_retry_time=0,
    )
    driver.verify_connectivity()
    return driver
