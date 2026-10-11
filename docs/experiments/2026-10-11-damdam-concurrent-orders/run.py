#!/usr/bin/env python3
"""담담공방 동시 주문 실험 실행기

사용: run.py <API 주소> <PostgreSQL 컨테이너 이름> <결과 폴더>
필요: 로컬에 띄운 damdam API와 PostgreSQL 컨테이너, docker, python3(표준 라이브러리만 씀)
계정과 주문 정보는 모두 지어낸 값이고, 비밀번호는 실행할 때 만들어 결과에 남기지 않음
"""
import json
import secrets
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request

API, PG, OUT = sys.argv[1].rstrip("/"), sys.argv[2], sys.argv[3]
# 계획에서 고정한 값: 재고 2, 동시 요청 20, 조건마다 10회, 읽기와 차감 사이 20ms
STOCK, REQUESTS, REPEATS, GAP_SECONDS = 2, 20, 10, 0.02
USERS = 10
CHECK_NAME = "chk_product_variants_stock_nonnegative"


def psql(sql):
    """시험용 DB에서 SQL 실행, 결과는 탭 구분 문자열"""
    done = subprocess.run(["docker", "exec", "-i", PG, "psql", "-U", "damdam", "-d", "damdam", "-AtX", "-v", "ON_ERROR_STOP=1", "-c", sql],
                          capture_output=True, text=True)
    if done.returncode != 0:
        raise RuntimeError(done.stderr.strip())
    return done.stdout.strip()


def call(method, path, body=None, cookie=None):
    """API 호출, (상태 코드, 본문, Set-Cookie의 세션 값) 반환"""
    request = urllib.request.Request(API + path, method=method, data=None if body is None else json.dumps(body).encode(),
                                     headers={"Content-Type": "application/json", **({"Cookie": cookie} if cookie else {})})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.status, response.read().decode(), response.headers.get("Set-Cookie")
    except urllib.error.HTTPError as error:
        return error.code, error.read().decode(), None


def new_variant(product_id, name):
    """재고 2인 옵션 하나와 초기 재고 이력을 만들고 옵션 ID 반환"""
    variant_id = psql(f"""INSERT INTO product_variants (name, "priceAmount", stock, "isDefault", "productId")
                          VALUES ('{name}', 1000, {STOCK}, false, '{product_id}') RETURNING id""").splitlines()[0]
    psql(f"INSERT INTO inventory_adjustments (variant_id, delta, reason) VALUES ('{variant_id}', {STOCK}, '초기 재고')")
    return variant_id


def stock_of(variant_id):
    return int(psql(f"SELECT stock FROM product_variants WHERE id = '{variant_id}'"))


