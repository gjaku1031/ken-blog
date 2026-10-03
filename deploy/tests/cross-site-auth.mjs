import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import { chromium } from '@playwright/test';

/**
 * 격리 런타임 검사가 지정한 loopback 포트와 일회용 인증서
 */
const [upstreamPort, sitePort, apiPort, directory] = process.argv.slice(2);

/**
 * 운영 인증서와 무관한 로컬 테스트용 HTTPS 설정
 */
const tls = { key: await readFile(`${directory}/key.pem`), cert: await readFile(`${directory}/cert.pem`) };

/**
 * 두 HTTPS 사이트 사이 쿠키 전송 검사용 빈 문서
 */
const site = https.createServer(tls, (_request, response) => {
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.end('<!doctype html><html lang="ko"><title>인증 경계 검사</title><body>로컬 인증 검사</body></html>');
});

/**
 * 요청·응답·쿠키를 모의 처리하지 않고 실제 Spring API로 전달
 */
const api = https.createServer(tls, (request, response) => {
  const upstream = http.request({ hostname: '127.0.0.1', port: upstreamPort, path: request.url,
    method: request.method, headers: { ...request.headers, host: `127.0.0.1:${upstreamPort}` } }, result => {
    response.writeHead(result.statusCode, result.headers); result.pipe(response);
  });
  upstream.on('error', () => { response.writeHead(502); response.end(); });
  request.pipe(upstream);
});

/**
 * loopback 수신 완료 후 검증 시작
 */
async function listen(server, port, host) {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(Number(port), host, resolve); });
}

/**
 * 검증 브라우저, 일회용 자체 서명 인증서만 테스트 컨텍스트에서 허용
 */
let browser;
try {
  await listen(site, sitePort, '127.0.0.2');
  await listen(api, apiPort, '127.0.0.1');
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
  for (const rememberMe of [false, true]) {
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    await page.goto(`https://127.0.0.2:${sitePort}`);

    /**
     * 브라우저 fetch로 CORS·CSRF·쿠키를 실제 적용한 API 요청
     */
    async function request(path, method = 'GET', body, csrf) {
      return page.evaluate(async ({ url, method, body, csrf }) => {
        const response = await fetch(url, { method, credentials: 'include', headers: {
          ...(body ? { 'Content-Type': 'application/json' } : {}), ...(csrf ? { [csrf.headerName]: csrf.token } : {}),
        }, body: body ? JSON.stringify(body) : undefined });
        return { status: response.status, body: response.status === 204 ? null : await response.json() };
      }, { url: `https://127.0.0.1:${apiPort}/api/v1${path}`, method, body, csrf });
    }

    // 일반·기억 로그인 모두 CSRF 회전 뒤 메타데이터 저장까지 실제 HTTP로 수행
    const initial = await request('/auth/csrf');
    assert.equal(initial.status, 200);
    assert.equal((await request('/auth/login', 'POST', { password: 'jvm-ci-ephemeral-only', rememberMe }, initial.body)).status, 200);
    assert.equal((await request('/auth/me')).body.username, 'review_admin');
    const cookies = (await context.cookies()).filter(cookie => cookie.name === 'KENBLOGSESSION');
    assert.equal(cookies.length, 1);
    const cookie = cookies[0];
    assert.equal(cookie.secure, true); assert.equal(cookie.httpOnly, true); assert.equal(cookie.sameSite, 'None');
    assert.equal(cookie.partitionKey, `https://127.0.0.2`);
    assert.equal(cookie.expires > Date.now() / 1000, rememberMe);
    if (rememberMe) assert.ok(Math.abs(cookie.expires - Date.now() / 1000 - 2_592_000) < 10);
    const csrf = (await request('/auth/csrf')).body;
    const created = await request('/admin/posts', 'POST', { title: 'HTTPS auth check', summary: '', tags: [],
      categoryId: null, seriesId: null, order: null, relatedSeriesId: null }, csrf);
    assert.equal(created.status, 201);
    const id = created.body.id;
    const updated = await request(`/admin/posts/${id}/metadata`, 'PATCH', { title: 'HTTPS edited', summary: '', tags: ['HTTPS'],
      categoryId: null, seriesId: null, order: null, relatedSeriesId: null, baseVersion: created.body.editVersion }, csrf);
    assert.equal(updated.status, 200);
    assert.equal((await request(`/admin/posts/${id}`)).body.title, 'HTTPS edited');
    assert.equal((await request('/auth/logout', 'POST', undefined, csrf)).status, 204);
    assert.equal((await context.cookies()).filter(cookie => cookie.name === 'KENBLOGSESSION').length, 0);
    // 폐기한 세션 쿠키를 재주입해도 DB 세션은 복구되지 않음
    await context.addCookies(cookies);
    assert.equal((await request('/auth/me')).status, 401);
    await context.close();
  }
  console.log('PASS Chromium cross-site HTTPS: CSRF, session/remember cookies, metadata edit, logout, old-session rejection');
} finally {
  await browser?.close();
  site.closeAllConnections(); api.closeAllConnections();
  await Promise.all([new Promise(resolve => site.close(resolve)), new Promise(resolve => api.close(resolve))]);
}
