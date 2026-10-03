import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateSite } from '../../src/main/resources/web/site/generate.ts';
import { normalizeSnapshot } from './capture.mjs';
import { fixture } from './fixture.mjs';

// 공개 분류 외의 이름이 산출물에 섞이지 않는 입력 계약 검증
test('snapshot preserves category order and rejects non-public category paths', () => {
  assert.deepEqual(normalizeSnapshot(fixture, true).categories, fixture.categories);
  assert.equal(normalizeSnapshot(fixture, true).posts[0].category.sortOrder, 2);
  assert.throws(() => normalizeSnapshot({ ...fixture, categories: [...fixture.categories, { ...fixture.categories[0], path: 'private' }] }, true));
});

// 실제 템플릿으로 유효 공개 분류·태그·본문과 이전 경로 산출 검증
test('representative site keeps public names, tags and canonical routes', async () => {
  const output = await mkdtemp(join(tmpdir(), 'ken-site-test-'));
  try {
    const snapshot = normalizeSnapshot(fixture, true);
    snapshot.posts.forEach(post => { post.rendered = { html: '<p>본문 검색어</p>', headings: [], wikiTargets: [] }; });
    await generateSite({ snapshot, assets: { css: 'public.css', js: 'public.js' }, adminHref: '/ken-blog/manage/',
      admin: { apiBase: '', css: 'admin.css', js: 'admin.js' } }, output);
    const html = await readFile(join(output, 'posts/index.html'), 'utf8');
    assert.ok(html.indexOf('data-category-link="z-first"') < html.indexOf('data-category-link="a-last"'));
    assert.match(html, /Child Name/);
    assert.match(html, /data-tags="\[&quot;A\|B&quot;\]"/);
    const redirect = await readFile(join(output, 'post/index.html'), 'utf8');
    assert.match(redirect, /fixture-1/);
    assert.doesNotMatch(redirect, /private/);
    // 소속 문서 탐색 뒤에 관련된 공개 글만 최신순으로 배치
    const project = await readFile(join(output, 'post/project-intro/index.html'), 'utf8');
    const related = project.match(/<nav class="series-nav related-posts-nav"[\s\S]*?<\/nav>/)[0];
    assert.equal((related.match(/<li>/g) ?? []).length, 5);
    assert.ok(related.indexOf('fixture-5/') < related.indexOf('fixture-1/'));
    assert.doesNotMatch(related, /project-intro|fixture-6/);
    const ordinary = await readFile(join(output, 'post/fixture-1/index.html'), 'utf8');
    assert.doesNotMatch(ordinary, /related-posts-nav/);
  } finally { await rm(output, { recursive: true, force: true }); }
});

/**
 * sRGB 색상의 상대 휘도 계산
 */
function luminance(hex) {
  const values = hex.replace('#', '').match(/.{2}/g).map(value => parseInt(value, 16) / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
}

// 두 테마의 작은 보조 글자가 기본·카드·입력 배경에서 4.5:1 이상인지 검증
test('muted text meets normal-text contrast in both themes', async () => {
  const source = await readFile('src/main/resources/web/shared/theme.css', 'utf8');
  for (const block of source.matchAll(/:root[^{}]*\{([^}]+)\}/g)) {
    const colors = Object.fromEntries([...block[1].matchAll(/--([\w-]+):\s*(#[a-f0-9]{3,6})/g)].map(([, name, value]) => [name, value.length === 4 ? '#' + [...value.slice(1)].map(c => c + c).join('') : value]));
    for (const text of ['muted', 'muted2']) for (const background of ['bg', 'card', 'soft']) {
      const values = [luminance(colors[text]), luminance(colors[background])].sort((a, b) => b - a);
      assert.ok((values[0] + 0.05) / (values[1] + 0.05) >= 4.5, `${text}/${background}`);
    }
  }
});

// 대소문자 별칭이 같은 대표 글을 가리켜도 출처 글은 역링크에 한 번만 표시
test('wiki aliases produce one backlink per source document', async () => {
  const output = await mkdtemp(join(tmpdir(), 'ken-backlink-'));
  try {
    const snapshot = normalizeSnapshot(fixture, true);
    snapshot.posts.forEach(post => { post.rendered = { html: '', headings: [], wikiTargets: [] }; });
    snapshot.posts[1].title = 'Target';
    snapshot.posts[0].rendered.wikiTargets = ['Target', 'target', 'TARGET'];
    snapshot.posts[2].rendered.wikiTargets = ['target'];
    await generateSite({ snapshot, assets: { css: 'public.css', js: 'public.js' }, adminHref: '/ken-blog/manage/',
      admin: { apiBase: '', css: 'admin.css', js: 'admin.js' } }, output);
    const html = await readFile(join(output, 'post/fixture-2/index.html'), 'utf8');
    const backlinks = html.match(/<[^>]+class="post-backlinks[\s\S]*?<\/section>/)?.[0] ?? '';
    assert.equal((backlinks.match(/href="\/ken-blog\/post\/fixture-1\/"/g) ?? []).length, 1);
    assert.equal((backlinks.match(/href="\/ken-blog\/post\/fixture-3\/"/g) ?? []).length, 1);
  } finally { await rm(output, { recursive: true, force: true }); }
});
