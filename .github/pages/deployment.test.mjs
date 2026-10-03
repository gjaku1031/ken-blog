import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { deploymentManifest, readDeploymentManifest, deploymentState, filterPosts } from '../../src/main/resources/web/shared/deployment-status.ts';

/**
 * 공개 프로젝트와 탐색 정보를 포함한 비교 입력
 */
const snapshot = {
  version: 2,
  posts: [{ id: 1, title: '소개', slug: 'intro', section: 'PROJECT', summary: '요약', tags: [],
    publishedAt: '2026-10-01T00:00:00', publishedDate: '2026-10-01', category: null,
    series: { id: 7, name: '프로젝트', slug: 'project', kind: 'PROJECT', position: 1,
      items: [{ id: 1, slug: 'intro', title: '소개', order: 1 }] } }],
  series: [{ id: 7, name: '프로젝트', slug: 'project', kind: 'PROJECT', description: '소개 문구',
    projectStatus: 'ACTIVE', stackBadges: [{ id: 3, name: 'Spring', imageUrl: '/api/image' }],
    cover: { id: 1, slug: 'intro', title: '소개', order: 1 }, postCount: 1 }],
};

/**
 * 관리자 목록의 공개 글
 */
const published = { id: 1, status: 'PUBLISHED', visibility: 'PUBLIC' };

// 실제 산출물에 비교 기록을 포함하고 비공개 데이터 필드는 쓰지 않음
test('generated Pages artifact includes a validated deployment manifest', async () => {
  const manifest = readDeploymentManifest(JSON.parse(await readFile(new URL('../../build/site/deployment.json', import.meta.url), 'utf8')));
  assert.equal(manifest.version, 1);
  assert.deepEqual(Object.keys(manifest).sort(), ['generatedAt', 'posts', 'version']);
});

// 글·프로젝트·탐색 변경은 해당 공개 화면의 새 배포가 필요함
test('post, category, tags, project and navigation edits become pending until deployed', async () => {
  const deployed = await deploymentManifest(snapshot);
  for (const edit of [
    value => { value.posts[0].summary = '새 요약'; },
    value => { value.posts[0].title = '새 제목'; },
    value => { value.posts[0].category = { id: 2, path: '개발', name: '개발', depth: 1 }; },
    value => { value.posts[0].tags = ['새 태그']; },
    value => { value.posts[0].series.items.push({ id: 2, slug: 'second', title: '둘째', order: 2 }); },
    value => { value.series[0].name = '프로젝트 수정'; },
    value => { value.series[0].stackBadges.push({ id: 4, name: 'MySQL', imageUrl: '/api/4' }); },
  ]) {
    const changed = structuredClone(snapshot); edit(changed);
    const current = await deploymentManifest(changed);
    assert.equal(deploymentState(published, { current, deployed }).label, '수정 후 배포 대기');
    assert.equal(deploymentState(published, { current, deployed: current }).label, '공개 반영 완료');
  }
});

// 빌드 치환·속성 순서·관리자 내부 필드는 공개 내용 변경이 아님
test('asset URL rewriting, object key order and non-public fields do not cause false pending', async () => {
  const deployed = await deploymentManifest(snapshot);
  const changed = structuredClone(snapshot);
  changed.series[0].stackBadges[0].imageUrl = '/ken-blog/assets/stack.png';
  changed.posts[0] = Object.fromEntries(Object.entries(changed.posts[0]).reverse());
  changed.posts[0].updatedAt = 'later'; changed.posts[0].rendered = { html: 'build-only' };
  assert.deepEqual((await deploymentManifest(changed)).posts, deployed.posts);
});

// 공개 탐색의 상위 분류 이름·순서 변경은 대기 표시, 배열 순서 변경은 같은 공개 내용
test('public category labels and order participate in deployment comparison', async () => {
  const categorized = structuredClone(snapshot);
  categorized.categories = [
    { id: 2, path: 'parent', name: '상위', depth: 1, sortOrder: 0 },
    { id: 3, path: 'parent/child', name: '하위', depth: 2, sortOrder: 1 },
  ];
  categorized.posts[0].category = categorized.categories[1];
  const deployed = await deploymentManifest(categorized);
  for (const edit of [
    value => { value.categories[0].name = '상위 변경'; },
    value => { value.categories[0].sortOrder = 9; },
    value => { value.posts[0].category.sortOrder = 9; },
  ]) {
    const changed = structuredClone(categorized); edit(changed);
    assert.equal(deploymentState(published, { current: await deploymentManifest(changed), deployed }).kind, 'pending');
  }
  categorized.categories.reverse();
  assert.deepEqual((await deploymentManifest(categorized)).posts, deployed.posts);
});

// 발행·취소·비공개 전환을 실제 사이트 존재 여부와 함께 구분
test('new publication, unpublication and private transition have distinct pending states', async () => {
  const current = await deploymentManifest(snapshot);
  const empty = await deploymentManifest({ version: 2, posts: [], series: [] });
  assert.equal(deploymentState(published, { current, deployed: empty }).label, '발행 후 배포 대기');
  const draft = { ...published, status: 'DRAFT' };
  assert.equal(deploymentState(draft, { current: empty, deployed: current }).kind, 'pending');
  assert.equal(deploymentState(draft, { current: empty, deployed: empty }).label, '미발행');
  assert.equal(deploymentState({ ...published, visibility: 'PRIVATE' }, { current: empty, deployed: current }).kind, 'pending');
  assert.equal(deploymentState(published, null).kind, 'unknown');
  assert.equal(deploymentState(published, { current: empty, deployed: current }).kind, 'unknown');
});

// 페이지로 자르기 전 필터링해야 뒤쪽 글도 조회 가능
test('filters include drafts and pending posts beyond the first page', async () => {
  const current = await deploymentManifest(snapshot);
  const posts = Array.from({ length: 25 }, (_, i) => ({ ...published, id: i + 1, status: i === 24 ? 'DRAFT' : 'PUBLISHED' }));
  const changed = { ...current, posts: { ...current.posts, 23: 'a'.repeat(64) } };
  assert.deepEqual(filterPosts(posts, 'draft', { current, deployed: current }).map(p => p.id), [25]);
  assert.deepEqual(filterPosts(posts, 'pending', { current: changed, deployed: current }).map(p => p.id), [23]);
});

// 오염·잘못된 버전의 배포 기록을 반영 완료로 처리하지 않음
test('invalid manifests and incomplete snapshots fail closed', async () => {
  assert.throws(() => readDeploymentManifest({ version: 1, generatedAt: 'bad', posts: {} }));
  assert.throws(() => readDeploymentManifest({ version: 2, generatedAt: new Date().toISOString(), posts: {} }));
  assert.throws(() => readDeploymentManifest({ version: 1, generatedAt: new Date().toISOString(), posts: { 1: 'bad' } }));
  await assert.rejects(deploymentManifest({ version: 2, posts: [{}], series: [] }));
});
