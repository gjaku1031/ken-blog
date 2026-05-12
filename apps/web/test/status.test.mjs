import assert from "node:assert/strict";
import test from "node:test";
import { checkApiStatus } from "../app/status.ts";

const baseUrl = "http://127.0.0.1:18081";

test("UP 응답은 요청 옵션을 지키고 프로세스 상태로 변환한다", async () => {
  let called = false;
  const result = await checkApiStatus(baseUrl, async (url, options) => {
    called = true;
    assert.equal(url.href, `${baseUrl}/api/v1/status`);
    assert.equal(options.cache, "no-store");
    assert.equal(options.redirect, "error");
    assert.equal(options.headers.Accept, "application/json");
    assert.equal(options.signal.aborted, false);
    return Response.json({ status: "UP" });
  });
  assert.equal(called, true);
  assert.deepEqual(result, { kind: "up" });
});

test("없는 주소와 잘못된 주소에서는 네트워크 요청을 하지 않는다", async () => {
  const neverFetch = async () => { throw Error("fetch must not run"); };
  assert.deepEqual(await checkApiStatus(undefined, neverFetch), { kind: "missing-config" });
  assert.deepEqual(await checkApiStatus(" ", neverFetch), { kind: "missing-config" });
  for (const value of [
    "not-a-url",
    "file:///etc/passwd",
    "http://user:password@localhost:8081",
    "http://localhost:8081/base",
    "http://localhost:8081/?secret=1",
    "http://localhost:8081/#internal",
  ]) {
    assert.deepEqual(await checkApiStatus(value, neverFetch), { kind: "invalid-config" });
  }
});

test("HTTP 오류에서는 원문을 읽지 않는다", async () => {
  const response = new Response("internal-secret", { status: 503 });
  response.json = () => { throw Error("body must not be read"); };
  assert.deepEqual(await checkApiStatus(baseUrl, async () => response), { kind: "http-error" });
});

test("연결 실패의 내부 메시지를 공개 결과에서 제거한다", async () => {
  const failure = async () => { throw Error("internal-secret http://private.internal"); };
  assert.deepEqual(await checkApiStatus(baseUrl, failure), { kind: "network-error" });
});

test("잘못된 JSON과 UP 이외의 값은 응답 형식 오류로 변환한다", async () => {
  const bodies = ["not-json", "null", "[]", "{}", '{"status":"DOWN"}', '{"status":1}'];
  for (const body of bodies) {
    const result = await checkApiStatus(baseUrl, async () => new Response(body));
    assert.deepEqual(result, { kind: "invalid-response" });
  }
});

test("본문 읽기가 지연되어도 전체 요청을 3초에 종료한다", async () => {
  let signal;
  const startedAt = performance.now();
  const result = await checkApiStatus(baseUrl, async (_url, options) => {
    signal = options.signal;
    return { ok: true, json: () => new Promise(() => {}) };
  });
  const elapsed = performance.now() - startedAt;
  assert.deepEqual(result, { kind: "timeout" });
  assert.equal(signal.aborted, true);
  assert.ok(elapsed >= 2_800 && elapsed < 4_500, `elapsed ${elapsed}ms`);
});
