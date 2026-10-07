const { chromium } = require('/home/ubuntu/Develop/project/ken-blog/node_modules/playwright');
const fs = require('node:fs');

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ ignoreHTTPSErrors: true, serviceWorkers: 'block' });
  const page = await context.newPage();
  let auth401 = 0, otherApiBlocked = 0;
  const apiResponses = [], apiFailures = [];
  page.on('response', response => {
    const url = new URL(response.url());
    if (url.pathname.startsWith('/api/v1/')) apiResponses.push({ path: url.pathname, status: response.status() });
  });
  page.on('requestfailed', request => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/api/v1/')) apiFailures.push({ path: url.pathname, error: request.failure()?.errorText || 'failed' });
  });
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: false });
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*://*/api/v1/*' }] });
  cdp.on('Fetch.requestPaused', async e => {
    const url = new URL(e.request.url);
    if (url.pathname === '/api/v1/auth/me') {
      auth401++;
      await cdp.send('Fetch.fulfillRequest', { requestId: e.requestId, responseCode: 401,
        responseHeaders: [{ name: 'Content-Type', value: 'application/json; charset=utf-8' }, { name: 'Cache-Control', value: 'no-store' },
          { name: 'Access-Control-Allow-Origin', value: 'https://static.127.0.0.1.nip.io:18444' }, { name: 'Access-Control-Allow-Credentials', value: 'true' }, { name: 'Vary', value: 'Origin' }],
        body: Buffer.from('{"authenticated":false}').toString('base64') });
    } else {
      otherApiBlocked++;
      await cdp.send('Fetch.failRequest', { requestId: e.requestId, errorReason: 'BlockedByClient' });
    }
  });
  let current = null;
  const open = new Map();
  cdp.on('Network.requestWillBeSent', e => {
    if (!current) return;
    const row = { url: new URL(e.request.url).pathname, encoded_bytes: 0, status: null, disk: false, cache: false };
    current.push(row);
    open.set(e.requestId, row);
  });
  cdp.on('Network.requestServedFromCache', e => { const r = open.get(e.requestId); if (r) r.cache = true; });
  cdp.on('Network.responseReceived', e => {
    const r = open.get(e.requestId); if (r) { r.status = e.response.status; r.disk = !!e.response.fromDiskCache; }
  });
  cdp.on('Network.loadingFinished', e => {
    const r = open.get(e.requestId); if (r) { r.encoded_bytes += e.encodedDataLength || 0; open.delete(e.requestId); }
  });
  const rows = [];
  const url = 'https://static.127.0.0.1.nip.io:18444/ken-blog/post/post-f9235d74-4d5b-4705-8f59-ba3511bd50e9/';
  for (let iteration = 1; iteration <= 2; iteration++) {
    current = [];
    const response = await page.goto(url, { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction(() => document.body.innerText.includes('전체 ERD'));
    await page.waitForTimeout(300);
    const resources = current.filter(r => r.url.startsWith('/ken-blog/'));
    rows.push({ iteration, status: response.status(), resources: resources.length,
      bytes: resources.reduce((n, r) => n + r.encoded_bytes, 0), cache_hits: resources.filter(r => r.cache || r.disk || r.status === 304).length,
      disk_hits: resources.filter(r => r.disk).length, cdp_304: resources.filter(r => r.status === 304).length });
  }
  fs.writeFileSync('results-v2/cache-smoke.json', JSON.stringify({ rows, auth401, otherApiBlocked, apiResponses, apiFailures }, null, 2) + '\n');
  console.log(JSON.stringify({ rows, auth401, otherApiBlocked, apiResponses, apiFailures }));
  await cdp.detach(); await context.close(); await browser.close();
})().catch(e => { console.error(e.stack || e); process.exitCode = 1; });
