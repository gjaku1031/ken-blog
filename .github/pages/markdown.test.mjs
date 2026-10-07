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

// 캡션이 지정된 Mermaid를 이미지 figure와 같은 캡션 요소로 감쌈
test('Mermaid captions follow the diagram and keep source controls inside the block', async () => {
  const rendered = await renderMarkdown('```mermaid caption="요청, 저장·응답."\nflowchart LR\nA-->B\n```');
  assert.match(rendered.html, /^<figure class="mermaid-figure"><div class="ken-mermaid"/);
  assert.match(rendered.html, /<\/div><figcaption>요청, 저장·응답\.<\/figcaption><\/figure>$/);
  assert.match(rendered.html, /class="mermaid-source-toggle">원문 보기<\/button>/);
  assert.match(rendered.html, /class="mermaid-source">flowchart LR/);
  assert.match(rendered.html, /class="mermaid-diagram"><\/div>/);
});

// caption 메타를 생략하면 기존 Mermaid HTML을 그대로 유지
test('Mermaid without a caption preserves the existing HTML', async () => {
  const rendered = await renderMarkdown('```mermaid\nflowchart LR\nA-->B\n```');
  assert.equal(rendered.html, '<div class="ken-mermaid" data-mermaid-source="flowchart LR\nA-->B\n"><button type="button" class="mermaid-source-toggle">원문 보기</button><pre class="mermaid-source">flowchart LR\nA-->B\n</pre><div class="mermaid-diagram"></div></div>');
});

// HTML 문자가 든 캡션도 텍스트로 출력하여 태그 주입을 차단
test('Mermaid caption HTML characters are escaped as text', async () => {
  const rendered = await renderMarkdown('```mermaid caption="<img src=x onerror=alert(1)> & 안전"\nflowchart LR\nA-->B\n```');
  assert.match(rendered.html, /<figcaption>&#x3C;img src=x onerror=alert\(1\)> &#x26; 안전<\/figcaption>/);
  assert.doesNotMatch(rendered.html, /<img src=x/);
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

// 치환 메타문자를 포함한 TeX가 HTML과 내부 마커를 재삽입하지 않는지 검증
test('math replacement is literal, deterministic and bounded', async () => {
  const samples = [String.raw`$\text{\$\&}$`, String.raw`$\text{\$\$}$`, "$\\text{\\$`}$", "$\\text{\\$'}$"];
  for (const sample of samples) {
    const one = await renderMarkdown(sample);
    const prepared = prepareMarkdown(Array(16).fill(sample).join('\n\n'));
    const many = await renderPreparedMarkdown(prepared);
    assert.deepEqual(many, await renderPreparedMarkdown(prepared));
    assert.doesNotMatch(many.html, /KENBLOG(?:MATH|INSERT|RENDER)/);
    assert.ok(many.html.length <= one.html.length * 17);
  }
});

// 수식 시작 달러가 코드·이미지·주소의 달러를 닫는 구분자로 소비하지 않는지 검증
test('math cannot cross protected Markdown boundaries', async () => {
  for (const source of ['가격 $5와 `$HOME`', '가격 $5와 [링크](https://example.org/$path)', '가격 $5와 ![$alt](attachment:1)', '$x <span>$y</span>', '$$\n```text\n$$\n```']) {
    const rendered = await renderMarkdown(source, { attachmentUrl: () => '/ken-blog/assets/1.png' });
    assert.doesNotMatch(rendered.html, /class="katex"/);
  }
  const link = await renderMarkdown('[수식 $x$](https://example.org/)');
  assert.match(link.html, /class="katex"/);
});
