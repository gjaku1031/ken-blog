#!/usr/bin/env node

import { createHash } from "node:crypto";
import { registerHooks } from "node:module";

const PAGE_SIZE = 100;
const DEFAULT_MAX_POSTS = 500;
const HARD_MAX_POSTS = 5000;
const DEFAULT_TIMEOUT_MS = 35000;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const SESSION_COOKIE = "KENBLOGSESSION";
const webLibUrl = new URL("../../apps/web/lib/", import.meta.url).href;

/** 비밀값·본문·요청 URL을 출력하지 않는 오류. */
class ToolError extends Error {
  constructor(message, status = null) {
    super(message);
    this.status = status;
  }
}

/** 도움말은 환경변수나 웹 의존성을 읽기 전에 표시한다. */
function options(args) {
  const result = { apply: false, maxPosts: DEFAULT_MAX_POSTS, timeoutMs: DEFAULT_TIMEOUT_MS };
  for (const arg of args) {
    if (arg === "--help") {
      process.stdout.write("사용법: node ops/wiki-links/reindex.mjs [--apply] [--max-posts=N] [--timeout-ms=N]\n기본은 게시글 연결 비변경 dry-run. 설정: WIKI_REINDEX_API_BASE_URL, WIKI_REINDEX_USERNAME, WIKI_REINDEX_PASSWORD\n");
      return null;
    }
    if (arg === "--apply") { result.apply = true; continue; }
    const match = /^--(max-posts|timeout-ms)=([0-9]+)$/.exec(arg);
    if (!match) throw new ToolError("지원하지 않는 옵션");
    const value = Number(match[2]);
    if (!Number.isSafeInteger(value)) throw new ToolError("옵션 값 범위 오류");
    if (match[1] === "max-posts") result.maxPosts = value;
    else result.timeoutMs = value;
  }
  if (result.maxPosts < 1 || result.maxPosts > HARD_MAX_POSTS) throw new ToolError("max-posts는 1~5000 필요");
  if (result.timeoutMs < 1000 || result.timeoutMs > 60000) throw new ToolError("timeout-ms는 1000~60000 필요");
  return result;
}

/** API 주소를 origin 하나로 제한해 비밀값 포함 URL과 원격 평문 전송을 거부한다. */
function apiBase() {
  const value = process.env.WIKI_REINDEX_API_BASE_URL;
  if (!value) throw new ToolError("API 주소 환경변수 필요");
  let url;
  try { url = new URL(value); } catch { throw new ToolError("API 주소 형식 오류"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password ||
      url.pathname !== "/" || url.search || url.hash) throw new ToolError("API 주소는 인증정보 없는 origin이어야 함");
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol === "http:" && !local) throw new ToolError("원격 API는 HTTPS 필요");
  return url.origin;
}

/** Node 24 내장 TypeScript 제거 기능으로 앱의 실제 공유 파서를 그대로 불러온다. */
async function sharedParser() {
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (context.parentURL?.startsWith(webLibUrl) && /^\.\.?\//.test(specifier) &&
          !/\.[cm]?[jt]s$/.test(specifier)) return nextResolve(`${specifier}.ts`, context);
      return nextResolve(specifier, context);
    },
  });
  try {
    const [details, wiki] = await Promise.all([
      import(new URL("../../apps/web/lib/markdown-details.ts", import.meta.url).href),
      import(new URL("../../apps/web/lib/wiki-link-syntax.ts", import.meta.url).href),
    ]);
    return { parseAnnotationDocument: details.parseAnnotationDocument,
      collectWikiTitles: wiki.collectWikiTitles };
  } catch {
    throw new ToolError("웹 공유 파서를 불러오지 못함. apps/web에서 npm ci 필요");
  }
}

/** 이 프로세스에서만 사용하는 JDBC 세션 쿠키와 CSRF 토큰을 관리한다. */
class ApiClient {
  constructor(base, timeoutMs) {
    this.base = base;
    this.timeoutMs = timeoutMs;
    this.cookie = "";
    this.csrf = "";
  }

