import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildWebAssets } from '../../src/main/resources/web/build.mjs';

/**
 * 격리된 CLI 프로세스 실행기
 */
const run = promisify(execFile);

/**
 * 실제 공개 이미지 바이트
 */
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');

// fixture 우회 없이 API·원고·이미지·최종 revision을 거쳐 산출물을 교체하는 전체 계약 검사
test('real capture pipeline validates every owner and preserves the previous artifact on failure', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'ken-pipeline-'));
  const content = join(dir, 'content'), output = join(dir, 'site');
  await mkdir(content);
  let mode = 'valid', calls = [], snapshots = 0;
  const posts = [1, 2].map(id => ({ id, title: `Post ${id}`, slug: `post-${id}`, summary: '', section: 'TECH',
    publishedAt: '2026-01-01T00:00:00', publishedDate: '2026-01-01', category: null, tags: [], series: null, relatedSeries: null }));
  const server = createServer((request, response) => {
    calls.push(request.url);
    if (request.url === '/api/v1/pages/snapshot') {
      snapshots++;
      if (mode === 'snapshot-redirect') { response.writeHead(302, { location: '/elsewhere' }).end(); return; }
      if (mode === 'snapshot-large') { response.writeHead(200, { 'content-type': 'application/json', 'content-length': '8000001' }).end('{}'); return; }
      const revision = (mode === 'changed' && snapshots > 1 ? 'b' : 'a').repeat(64);
      response.writeHead(200, { 'content-type': mode === 'snapshot-mime' ? 'text/html' : 'application/json' });
      response.end(JSON.stringify({ version: 3, revision, posts: mode === 'empty' ? [] : mode === 'reverse-denied' ? [...posts].reverse() : posts, series: [], categories: [], navigation: {} }));
    } else if (/^\/api\/v1\/posts\/[12]\/attachments\/1\/content$/.test(request.url)) {
      if (mode.endsWith('denied') && request.url.includes('/posts/2/')) { response.writeHead(404).end(); return; }
      if (mode === 'image-redirect') { response.writeHead(302, { location: '/elsewhere' }).end(); return; }
      response.writeHead(200, { 'content-type': mode === 'image-mime' ? 'image/svg+xml' : 'image/png' });
      response.end(mode === 'image-magic' ? Buffer.alloc(32) : png);
    } else response.writeHead(404).end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const env = { ...process.env, PUBLIC_API_BASE_URL: `http://127.0.0.1:${server.address().port}`, GA_MEASUREMENT_ID: 'G-TEST123456' };

  /**
   * 테스트마다 요청 기록을 초기화하고 운영 빌드 경로 실행
   */
  const build = async () => {
    calls = []; snapshots = 0;
    return run(process.execPath, ['.github/pages/build.mjs', `--content-dir=${content}`, `--output-dir=${output}`], { env, timeout: 45000 });
  };
  try {
    for (const id of [1, 2]) await writeFile(join(content, `post-${id}.md`), '![shared](attachment:1)');
    await build();
    assert.match(await readFile(join(output, 'posts/index.html'), 'utf8'), /gtag\/js\?id=G-TEST123456/);
    assert.ok(calls.includes('/api/v1/posts/1/attachments/1/content'));
    assert.ok(calls.includes('/api/v1/posts/2/attachments/1/content'));
    assert.equal((await readdir(join(output, 'assets'))).filter(name => name.startsWith('attachment-1-')).length, 1);
    assert.ok((await readFile(join(output, 'post/post-1/index.html'), 'utf8')).includes('attachment-1-'));
    const previous = await readFile(join(output, 'deployment.json'), 'utf8');
    for (const failure of ['denied', 'reverse-denied', 'changed', 'snapshot-redirect', 'snapshot-mime', 'snapshot-large', 'image-redirect', 'image-mime', 'image-magic']) {
      await t.test(failure, async () => {
        mode = failure;
        await assert.rejects(build());
        assert.equal(await readFile(join(output, 'deployment.json'), 'utf8'), previous);
      });
    }
    mode = 'valid';
    await rm(join(content, 'post-2.md'));
    await assert.rejects(build());
    await symlink(join(content, 'post-1.md'), join(content, 'post-2.md'));
    await assert.rejects(build());
    assert.equal(await readFile(join(output, 'deployment.json'), 'utf8'), previous);
    mode = 'empty'; await build();
    await assert.rejects(readFile(join(output, 'post/post-1/index.html')));
    assert.deepEqual(JSON.parse(await readFile(join(output, 'deployment.json'))).posts, {});
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(dir, { recursive: true, force: true }); }
});

// 손상된 캐시 파일이 입력 키만 같다는 이유로 재사용되지 않는지 검증
test('corrupt browser asset cache is rebuilt from the source', async () => {
  const entries = await buildWebAssets();
  const file = join('build/public-assets', entries.public.js);
  const original = await readFile(file);
  await writeFile(file, 'corrupt');
  await buildWebAssets();
  assert.deepEqual(await readFile(file), original);
});