def run_api(product_id, cookies, repeat):
    """조건 A: 회원 10명이 2건씩 주문 20건을 동시에 보냄"""
    variant_id = new_variant(product_id, f"A-{repeat}")
    barrier, rows, lock = threading.Barrier(REQUESTS), [], threading.Lock()
    order = {"items": [{"variantId": variant_id, "quantity": 1}], "buyerName": "시험 주문자", "buyerPhone": "010-0000-0000",
             "shipName": "시험 수령인", "shipPhone": "010-0000-0000", "shipPostalCode": "00000", "shipAddress1": "시험 주소"}

    def send(index):
        barrier.wait()
        started = time.monotonic()
        status, body, _ = call("POST", "/api/orders", order, cookies[index % USERS])
        ended = time.monotonic()
        with lock:
            rows.append({"request": index, "status": status, "started": started, "ended": ended, "body": body[:160]})

    threads = [threading.Thread(target=send, args=(i,)) for i in range(REQUESTS)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    first_end = min(row["ended"] for row in rows)
    base = min(row["started"] for row in rows)
    for row in rows:
        row["started"], row["ended"] = round(row["started"] - base, 4), round(row["ended"] - base, 4)
    ledger = int(psql(f"SELECT COALESCE(SUM(delta), 0) FROM inventory_adjustments WHERE variant_id = '{variant_id}'"))
    return {"condition": "A", "repeat": repeat, "success": sum(row["status"] == 201 for row in rows),
            "statuses": sorted(row["status"] for row in rows), "stock": stock_of(variant_id), "ledgerSum": ledger,
            "overlapped": sum(row["started"] + base < first_end for row in rows),
            "startSpreadSeconds": max(row["started"] for row in rows), "requests": sorted(rows, key=lambda row: row["request"])}


def run_sql(product_id, condition, repeat):
    """조건 B·C: DB 세션 20개가 같은 시각에 '읽고, 1 이상이면 빼기'를 잠금 없이 실행"""
    variant_id = new_variant(product_id, f"{condition}-{repeat}")
    start_at = psql("SELECT (clock_timestamp() + interval '3 seconds')::text")
    block = f"""DO $$
DECLARE current_stock integer;
BEGIN
  PERFORM pg_sleep(GREATEST(0, EXTRACT(EPOCH FROM (TIMESTAMPTZ '{start_at}' - clock_timestamp()))));
  SELECT stock INTO current_stock FROM product_variants WHERE id = '{variant_id}';
  IF current_stock >= 1 THEN
    PERFORM pg_sleep({GAP_SECONDS});
    UPDATE product_variants SET stock = stock - 1 WHERE id = '{variant_id}';
    RAISE NOTICE 'RESULT decremented';
  ELSE
    RAISE NOTICE 'RESULT soldout';
  END IF;
END $$;"""
    sessions = [subprocess.Popen(["docker", "exec", "-i", PG, "psql", "-U", "damdam", "-d", "damdam", "-AtX", "-c", block],
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True) for _ in range(REQUESTS)]
    outcomes = []
    for session in sessions:
        _, stderr = session.communicate()
        if "RESULT decremented" in stderr:
            outcomes.append("decremented")
        elif "RESULT soldout" in stderr:
            outcomes.append("soldout")
        elif CHECK_NAME in stderr:
            outcomes.append("check_violation")
        else:
            outcomes.append("error: " + stderr.strip()[:120])
    return {"condition": condition, "repeat": repeat, "success": outcomes.count("decremented"),
            "checkViolations": outcomes.count("check_violation"), "soldout": outcomes.count("soldout"),
            "otherErrors": [o for o in outcomes if o.startswith("error")], "stock": stock_of(variant_id)}


def main():
    status, _, _ = call("GET", "/api/health")
    assert status == 200, "API가 응답하지 않음"
    run_id = secrets.token_hex(3)
    cookies = []
    for index in range(USERS):
        password = "Pw" + secrets.token_hex(8) + "1a"
        status, body, cookie = call("POST", "/api/auth/register", {"username": f"t{run_id}_{index}", "password": password,
                                                                    "serviceTermsAccepted": True, "privacyTermsAccepted": True})
        assert status in (200, 201) and cookie, f"가입 실패: {status} {body[:120]}"
        cookies.append(cookie.split(";")[0])
    product_id = psql(f"INSERT INTO products (name, visible) VALUES ('동시 주문 시험 {run_id}', true) RETURNING id").splitlines()[0]
    results = [run_api(product_id, cookies, repeat) for repeat in range(1, REPEATS + 1)]
    results += [run_sql(product_id, "B", repeat) for repeat in range(1, REPEATS + 1)]
    psql(f'ALTER TABLE product_variants DROP CONSTRAINT "{CHECK_NAME}"')
    try:
        results += [run_sql(product_id, "C", repeat) for repeat in range(1, REPEATS + 1)]
    finally:
        # 음수가 된 시험용 옵션을 0으로 올린 뒤 제약을 되돌림
        psql("UPDATE product_variants SET stock = 0 WHERE stock < 0")
        psql(f'ALTER TABLE product_variants ADD CONSTRAINT "{CHECK_NAME}" CHECK (stock >= 0)')
    environment = {"postgres": psql("SELECT version()"), "isolation": psql("SHOW default_transaction_isolation"),
                   "statementTimeout": "5000ms (API 연결 설정)", "stock": STOCK, "requests": REQUESTS, "repeats": REPEATS,
                   "gapSeconds": GAP_SECONDS, "users": USERS}
    with open(f"{OUT}/raw.json", "w", encoding="utf-8") as file:
        json.dump({"environment": environment, "results": results}, file, ensure_ascii=False, indent=1)
    summary = [{key: row[key] for key in row if key not in ("requests",)} for row in results]
    with open(f"{OUT}/summary.json", "w", encoding="utf-8") as file:
        json.dump(summary, file, ensure_ascii=False, indent=1)
    for row in summary:
        print(json.dumps(row, ensure_ascii=False))


main()
