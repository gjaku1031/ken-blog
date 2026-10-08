import { readFileSync } from 'node:fs';

/**
 * 공개 생성·브라우저 검사에 사용하는 가상 글, 도식은 저장소 원고 표본 포함
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

// 화면 밖 도식의 지연 렌더를 검사할 충분한 문서 길이
fixture.posts[0].body += '\n\n' + '여백 문단\n\n'.repeat(50) + '```mermaid\ngraph TD\n A-->B\n```';

/**
 * 가상 프로젝트의 대문 글
 */
const cover = { id: 35, slug: 'project-intro', title: '프로젝트 소개', order: 1 };

/**
 * 가상 프로젝트의 공개 식별 정보
 */
const project = { id: 90, slug: 'demo', name: 'UI 검사 프로젝트', kind: 'PROJECT' };
// 프로젝트와 옛 문서·강의 주소의 공개 이동 관계
fixture.posts[0].legacyPath = 'course/old/chapters/first';
fixture.posts.push({ ...fixture.posts[1], ...cover, section: 'PROJECT', category: null, tags: [],
  body: '## 프로젝트 소개\n\n프로젝트 본문', legacyPath: 'project/demo/docs/intro',
  series: { ...project, items: [cover], position: 1 } });
fixture.series.push({ ...project, description: '검사 프로젝트 개요', sortOrder: 0,
  projectStatus: 'DEV', startPeriod: '2026.01', endPeriod: null, stackBadges: [], cover, postCount: 1 });

// 프로젝트 소속 문서와 구분되는 다섯 공개 관련 글
for (const post of fixture.posts.slice(0, 5)) post.relatedSeries = project;

// 현재 원고의 두 고정 배치도 실제 브라우저 렌더 경로로 검증
for (const slug of ['doc-340352c9-5fde-4bae-bc0b-4ecd744719a8', 'project-8d420603-48bb-4e29-8983-e08a6e649f80']) {
  const body = readFileSync(new URL(`../../content/posts/${slug}.md`, import.meta.url), 'utf8');
  const diagram = body.match(/```mermaid(?: [^\n]*)?\n(architecture-beta[\s\S]*?)\n```/)[0];
  fixture.posts.at(-1).body += '\n\n' + diagram;
}
