const { chromium } = require('/home/ubuntu/Develop/project/ken-blog/node_modules/playwright');
const { performance } = require('node:perf_hooks');
const fs = require('node:fs');
const path = require('node:path');

const TOTAL = 15;
const WARMUPS = 2;
const IDLE_CAP_MS = 2500;
const ORIGIN = {
  csr: 'https://csr.127.0.0.1.nip.io:18444',
  hybrid: 'https://hybrid.127.0.0.1.nip.io:18444',
  static: 'https://static.127.0.0.1.nip.io:18444',
};
const MARKERS = {
  project_home: '개발 배경',
  erd_document: '전체 ERD',
  general_post: '증상과 재현',
  home_list: '이미지 응답의 간헐적 연결 종료와 동기 스트리밍 전환',
};
const scenarioOrder = ['project_home', 'erd_document', 'general_post', 'home_list', 'in_app_navigation'];
const implementations = ['csr', 'hybrid', 'static'];
const profiles = {
  R: { latency_ms: 38.610, download_bytes_per_sec: 16329500, upload_bytes_per_sec: 16329500,
    note: 'RTT mean and 10 MiB downlink median; upload mirrored because only downlink was calibrated.' },
  M: { latency_ms: 150, download_bytes_per_sec: 200000, upload_bytes_per_sec: 93750,
    note: '150ms, 1.6Mbps down, 750kbps up.' },
};
const scenario = {
  project_home: {
    marker: MARKERS.project_home,
    path: { csr: '/project/?slug=ken-blog', hybrid: '/project/ken-blog/', static: '/ken-blog/post/project-06840552-43a2-4870-83a9-d3e848c71d7e/' },
  },
  erd_document: {
    marker: MARKERS.erd_document,
    path: { csr: '/project/?slug=ken-blog&doc=post-f9235d74-4d5b-4705-8f59-ba3511bd50e9', hybrid: '/project/ken-blog/docs/post-f9235d74-4d5b-4705-8f59-ba3511bd50e9/', static: '/ken-blog/post/post-f9235d74-4d5b-4705-8f59-ba3511bd50e9/' },
  },
  general_post: {
    marker: MARKERS.general_post,
    path: { csr: '/post/?slug=post-f95ad3b1-cfc3-4e4f-8c57-06ddbfd87d9d', hybrid: '/post/?slug=post-f95ad3b1-cfc3-4e4f-8c57-06ddbfd87d9d', static: '/ken-blog/post/post-f95ad3b1-cfc3-4e4f-8c57-06ddbfd87d9d/' },
  },
  home_list: {
    marker: MARKERS.home_list,
    path: { csr: '/', hybrid: '/', static: '/ken-blog/' },
  },
  in_app_navigation: {
    marker: MARKERS.erd_document,
    startPath: { csr: '/project/?slug=ken-blog', hybrid: '/project/ken-blog/', static: '/ken-blog/post/project-06840552-43a2-4870-83a9-d3e848c71d7e/' },
    linkSelector: {
      csr: 'a[href*="doc=post-f9235d74-4d5b-4705-8f59-ba3511bd50e9"]',
      hybrid: 'a[href*="/docs/post-f9235d74-4d5b-4705-8f59-ba3511bd50e9/"]',
      static: 'a[href="/ken-blog/post/post-f9235d74-4d5b-4705-8f59-ba3511bd50e9/"]',
    },
  },
};
const output = 'results-v2/perf-runs.jsonl';
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, '');
const round = n => n == null || !Number.isFinite(n) ? null : Math.round(n * 1000) / 1000;
const badgePath = p => /^\/api\/v1\/stack-badges\/\d+\/image$/.test(p);
const attachmentPath = p => /^\/api\/v1\/posts\/\d+\/attachments\/\d+\/content$/.test(p);
const isServerApi = (p, intercepted) => p.startsWith('/api/') && !intercepted && !badgePath(p) && !attachmentPath(p);
function append(row) { fs.appendFileSync(output, JSON.stringify(row) + '\n'); }
function markerVisible(page, text) {
  return page.waitForFunction(marker => [...document.querySelectorAll('main *')].some(e => {
    const r = e.getBoundingClientRect(), s = getComputedStyle(e);
    return e.children.length === 0 && e.textContent.trim() === marker && r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && s.visibility !== 'hidden' && s.display !== 'none';
  }), text, { timeout: 45000 });
}
function apiStages(items) {
  const sorted = items.filter(x => x.start_ms != null && x.response_ms != null).sort((a,b) => a.start_ms - b.start_ms);
  let stages = 0, stageEnd = -Infinity;
  for (const item of sorted) {
    const response = item.response_ms;
    if (stages === 0 || item.start_ms > stageEnd + 1) {
      stages++;
      stageEnd = response;
    } else {
      stageEnd = Math.max(stageEnd, response);
    }
  }
  return stages;
}
const isApplicationApi = item => {
  const pathname = item.path.split('?')[0];
  return item.api && !badgePath(pathname) && !attachmentPath(pathname);
};
async function createHarness(browser, implementation, profile) {
  const context = await browser.newContext({ ignoreHTTPSErrors: true, serviceWorkers: 'block', viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.__perfLcp = null;
    try {
      const observer = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) window.__perfLcp = entry.startTime;
      });
      observer.observe({ type: 'largest-contentful-paint', buffered: true });
    } catch (_) {}
  });
  let authIntercepts = 0;
  let blockedExternalRequests = 0;
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: false });
  if (implementation === 'static') {
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*://*/api/v1/*' }] });
    cdp.on('Fetch.requestPaused', async event => {
      const url = new URL(event.request.url);
      if (url.pathname === '/api/v1/auth/me') {
        authIntercepts++;
        await cdp.send('Fetch.fulfillRequest', { requestId: event.requestId, responseCode: 401,
          responseHeaders: [{ name: 'Content-Type', value: 'application/json; charset=utf-8' }, { name: 'Cache-Control', value: 'no-store' },
            { name: 'Access-Control-Allow-Origin', value: ORIGIN.static }, { name: 'Access-Control-Allow-Credentials', value: 'true' }, { name: 'Vary', value: 'Origin' }],
          body: Buffer.from('{"authenticated":false}').toString('base64') });
      } else {
        blockedExternalRequests++;
        await cdp.send('Fetch.failRequest', { requestId: event.requestId, errorReason: 'BlockedByClient' });
      }
    });
  }
  await cdp.send('Network.emulateNetworkConditions', { offline: false,
    latency: profiles[profile].latency_ms,
    downloadThroughput: profiles[profile].download_bytes_per_sec,
    uploadThroughput: profiles[profile].upload_bytes_per_sec });
  const requestState = new WeakMap();
  const cdpOpen = new Map();
  let current = null;
  function cancelIdle(state) {
    if (state?.idleTimer) { clearTimeout(state.idleTimer); state.idleTimer = null; }
  }
  function scheduleIdle(state) {
    if (!state || state.network_idle_ms != null || !state.hadRequest || state.active.size !== 0 || state.idleTimer) return;
    state.idleTimer = setTimeout(() => {
      if (state.active.size === 0 && state.network_idle_ms == null) state.network_idle_ms = round(performance.now() - state.startPerf);
      state.idleTimer = null;
    }, 500);
  }
  page.on('request', req => {
    const state = current;
    if (!state) return;
    cancelIdle(state);
    state.hadRequest = true;
    const url = new URL(req.url());
    const intercepted = implementation === 'static' && url.pathname.startsWith('/api/');
    const rec = { method: req.method(), path: url.pathname + url.search, resource_type: req.resourceType(),
      start_ms: round(performance.now() - state.startPerf), response_ms: null, end_ms: null, status: null, failed: null,
      api: url.pathname.startsWith('/api/'), server_api: isServerApi(url.pathname, intercepted), intercepted,
      request_cache_mode: null, cache_control: null, etag: null, last_modified: null, content_encoding: null };
    try { rec.request_cache_mode = req.headers()['cache-control'] || null; } catch (_) {}
    state.requests.push(rec);
    state.active.add(req);
    requestState.set(req, { state, rec });
  });
  page.on('response', resp => {
    const item = requestState.get(resp.request());
    if (!item) return;
    item.rec.status = resp.status();
    item.rec.response_ms = round(performance.now() - item.state.startPerf);
    const headers = resp.headers();
    item.rec.cache_control = headers['cache-control'] || null;
    item.rec.etag = headers.etag || null;
    item.rec.last_modified = headers['last-modified'] || null;
    item.rec.content_encoding = headers['content-encoding'] || null;
  });
  const done = req => {
    const item = requestState.get(req);
    if (!item) return;
    item.rec.end_ms = round(performance.now() - item.state.startPerf);
    item.state.active.delete(req);
    scheduleIdle(item.state);
  };
  page.on('requestfinished', done);
  page.on('requestfailed', req => {
    const item = requestState.get(req);
    if (item) item.rec.failed = req.failure()?.errorText || 'request_failed';
    done(req);
  });
  cdp.on('Network.requestWillBeSent', event => {
    const state = current;
    if (!state) return;
    const rec = { url: event.request.url, type: event.type, start_ms: round(performance.now() - state.startPerf), end_ms: null,
      encoded_bytes: 0, status: null, failed: null, from_disk_cache: false, served_from_cache: false, from_prefetch_cache: false };
    state.cdpRequests.push(rec);
    cdpOpen.set(event.requestId, { state, rec });
  });
  cdp.on('Network.requestServedFromCache', event => {
    const item = cdpOpen.get(event.requestId);
    if (item) item.rec.served_from_cache = true;
  });
  cdp.on('Network.responseReceived', event => {
    const item = cdpOpen.get(event.requestId);
    if (!item) return;
    item.rec.status = event.response.status;
    item.rec.from_disk_cache = !!event.response.fromDiskCache;
    item.rec.from_prefetch_cache = !!event.response.fromPrefetchCache;
  });
  cdp.on('Network.loadingFinished', event => {
    const item = cdpOpen.get(event.requestId);
    if (!item) return;
    item.rec.end_ms = round(performance.now() - item.state.startPerf);
    item.rec.encoded_bytes += event.encodedDataLength || 0;
    cdpOpen.delete(event.requestId);
  });
  cdp.on('Network.loadingFailed', event => {
    const item = cdpOpen.get(event.requestId);
    if (!item) return;
    item.rec.end_ms = round(performance.now() - item.state.startPerf);
    item.rec.failed = event.errorText;
    cdpOpen.delete(event.requestId);
  });
  return {
    implementation, profile, context, page,
    authCount: () => authIntercepts,
    blockedExternalCount: () => blockedExternalRequests,
    setCurrent(state) { cancelIdle(current); current = state; },
    close: async () => { cancelIdle(current); await context.close(); await cdp.detach().catch(() => {}); },
  };
}
function newState() { return { startPerf: performance.now(), requests: [], cdpRequests: [], active: new Set(), hadRequest: false,
  idleTimer: null, network_idle_ms: null }; }
