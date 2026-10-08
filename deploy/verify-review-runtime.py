#!/usr/bin/env python3
"""격리 MySQL·실제 JAR에서 리뷰 마이그레이션·기동·HTTPS 인증 경계 검증"""

import argparse
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.request


def run(*args, **kwargs):
    """인수를 셸 해석 없이 실행하고 실패를 즉시 전파"""
    result = subprocess.run(args, text=True, capture_output=True, **kwargs)
    if result.returncode:
        raise subprocess.CalledProcessError(result.returncode, args, output=result.stdout, stderr=result.stderr)
    return result.stdout.strip()


def port():
    """격리 검사용 가용 loopback 포트 선택"""
    with socket.socket() as server:
        server.bind(("127.0.0.1", 0))
        return server.getsockname()[1]


def verify(browser_container):
    """기존 스키마 실패 → 명시 이관 성공 → 인증 상태 누락 실패·복구 검증"""
    name = f"ken-blog-review-runtime-{os.getpid()}"
    app = None
    with tempfile.TemporaryDirectory(prefix="review-runtime-", dir="build") as directory:
        work = Path(directory)
        api_port, site_port, tls_port = port(), port(), port()

        def sql(statement):
            """일회용 DB에만 SQL 실행, 운영 환경 변수는 사용하지 않음"""
            return run("docker", "exec", "-i", name, "mysql", "-h127.0.0.1", "-uroot", "-pci_review_only", "review_test", "-N", "-B", input=statement)

        def stop():
            """검증에서 생성한 앱 프로세스만 종료"""
            nonlocal app
            if app and app.poll() is None:
                app.terminate()
                try:
                    app.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    app.kill()
                    app.wait(timeout=5)
            app = None

        def start(label, expected_error=None):
            """DDL 변경 없이 앱을 기동하고 성공 또는 지정 실패 원인 확인"""
            nonlocal app
            env = {**os.environ, "DB_URL": f"jdbc:mysql://127.0.0.1:{db_port}/review_test?sslMode=DISABLED&allowPublicKeyRetrieval=true&connectTimeout=2000&socketTimeout=3000",
                   "DB_USERNAME": "root", "DB_PASSWORD": "ci_review_only", "ADMIN_USERNAME": "review_admin",
                   "APP_JPA_DDL_AUTO": "validate", "APP_SQL_INIT_MODE": "never", "AUTH_PROXY_KEY": "",
                   "SERVER_PORT": str(api_port), "SESSION_COOKIE_SECURE": "true", "SESSION_COOKIE_SAME_SITE": "none",
                   "SESSION_COOKIE_PARTITIONED": "true", "APP_ASSETS_DIRECTORY": "",
                   "APP_AUTH_CORS_ALLOWED_ORIGINS": f"https://127.0.0.2:{site_port}"}
            log = work / f"{label}.log"
            java = str(Path(os.environ["JAVA_HOME"]) / "bin/java") if "JAVA_HOME" in os.environ else "java"
            with log.open("w") as output:
                app = subprocess.Popen([java, "-jar", "build/libs/ken-blog-api.jar", "--spring.datasource.hikari.connection-timeout=1000"],
                    env=env, stdout=output, stderr=subprocess.STDOUT)
            if expected_error:
                assert app.wait(timeout=90) != 0, label
                assert expected_error in log.read_text(), log.read_text()[-7000:]
                print(f"PASS {label}: startup rejected", flush=True)
                app = None
                return
            deadline = time.monotonic() + 90
            while time.monotonic() < deadline:
                if app.poll() is not None:
                    raise AssertionError(log.read_text()[-7000:])
                try:
                    with urllib.request.urlopen(f"http://127.0.0.1:{api_port}/actuator/health", timeout=2) as response:
                        if json.load(response)["status"] == "UP":
                            # ApplicationRunner 실패 직전 잠깐 열린 HTTP 포트와 정상 기동을 구분
                            time.sleep(3)
                            assert app.poll() is None, log.read_text()[-7000:]
                            print(f"PASS {label}: validate/never startup", flush=True)
                            return
                except (OSError, ValueError):
                    pass
                time.sleep(0.5)
            raise AssertionError(f"{label}: startup timeout")

        try:
            # 외부 DB와 분리된 일회용 서버·데이터 준비
            run("docker", "run", "-d", "--name", name, "-p", "127.0.0.1::3306", "-e", "MYSQL_ROOT_PASSWORD=ci_review_only",
                "-e", "MYSQL_DATABASE=review_test", "mysql:8.4.11")
            deadline = time.monotonic() + 60
            while True:
                try:
                    sql("SELECT 1;")
                    break
                except subprocess.CalledProcessError:
                    assert time.monotonic() < deadline, "MySQL startup timeout"
                    time.sleep(1)
            db_port = run("docker", "port", name, "3306/tcp").rsplit(":", 1)[1]
            schema = Path("build/generated/jooq/schema.sql").read_text()
            assert schema.count("edit_version bigint not null, ") == 1
            sql(schema.replace("edit_version bigint not null, ", ""))
            sql(Path("deploy/sql/bootstrap-auth.sql").read_text())
            sql("DROP TABLE admin_login_sources; INSERT INTO content_state (id) VALUES (1);"
                "INSERT INTO posts (title,slug,summary,created_at,updated_at,status,visibility,section,series_order) "
                "VALUES ('legacy','legacy','',UTC_TIMESTAMP(6),UTC_TIMESTAMP(6),'DRAFT','PUBLIC','TECH',7);"
                "INSERT INTO users (username,password_hash,role,created_at,enabled) VALUES ('review_admin',"
                "'{bcrypt}$2b$10$4FBi6otvIFtcNbMAYerE3O1eSZAmB9sw3r4iEgU2ovjbUuSVcfivG','ADMIN',UTC_TIMESTAMP(6),true);")
            start("missing-edit-version", "missing column [edit_version]")
            sql(Path("deploy/sql/review-2026-10-03.sql").read_text())
            assert sql("SELECT series_order=7 AND edit_version=0 FROM posts WHERE slug='legacy';") == "1"
            start("migrated-schema")

            # 서로 다른 loopback IP를 HTTPS 사이트로 사용하며 실제 Spring API에 연결
            run("openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", str(work / "key.pem"), "-out", str(work / "cert.pem"),
                "-days", "1", "-subj", "/CN=review-test-only", "-addext", "subjectAltName=IP:127.0.0.1,IP:127.0.0.2")
            browser = [os.environ.get("NODE_BINARY", "node")]
            if browser_container:
                browser = ["docker", "exec", "-e", "CHROMIUM_PATH=/usr/bin/chromium", browser_container, "node"]
            try:
                print(run(*browser, "deploy/tests/cross-site-auth.mjs", str(api_port), str(site_port), str(tls_port),
                    str(work.resolve().relative_to(Path.cwd()))), flush=True)
            except subprocess.CalledProcessError as failure:
                raise AssertionError(failure.stderr[-7000:]) from failure

            # 실제 DB 중단 시 기존 JDBC 세션 읽기를 메모리 세션으로 대체하지 않고 503 반환
            with urllib.request.urlopen(f"http://127.0.0.1:{api_port}/api/v1/auth/csrf", timeout=5) as response:
                session_cookie = response.headers["Set-Cookie"].split(";", 1)[0]
            run("docker", "stop", "-t", "5", name)
            try:
                urllib.request.urlopen(urllib.request.Request(f"http://127.0.0.1:{api_port}/api/v1/auth/me",
                    headers={"Cookie": session_cookie}), timeout=10)
                raise AssertionError("DB outage accepted a session")
            except urllib.error.HTTPError as failure:
                body = failure.read().decode()
                assert failure.code == 503 and json.loads(body)["eventId"], body
                assert all(value not in body for value in ["ci_review_only", "jdbc:mysql", "SELECT "]), body
            print("PASS JDBC session database outage: 503 without credential/SQL disclosure", flush=True)
            stop()
            run("docker", "start", name)
            deadline = time.monotonic() + 60
            while True:
                try:
                    sql("SELECT 1;")
                    break
                except subprocess.CalledProcessError:
                    assert time.monotonic() < deadline, "MySQL restart timeout"
                    time.sleep(1)
            db_port = run("docker", "port", name, "3306/tcp").rsplit(":", 1)[1]

            # 일반 재시작은 유실한 인증 행을 재생성하지 않으며 명시 복구는 모든 세션 폐기
            sql("DELETE FROM admin_auth_state;")
            start("missing-auth-state", "EmptyResultDataAccessException")
            assert sql("SELECT COUNT(*) FROM admin_auth_state;") == "0"
            sql(Path("deploy/sql/recover-auth-state.sql").read_text())
            assert sql("SELECT COUNT(*) FROM SPRING_SESSION;") == "0"
            start("explicit-recovery")
        finally:
            stop()
            subprocess.run(["docker", "rm", "-f", "-v", name], capture_output=True)


# CI는 설치된 Chromium, 개발 환경은 선택한 로컬 검증 컨테이너 사용
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--browser-container")
    verify(parser.parse_args().browser_container)
