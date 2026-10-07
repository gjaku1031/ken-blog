const { chromium } = require('/home/ubuntu/Develop/project/ken-blog/node_modules/playwright');
const fs = require('node:fs');

const origins = {
  csr: 'https://csr.127.0.0.1.nip.io:18444',
  hybrid: 'https://hybrid.127.0.0.1.nip.io:18444',
  static: 'https://static.127.0.0.1.nip.io:18444',
};
const marker = { project_home: '개발 배경', erd_document: '전체 ERD', general_post: '증상과 재현', home_list: '이미지 응답의 간헐적 연결 종료와 동기 스트리밍 전환' };
const scenarios = {
  project_home: {
    path: { csr: '/project/?slug=ken-blog', hybrid: '/project/ken-blog/', static: '/ken-blog/post/project-06840552-43a2-4870-83a9-d3e848c71d7e/' },
  },
  erd_document: {
    path: { csr: '/project/?slug=ken-blog&doc=post-f9235d74-4d5b-4705-8f59-ba3511bd50e9', hybrid: '/project/ken-blog/docs/post-f9235d74-4d5b-4705-8f59-ba3511bd50e9/', static: '/ken-blog/post/post-f9235d74-4d5b-4705-8f59-ba3511bd50e9/' },
  },
  general_post: {
    path: { csr: '/post/?slug=post-f95ad3b1-cfc3-4e4f-8c57-06ddbfd87d9d', hybrid: '/post/?slug=post-f95ad3b1-cfc3-4e4f-8c57-06ddbfd87d9d', static: '/ken-blog/post/post-f95ad3b1-cfc3-4e4f-8c57-06ddbfd87d9d/' },
  },
  home_list: { path: { csr: '/', hybrid: '/', static: '/ken-blog/' } },
};
const selectors = {
  csr: 'a[href*="doc=post-f9235d74-4d5b-4705-8f59-ba3511bd50e9"]',
  hybrid: 'a[href*="/docs/post-f9235d74-4d5b-4705-8f59-ba3511bd50e9/"]',
  static: 'a[href="/ken-blog/post/post-f9235d74-4d5b-4705-8f59-ba3511bd50e9/"]',
};
async function visible(page, text) {
  await page.waitForFunction(value => [...document.querySelectorAll('main *')].some(el => {
    const r = el.getBoundingClientRect(), style = getComputedStyle(el);
    return el.children.length === 0 && el.textContent.trim() === value && r.width > 0 && r.height > 0 && r.top < innerHeight && r.bottom > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  }), text, { timeout: 30000 });
}

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const rows = [];
  for (const implementation of Object.keys(origins)) {
    const context = await browser.newContext({ ignoreHTTPSErrors: true, serviceWorkers: 'block', viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    if (implementation === 'static') {
      const allowedHost = new URL(origins.static).hostname;
      page.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.hostname === allowedHost) return route.continue();
        if (url.pathname === '/api/v1/auth/me') return route.fulfill({ status: 401, contentType: 'application/json', body: '{"authenticated":false}' });
        return route.abort();
      });
    }
    for (const [name, conf] of Object.entries(scenarios)) {
      const response = await page.goto(origins[implementation] + conf.path[implementation], { waitUntil: 'domcontentloaded', timeout: 90000 });
      console.log(`checking ${implementation} ${name} HTTP ${response.status()}`);
      await visible(page, marker[name]);
      rows.push({ implementation, scenario: name, status: response.status(), marker: marker[name], visible: true, url: page.url() });
    }
    const sourcePath = {
      csr: '/project/?slug=ken-blog',
      hybrid: '/project/ken-blog/',
      static: '/ken-blog/post/project-06840552-43a2-4870-83a9-d3e848c71d7e/',
    }[implementation];
    await page.goto(origins[implementation] + sourcePath, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await visible(page, marker.project_home);
    const link = page.locator(selectors[implementation]).first();
    await link.waitFor({ state: 'visible', timeout: 30000 });
    const href = await link.getAttribute('href');
    await link.click({ timeout: 30000 });
    await visible(page, marker.erd_document);
    rows.push({ implementation, scenario: 'in_app_navigation', status: 200, marker: marker.erd_document, visible: true, href, url: page.url() });
    await context.close();
  }
  await browser.close();
  fs.writeFileSync('results-v2/page-verification.json', JSON.stringify(rows, null, 2) + '\n');
  for (const r of rows) console.log(`${r.implementation} ${r.scenario}: ${r.status} ${r.visible} marker=${JSON.stringify(r.marker)}${r.href ? ` href=${r.href}` : ''}`);
})().catch(e => { console.error(e.stack || e); process.exitCode = 1; });