async function visit(harness, scenarioKey, profile, cache, iteration, discarded) {
  const impl = harness.implementation;
  const conf = scenario[scenarioKey];
  let authBefore = harness.authCount();
  let blockedBefore = harness.blockedExternalCount();
  let state = newState();
  let response = null, navError = null, visibleMs = null, clickMs = null;
  let loadTimedOut = false, finalPath = null, headings = [], title = null;
  harness.setCurrent(state);
  try {
    if (scenarioKey === 'in_app_navigation') {
      response = await harness.page.goto(ORIGIN[impl] + conf.startPath[impl], { waitUntil: 'domcontentloaded', timeout: 90000 });
      await markerVisible(harness.page, MARKERS.project_home);
      const link = harness.page.locator(conf.linkSelector[impl]).first();
      await link.waitFor({ state: 'visible', timeout: 45000 });
      authBefore = harness.authCount();
      blockedBefore = harness.blockedExternalCount();
      state = newState();
      harness.setCurrent(state);
      const clickStart = performance.now();
      await link.click({ timeout: 45000 });
      await markerVisible(harness.page, conf.marker);
      clickMs = round(performance.now() - clickStart);
    } else {
      response = await harness.page.goto(ORIGIN[impl] + conf.path[impl], { waitUntil: 'domcontentloaded', timeout: 90000 });
      await markerVisible(harness.page, conf.marker);
      visibleMs = round(performance.now() - state.startPerf);
    }
    try { await harness.page.waitForLoadState('load', { timeout: 90000 }); }
    catch (_) { loadTimedOut = true; }
  } catch (e) {
    navError = String(e.message || e).slice(0, 500);
  }
  const measurementState = state;
  const idleDeadline = performance.now() + IDLE_CAP_MS;
  while (measurementState.network_idle_ms == null && performance.now() < idleDeadline) {
    await harness.page.waitForTimeout(25);
    scheduleIdle(measurementState);
  }
  const pageData = await harness.page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    return { title: document.title, path: location.pathname + location.search,
      lcp: window.__perfLcp, ttfb: nav?.responseStart ?? null, dcl: nav?.domContentLoadedEventEnd ?? null,
      load: nav?.loadEventEnd ?? null, headings: [...document.querySelectorAll('main h1,main h2')].slice(0, 8).map(e => e.textContent.trim()) };
  }).catch(() => ({ title: null, path: null, lcp: null, ttfb: null, dcl: null, load: null, headings: [] }));
  finalPath = pageData.path;
  title = pageData.title;
  headings = pageData.headings;
  const api = measurementState.requests.filter(r => r.api);
  const serverApi = api.filter(r => r.server_api);
  const appApi = api.filter(isApplicationApi);
  const responseStageCount = apiStages(appApi);
  const cacheRows = measurementState.cdpRequests;
  const row = {
    utc_started: new Date().toISOString(), scenario: scenarioKey, implementation: impl, profile, cache, iteration, discarded,
    requested_path: scenarioKey === 'in_app_navigation' ? conf.startPath[impl] : conf.path[impl], final_path: finalPath,
    navigation_status: response?.status() ?? null, navigation_error: navError, load_wait_timed_out: loadTimedOut,
    content_visible_ms: visibleMs, click_to_content_ms: clickMs,
    lcp_ms: scenarioKey === 'in_app_navigation' ? null : round(pageData.lcp),
    ttfb_ms: scenarioKey === 'in_app_navigation' ? null : round(pageData.ttfb),
    dcl_ms: scenarioKey === 'in_app_navigation' ? null : round(pageData.dcl),
    load_ms: scenarioKey === 'in_app_navigation' ? null : round(pageData.load),
    network_idle_ms: measurementState.network_idle_ms,
    network_idle_wait_cap_ms: measurementState.network_idle_ms == null ? IDLE_CAP_MS : null,
    request_count: measurementState.requests.length, api_request_count: api.length,
    api_server_request_count: serverApi.length, auth_intercepts: harness.authCount() - authBefore,
    api_response_missing_count: appApi.filter(r => r.response_ms == null).length,
    blocked_external_requests: harness.blockedExternalCount() - blockedBefore,
    api_serial_steps_response_based: responseStageCount,
    click_api_requests: scenarioKey === 'in_app_navigation' ? api : null,
    click_api_request_count: scenarioKey === 'in_app_navigation' ? api.length : null,
    click_api_server_request_count: scenarioKey === 'in_app_navigation' ? serverApi.length : null,
    click_api_serial_steps_response_based: scenarioKey === 'in_app_navigation' ? responseStageCount : null,
    encoded_bytes: cacheRows.reduce((n,r) => n + (r.encoded_bytes || 0), 0),
    cache_hits: cacheRows.filter(r => r.from_disk_cache || r.served_from_cache || r.from_prefetch_cache || r.status === 304).length,
    cdp_304_count: cacheRows.filter(r => r.status === 304).length,
    cdp_disk_cache_count: cacheRows.filter(r => r.from_disk_cache).length,
    cdp_served_cache_count: cacheRows.filter(r => r.served_from_cache).length,
    cdp_prefetch_cache_count: cacheRows.filter(r => r.from_prefetch_cache).length,
    requests: measurementState.requests,
    cdp_requests: cacheRows,
    title, headings,
    elapsed_ms: round(performance.now() - measurementState.startPerf),
  };
  append(row);
  return row;
}
function scheduleIdle(state) {
  if (!state || state.network_idle_ms != null || !state.hadRequest || state.active.size !== 0 || state.idleTimer) return;
  state.idleTimer = setTimeout(() => {
    if (state.active.size === 0 && state.network_idle_ms == null) state.network_idle_ms = round(performance.now() - state.startPerf);
    state.idleTimer = null;
  }, 500);
}
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  let done = 0;
  const expected = scenarioOrder.length * implementations.length * 2 * 2 * TOTAL;
  for (const scenarioKey of scenarioOrder) {
    for (const profile of Object.keys(profiles)) {
      for (const cache of ['cold','warm']) {
        const warmHarnesses = {};
        if (cache === 'warm') {
          for (const impl of implementations) warmHarnesses[impl] = await createHarness(browser, impl, profile);
        }
        const orderFor = n => n % 2 === 0 ? implementations : [...implementations].reverse();
        for (let w=0; w<WARMUPS; w++) {
          for (const impl of orderFor(w)) {
            const harness = cache === 'warm' ? warmHarnesses[impl] : await createHarness(browser, impl, profile);
            const row = await visit(harness, scenarioKey, profile, cache, w+1, true);
            if (cache === 'cold') await harness.close();
            console.log(`warmup ${scenarioKey} ${profile}/${cache}/${impl}: ${scenarioKey==='in_app_navigation' ? row.click_to_content_ms : row.content_visible_ms}ms`);
          }
        }
        for (let i=1; i<=TOTAL; i++) {
          for (const impl of orderFor(i)) {
            const harness = cache === 'warm' ? warmHarnesses[impl] : await createHarness(browser, impl, profile);
            const row = await visit(harness, scenarioKey, profile, cache, i, false);
            if (cache === 'cold') await harness.close();
            done++;
            const timing = scenarioKey === 'in_app_navigation' ? row.click_to_content_ms : row.content_visible_ms;
            console.log(`measured ${done}/${expected} ${scenarioKey} ${profile}/${cache}/${impl} ${timing ?? 'FAIL'}ms api=${row.api_request_count} cache=${row.cache_hits}`);
          }
        }
        if (cache === 'warm') for (const harness of Object.values(warmHarnesses)) await harness.close();
      }
    }
  }
  await browser.close();
})().catch(e => { console.error(e.stack || e); process.exitCode = 1; });
