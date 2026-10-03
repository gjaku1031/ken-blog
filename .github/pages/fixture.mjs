/**
 * 공개 생성·브라우저 검사에 사용하는 가상 글, 실제 운영 자료와 무관
 */
export const fixture = {
  version: 2,
  categories: [
    { id: 1, path: 'z-first', name: 'Z First', depth: 1, sortOrder: 0 },
    { id: 2, path: 'z-first/child', name: 'Child Name', depth: 2, sortOrder: 2 },
    { id: 3, path: 'a-last', name: 'A Last', depth: 1, sortOrder: 9 },
  ],
  posts: Array.from({ length: 34 }, (_, index) => ({
    id: index + 1, slug: `fixture-${index + 1}`, title: `검사 글 ${index + 1}`, summary: '가상 공개 글',
    publishedAt: '2026-01-01T00:00:00Z', publishedDate: '2026-01-01', section: 'TECH',
    category: index % 2 ? { id: 3, path: 'a-last', name: 'A Last', depth: 1, sortOrder: 9 }
      : { id: 2, path: 'z-first/child', name: 'Child Name', depth: 2, sortOrder: 2 },
    tags: index % 2 ? ['plain'] : ['A|B'], series: null, relatedSeries: null, legacyPath: null,
    body: `## 첫 제목\n\n본문 전용 검색어 needle-${index + 1}. [[검사 글 2]] [* 주석 설명]\n\n` +
      '| ' + Array.from({ length: 16 }, (_, i) => `매우넓은열${i}`).join(' | ') + ' |\n' +
      '| ' + Array(16).fill('---').join(' | ') + ' |\n| ' + Array(16).fill('long-value').join(' | ') + ' |\n\n' +
      '<details>\n<summary>접힌 제목</summary>\n\n## 숨겨진 제목\n\n$x+y$\n\n</details>\n\n## 마지막 제목\n\n끝',
  })),
  series: [],
};
