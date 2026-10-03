import assert from 'node:assert/strict';
import { test } from 'node:test';
import { prepareMarkdown, renderMarkdown, renderPreparedMarkdown } from '../../build/.site-markdown.mjs';
import { imageSize } from './image-size.mjs';

// 준비 단계에서 첨부를 수집하고 동일 AST를 주소 적용·재렌더에 재사용하는 계약 검증
test('prepared Markdown shares parsing without losing mixed syntax or image references', async () => {
  const source = '## 제목\n\n$x$ [[대상]] [* 주석 $y$]\n\n![설명|dark=2|w=50|a=center](attachment:1)\n\n' +
    '<details>\n<summary>접기</summary>\n\n## 내부\n\n![참조][ref]\n\n</details>\n\n[ref]: attachment:3\n\n' +
    '```text\n![가짜](attachment:999) [[가짜]]\n```';
  const prepared = prepareMarkdown(source);
  assert.deepEqual(prepared.attachmentIds, [1, 2, 3]);
  const options = { attachmentUrl: id => `/ken-blog/assets/${id}.png`, attachmentSize: id => ({ width: id * 10, height: 20 }), wikiUrl: () => '/ken-blog/post/target/' };
  const first = await renderPreparedMarkdown(prepared, options);
  assert.deepEqual(first, await renderPreparedMarkdown(prepared, options));
  assert.deepEqual(first, await renderMarkdown(source, options));
  assert.match(first.html, /<details>/);
  assert.match(first.html, /width="10" height="20"/);
  assert.match(first.html, /data-dark-width="20"/);
  assert.match(first.html, /class="katex"/);
  assert.deepEqual(first.wikiTargets, ['대상']);
  assert.equal(first.headings.length, 2);
});

// 줄바꿈 형식이 달라도 수식·접기 뒤의 제목 위치·ID가 유지되는지 검증
test('LF, CRLF and CR produce identical headings and HTML', async () => {
  const source = '## A\n\n$x$\n\n## B\n\n$y$\n\n<details>\n<summary>More</summary>\n\n## C\n\n</details>';
  const lf = await renderMarkdown(source);
  for (const newline of ['\r\n', '\r']) assert.deepEqual(await renderMarkdown(source.replaceAll('\n', newline)), lf);
  assert.equal(new Set(lf.headings.map(heading => heading.id)).size, 3);
});

// 외부 이미지·스크립트·위험 링크 차단이 파싱 재사용 후에도 유지되는지 검증
test('rendering keeps HTML and image URL trust boundaries', async () => {
  const rendered = await renderMarkdown('<script>alert(1)</script>\n\n[x](javascript:alert) ![x](https://evil.invalid/a.png)\n\n![x](attachment:1)', { attachmentUrl: () => 'javascript:alert(1)' });
  assert.doesNotMatch(rendered.html, /<script|<img|href="javascript|onerror=/);
  assert.deepEqual(rendered.attachmentIds, [1]);
});

// PNG 크기와 JPEG SOF 크기·손상 헤더 거부 검증
test('image headers reserve the intrinsic size and reject truncated dimensions', () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
  assert.deepEqual(imageSize(png, 'image/png'), { width: 1, height: 1 });
  const jpeg = Buffer.from([255, 216, 255, 192, 0, 11, 8, 0, 20, 0, 40, 1, 1, 0x11, 0, 255, 217]);
  assert.deepEqual(imageSize(jpeg, 'image/jpeg'), { width: 40, height: 20 });
  assert.throws(() => imageSize(png.subarray(0, 20), 'image/png'));
  assert.throws(() => imageSize(jpeg.subarray(0, 8), 'image/jpeg'));
});
