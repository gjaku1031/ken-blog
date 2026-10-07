import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { generateSite } from '../../src/main/resources/web/site/generate.ts';
import { normalizeSnapshot } from './capture.mjs';
import { fixture } from './fixture.mjs';

/**
 * 외부 API·서비스 계정 없이 공개 템플릿을 검사할 입력
 */
function input(gaMeasurementId) {
  const snapshot = normalizeSnapshot(fixture, true);
  snapshot.posts.forEach(post => { post.rendered = { html: '<p>공개 본문</p>', headings: [], wikiTargets: [] }; });
  return { snapshot, gaMeasurementId, assets: { css: 'public.css', js: 'public.js' }, adminHref: '/ken-blog/manage/',
    admin: { apiBase: '', css: 'admin.css', js: 'admin.js' } };
}

// 공개 페이지에만 태그를 생성하고 운영 출처에서 기본 page_view 명령을 한 번만 구성
test('GA4 runs only on public production pages and never sends duplicate page views', async () => {
  const output = await mkdtemp(join(tmpdir(), 'ken-ga4-'));
  try {
    await generateSite(input(' G-TEST123456 '), output);
    for (const path of ['posts/index.html', 'projects/index.html', 'search/index.html', 'post/fixture-1/index.html']) {
      const html = await readFile(join(output, path), 'utf8');
      assert.equal((html.match(/googletagmanager\.com\/gtag\/js/g) ?? []).length, 1, path);
      assert.doesNotMatch(html, /private_key|GA4_SERVICE_ACCOUNT_JSON_BASE64|client_email/);
    }
    for (const path of ['index.html', 'manage/index.html', 'posts/new/index.html', 'projects/new/index.html', 'post/index.html']) {
      const html = await readFile(join(output, path), 'utf8');
      assert.doesNotMatch(html, /googletagmanager|window\.gtag|G-TEST123456/, path);
    }
    const html = await readFile(join(output, 'posts/index.html'), 'utf8');
    const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].find(([, body]) => body.includes('window.gtag'))?.[1];
    assert.ok(script);
    for (const origin of ['https://gjaku1031.github.io', 'http://localhost:4173', 'https://preview.example.com']) {
      const requests = [];
      const window = { location: { origin } };
      const document = { createElement: () => ({}), head: { appendChild: tag => requests.push(tag) } };
      runInNewContext(script, { window, document });
      if (origin === 'https://gjaku1031.github.io') {
        assert.equal(requests.length, 1);
        assert.equal(requests[0].async, true);
        assert.equal(requests[0].src, 'https://www.googletagmanager.com/gtag/js?id=G-TEST123456');
        assert.equal(window.dataLayer.length, 2);
        assert.equal(window.dataLayer[0][0], 'js');
        assert.deepEqual(Array.from(window.dataLayer[1]), ['config', 'G-TEST123456']);
      } else {
        assert.deepEqual(requests, []);
        assert.equal(window.dataLayer, undefined);
        assert.equal(window.gtag, undefined);
      }
    }
  } finally { await rm(output, { recursive: true, force: true }); }
});

// 미설정 시 외부 추적 코드 생략, 속성 ID·스크립트 삽입 입력은 파일 생성 전에 거부
test('GA4 is optional and rejects malformed measurement IDs before writing pages', async () => {
  const output = await mkdtemp(join(tmpdir(), 'ken-ga4-input-'));
  try {
    for (const value of ['123456789', 'G-', 'G-ID\"/><script>alert(1)</script>', 'G-ID\nINJECTED']) {
      await assert.rejects(generateSite(input(value), output), /GA_MEASUREMENT_ID/);
      assert.deepEqual(await readdir(output), []);
    }
    for (const value of [undefined, '']) {
      await generateSite(input(value), output);
      assert.doesNotMatch(await readFile(join(output, 'posts/index.html'), 'utf8'), /googletagmanager|window\.gtag/);
    }
  } finally { await rm(output, { recursive: true, force: true }); }
});