  /** 성공 JSON의 크기를 제한하고 실패 응답 내용은 읽거나 출력하지 않는다. */
  async request(path, { method = "GET", body, csrf = false, expected = 200 } = {}) {
    const headers = { Accept: "application/json" };
    if (this.cookie) headers.Cookie = `${SESSION_COOKIE}=${this.cookie}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (csrf) headers["X-CSRF-TOKEN"] = this.csrf;
    let response;
    try {
      response = await fetch(new URL(path, this.base), {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body),
        redirect: "error", cache: "no-store", signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new ToolError("API 요청 실패 또는 시간 초과");
    }
    for (const header of response.headers.getSetCookie()) {
      const match = new RegExp(`^${SESSION_COOKIE}=([^;]*)`).exec(header);
      if (match) this.cookie = match[1];
    }
    if (response.status !== expected) throw new ToolError(`API 응답 HTTP ${response.status}`, response.status);
    if (expected === 204) return null;
    if (!response.headers.get("content-type")?.toLowerCase().includes("application/json")) {
      throw new ToolError("API JSON 응답 형식 오류");
    }
    const reader = response.body?.getReader();
    if (!reader) throw new ToolError("API 응답 본문 없음");
    const parts = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > MAX_RESPONSE_BYTES) throw new ToolError("API 응답 크기 초과");
        parts.push(value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const part of parts) { bytes.set(part, offset); offset += part.length; }
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch (error) {
      if (error instanceof ToolError) throw error;
      throw new ToolError("API JSON 응답 해석 실패");
    } finally { reader.releaseLock(); }
  }

  /** 로그인 전/후 CSRF를 각각 받아 세션 ID 교체를 반영한다. */
  async login(username, password) {
    const first = await this.request("/api/v1/auth/csrf");
    if (first?.headerName !== "X-CSRF-TOKEN" || typeof first.token !== "string") {
      throw new ToolError("CSRF 응답 계약 오류");
    }
    this.csrf = first.token;
    const user = await this.request("/api/v1/auth/login", {
      method: "POST", body: { username, password }, csrf: true,
    });
    if (user?.role !== "ADMIN") throw new ToolError("ADMIN 계정 필요");
    const second = await this.request("/api/v1/auth/csrf");
    if (second?.headerName !== "X-CSRF-TOKEN" || typeof second.token !== "string") {
      throw new ToolError("로그인 후 CSRF 응답 계약 오류");
    }
    this.csrf = second.token;
  }

  /** 남은 세션을 지우되 종료 처리 오류에 비밀값을 싣지 않는다. */
  async logout() {
    if (!this.cookie || !this.csrf) return;
    await this.request("/api/v1/auth/logout", { method: "POST", csrf: true, expected: 204 });
    this.cookie = "";
    this.csrf = "";
  }
}

/** 목록 총계를 먼저 검사한 후 ID만 모아 쓰기 전에 전체 범위를 확정한다. */
async function postIds(client, maxPosts) {
  const ids = [];
  let total = null;
  for (let page = 0; ; page++) {
    const response = await client.request(`/api/v1/admin/posts?page=${page}&size=${PAGE_SIZE}`);
    if (!Number.isSafeInteger(response?.totalElements) || response.totalElements < 0 ||
        !Array.isArray(response.items) || response.page !== page || response.size !== PAGE_SIZE) {
      throw new ToolError("관리자 목록 응답 계약 오류");
    }
    if (response.totalElements > maxPosts) throw new ToolError("글 수가 max-posts를 초과해 변경 전 중단");
    if (total !== null && response.totalElements !== total) throw new ToolError("목록 조회 중 전체 건수가 변경됨");
    total = response.totalElements;
    for (const item of response.items) {
      if (!Number.isSafeInteger(item?.id) || item.id < 1) throw new ToolError("관리자 목록 ID 오류");
      ids.push(item.id);
    }
    if (ids.length >= total || response.items.length === 0) break;
    if (page >= Math.ceil(maxPosts / PAGE_SIZE)) throw new ToolError("목록 페이지 상한 초과");
  }
  if (ids.length !== total || new Set(ids).size !== ids.length) {
    throw new ToolError("목록이 조회 중 변경되었거나 중복 ID가 있음");
  }
  return ids;
}

/** 저장된 제목과 공유 파서의 원문 순서가 모두 같을 때만 쓰기를 생략한다. */
function sameTargets(stored, expected) {
  if (!Array.isArray(stored) || !stored.every((value) => typeof value === "string")) {
    throw new ToolError("관리자 상세 wikiTargets 계약 오류");
  }
  return stored.length === expected.length &&
    stored.every((value, index) => value === expected[index]);
}

/** 실제 공유 파서가 확인한 제목만 SHA-256 본문 버전과 함께 보정한다. */
async function reindex(client, ids, parser, apply) {
  let unchanged = 0;
  let changed = 0;
  let conflicts = 0;
  for (const id of ids) {
    const detail = await client.request(`/api/v1/admin/posts/${id}`);
    if (detail?.id !== id || typeof detail.body !== "string") {
      throw new ToolError(`글 ${id}: 관리자 상세 계약 오류`);
    }
    let titles;
    try {
      const { root, items } = parser.parseAnnotationDocument(detail.body);
      titles = parser.collectWikiTitles(root, items).titles;
    } catch {
      throw new ToolError(`글 ${id}: 공유 파서 처리 실패`);
    }
    if (sameTargets(detail.wikiTargets, titles)) { unchanged++; continue; }
    changed++;
    if (!apply) { process.stdout.write(`글 ${id}: 변경 예정, 제목 수 ${titles.length}\n`); continue; }
    const digest = createHash("sha256").update(detail.body, "utf8").digest("hex");
    try {
      await client.request(`/api/v1/admin/posts/${id}/wiki-links`, {
        method: "PUT", csrf: true, body: { expectedBodySha256: digest, wikiTargets: titles },
      });
      process.stdout.write(`글 ${id}: 연결 갱신\n`);
    } catch (error) {
      if (error instanceof ToolError && error.status === 409) {
        conflicts++;
        process.stdout.write(`글 ${id}: 본문 변경 충돌 409, 건너뜀\n`);
        continue;
      }
      throw new ToolError(`글 ${id}: 쓰기 실패${error instanceof ToolError && error.status ? ` HTTP ${error.status}` : ""}`);
    }
  }
  process.stdout.write(`처리 ${ids.length}건, 동일 ${unchanged}건, ${apply ? "갱신 시도" : "변경 예정"} ${changed}건, 충돌 ${conflicts}건\n`);
  if (conflicts) process.exitCode = 2;
}

/** 기본 dry-run에서도 세션은 사용하되 적용 플래그에서만 게시글 연결을 변경한다. */
async function main() {
  const config = options(process.argv.slice(2));
  if (!config) return;
  const base = apiBase();
  const username = process.env.WIKI_REINDEX_USERNAME;
  const password = process.env.WIKI_REINDEX_PASSWORD;
  if (!username || !password) throw new ToolError("관리자 계정 환경변수 필요");
  const parser = await sharedParser();
  const client = new ApiClient(base, config.timeoutMs);
  process.stdout.write(`${config.apply ? "적용" : "연결 비변경 dry-run"} 시작 · 최대 ${config.maxPosts}건\n`);
  try {
    await client.login(username, password);
    const ids = await postIds(client, config.maxPosts);
    await reindex(client, ids, parser, config.apply);
  } finally {
    try { await client.logout(); }
    catch { process.stderr.write("세션 종료 확인 실패\n"); if (!process.exitCode) process.exitCode = 1; }
  }
}

try { await main(); }
catch (error) {
  process.stderr.write(`${error instanceof ToolError ? error.message : "도구 실행 실패"}\n`);
  process.exitCode = 1;
}
