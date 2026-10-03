import { test, expect } from '@playwright/test';
import { fixture } from './fixture.mjs';

/**
 * 실제 글 폼의 필수 키·타입과 선택 숫자 범위 검사
 */
function expectPostInput(body, editing = false) {
  expect(Object.keys(body).sort()).toEqual(['title', 'summary', 'categoryId', 'tags', 'seriesId', 'order', 'relatedSeriesId',
    ...(editing ? ['baseVersion'] : [])].sort());
  expect(typeof body.title).toBe('string'); expect(typeof body.summary).toBe('string');
  expect(Array.isArray(body.tags) && body.tags.every(tag => typeof tag === 'string')).toBe(true);
  for (const key of ['categoryId', 'seriesId', 'order', 'relatedSeriesId'])
    expect(body[key] === null || Number.isSafeInteger(body[key]) && body[key] > 0).toBe(true);
  if (editing) expect(Number.isSafeInteger(body.baseVersion) && body.baseVersion >= 0).toBe(true);
}

/**
 * 시리즈 종류별 메타데이터 키와 편집 기준 시각 검사
 */
function expectSeriesInput(body, project, editing = false) {
  expect(Object.keys(body).sort()).toEqual(['name', 'description', ...(editing ? ['baseUpdatedAt'] : []),
    ...(project ? ['projectStatus', 'startPeriod', 'endPeriod', 'stackBadgeNames'] : [])].sort());
  expect(typeof body.name).toBe('string'); expect(typeof body.description).toBe('string');
  if (editing) expect(typeof body.baseUpdatedAt).toBe('string');
  if (project) {
    expect(['PLAN', 'DEV', 'MAINT', 'DONE']).toContain(body.projectStatus);
    expect(typeof body.startPeriod).toBe('string');
    expect(body.endPeriod === null || typeof body.endPeriod === 'string').toBe(true);
    expect(Array.isArray(body.stackBadgeNames) && body.stackBadgeNames.every(name => typeof name === 'string')).toBe(true);
  }
}

/**
 * 메서드·필수 필드·편집 버전을 검사하고 저장 결과를 후속 읽기에 반영하는 API 대역
 * 지원하지 않는 경로는 501로 실패하여 계약 누락을 숨기지 않음
 */
async function mockApi(page, override = async () => false) {
  const posts = structuredClone(fixture.posts).map(post => ({ ...post, editVersion: 0, updatedAt: post.publishedAt,
    status: 'DRAFT', visibility: 'PUBLIC', seriesOrder: null, relatedSeriesId: null }));
  const series = structuredClone(fixture.series).map(row => ({ ...row, updatedAt: '2026-10-03T00:00:00', sortOrder: row.sortOrder ?? 0 }));
  const categories = structuredClone(fixture.categories).filter(item => item.depth === 1).map(item => ({ ...item, directCount: 1,
    children: fixture.categories.filter(child => child.path.startsWith(item.path + '/')).map(child => ({ ...child, directCount: 1, children: [] })) }));
  let authenticated = true;
  let revision = 0;
  await page.route('**/api/v1/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace('/api/v1', '');
    const method = request.method();
    if (await override(route, path)) return;
    const body = request.postDataJSON();
    let data, status = 200;
    // 인증·목록 경로는 메서드까지 계약에 포함
    if (method === 'GET' && path === '/auth/me') { status = authenticated ? 200 : 401; data = { role: 'ADMIN' }; }
    else if (method === 'GET' && path === '/auth/csrf') data = { headerName: 'X-CSRF', token: 'fixture' };
    else if (method === 'POST' && path === '/auth/logout') { authenticated = false; status = 204; }
    else if (method === 'POST' && path === '/auth/login') { authenticated = true; data = { role: 'ADMIN' }; }
    else if (method === 'GET' && path === '/pages/snapshot') data = fixture;
    else if (method === 'GET' && path === '/admin/posts/snapshot') data = posts;
    else if (method === 'GET' && path === '/admin/posts') {
      const number = Number(url.searchParams.get('page') || 0), size = Number(url.searchParams.get('size') || 10);
      data = { items: posts.slice(number * size, (number + 1) * size), page: number, totalPages: Math.ceil(posts.length / size), totalElements: posts.length };
    } else if (method === 'GET' && /^\/admin\/posts\/\d+$/.test(path)) data = posts.find(post => post.id === Number(path.split('/').at(-1)));
    else if (method === 'POST' && path === '/admin/posts') {
      expectPostInput(body);
      const id = Math.max(...posts.map(row => row.id)) + 1;
      data = { ...body, id, slug: `created-${id}`, editVersion: 0, status: 'DRAFT', visibility: 'PUBLIC', updatedAt: '2026-10-03T00:00:00',
        section: 'TECH', category: null, series: null, seriesOrder: body.order, relatedSeriesId: body.relatedSeriesId };
      posts.push(data); status = 201;
    } else if (method === 'PATCH' && /^\/admin\/posts\/\d+\/metadata$/.test(path)) {
      expectPostInput(body, true);
      const row = posts.find(post => post.id === Number(path.split('/')[3]));
      if (row.editVersion !== body.baseVersion) { status = 409; data = { detail: '다른 변경이 저장되었습니다.' }; }
      else {
        Object.assign(row, { title: body.title, summary: body.summary, tags: body.tags,
          category: categories.flatMap(item => [item, ...item.children]).find(item => item.id === body.categoryId) ?? null,
          series: series.find(item => item.id === body.seriesId) ?? null, seriesOrder: body.order, relatedSeriesId: body.relatedSeriesId,
          editVersion: row.editVersion + 1 });
        data = row;
      }
    } else if (method === 'PUT' && /^\/admin\/posts\/\d+\/publication$/.test(path)) {
      expect(Object.keys(body)).toEqual(['published']); expect(typeof body.published).toBe('boolean');
      const row = posts.find(post => post.id === Number(path.split('/')[3]));
      row.status = body.published ? 'PUBLISHED' : 'DRAFT'; row.editVersion++; data = row;
    } else if (method === 'GET' && path === '/admin/categories') data = categories;
    else if (method === 'GET' && path === '/admin/tags') data = [...new Set([...Array.from({ length: 20 }, (_, i) => `tag${i}`), ...posts.flatMap(row => row.tags)])].map(name => ({ name, count: 1 }));
    else if (method === 'GET' && path === '/admin/series') data = series;
    else if (method === 'GET' && /^\/admin\/series\/\d+$/.test(path)) data = { series: series.find(row => row.id === Number(path.split('/').at(-1))) };
    else if (method === 'POST' && path === '/admin/series') {
      expect(Object.keys(body).sort()).toEqual(['kind', 'metadata']);
      expect(['TECH', 'PROJECT']).toContain(body.kind);
      expectSeriesInput(body.metadata, body.kind === 'PROJECT');
      const id = Math.max(0, ...series.map(row => row.id)) + 1;
      data = { ...body.metadata, id, kind: body.kind, slug: `series-${id}`, visibility: 'PUBLIC', sortOrder: 0,
        updatedAt: `2026-10-03T00:00:${String(++revision).padStart(2, '0')}`, stackBadges: [], postCount: 0, cover: null };
      series.push(data); status = 201;
    } else if (method === 'PUT' && /^\/admin\/series\/\d+\/(metadata|order)$/.test(path)) {
      const row = series.find(item => item.id === Number(path.split('/')[3]));
      if (path.endsWith('/metadata')) {
        expectSeriesInput(body, row.kind === 'PROJECT', true);
        expect(body.baseUpdatedAt).toBe(row.updatedAt);
        const { baseUpdatedAt, ...metadata } = body;
        Object.assign(row, metadata, { updatedAt: `2026-10-03T00:00:${String(++revision).padStart(2, '0')}` });
      } else {
        expect(Object.keys(body)).toEqual(['order']); expect(Number.isSafeInteger(body.order)).toBe(true);
        row.sortOrder = body.order;
      }
      data = row;
    } else if (method === 'GET' && path === '/admin/stack-badges') data = ['Alpha', 'Beta', 'Gamma'].map((name, index) => ({ id: index + 1, name, imageUrl: `/api/v1/stack-badges/${index + 1}/image` }));
    else if (method === 'GET' && /^\/stack-badges\/[123]\/image$/.test(path)) {
      await route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64') }); return;
    }
    else { await route.fulfill({ status: 501, json: { detail: `Unhandled mock: ${method} ${path}` } }); throw new Error(`Unhandled mock: ${method} ${path}`); }
    if (status === 204) await route.fulfill({ status });
    else if (data === undefined) await route.fulfill({ status: 404, json: { detail: '없음' } });
    else await route.fulfill({ status, json: data });
  });
}

// 창 A의 저장 응답이 창 B를 닫거나 입력을 없애지 않는지 검증
test('late save preserves the newly opened editor', async ({ page }) => {
  let finish;
  await mockApi(page, async (route, path) => {
    if (!path.endsWith('/metadata')) return false;
    await new Promise(resolve => { finish = resolve; });
    await route.fulfill({ json: {} }); return true;
  });
  await page.goto('/ken-blog/manage/');
  await page.getByRole('button', { name: '검사 글 1', exact: true }).click();
  await page.getByRole('button', { name: '글 정보 저장', exact: true }).click();
  await expect.poll(() => !!finish).toBe(true);
  await page.locator('#dialog-close').click();
  await page.getByRole('button', { name: '검사 글 2', exact: true }).click();
  await page.locator('#edit-dialog input[name=title]').fill('보존할 입력');
  finish();
  await expect(page.locator('#dashboard-message')).toContainText('저장했습니다');
  await expect(page.locator('#edit-dialog')).toBeVisible();
  await expect(page.locator('#edit-dialog input[name=title]')).toHaveValue('보존할 입력');
});

// 전체 필터를 보존하며 페이지 이동은 재조회 없이 수행, 상태 갱신은 선택 목록 재사용
test('pagination uses cached posts and status refresh reuses options', async ({ page }) => {
  let postReads = 0, categoryReads = 0;
  await mockApi(page, async (route, path) => {
    if (path === '/admin/categories') categoryReads++;
    if (path === '/admin/posts/snapshot') postReads++;
    return false;
  });
  await page.goto('/ken-blog/manage/');
  await page.getByRole('button', { name: '다음', exact: true }).click();
  await expect(page.locator('#post-pages')).toContainText('2 / 4');
  await page.getByRole('button', { name: '이전', exact: true }).click();
  await page.getByRole('button', { name: '다음', exact: true }).click();
  await page.getByRole('button', { name: '다음', exact: true }).click();
  await expect(page.locator('#post-pages')).toContainText('3 / 4');
  expect(postReads).toBe(1);
  await page.locator('#refresh-post-status').click();
  await expect(page.locator('#refresh-post-status')).toBeEnabled();
  await expect(page.locator('#post-pages')).toContainText('3 / 4');
  expect(postReads).toBe(2);
  expect(categoryReads).toBe(1);
});

// 로그아웃 전에 시작한 상태 조회가 로그인 화면을 관리자 화면으로 되돌리지 않는지 검증
test('late dashboard response cannot restore a logged out session', async ({ page }) => {
  let delay = false, finish;
  await mockApi(page, async (route, path) => {
    if (path === '/admin/posts/snapshot' && delay) await new Promise(resolve => { finish = resolve; });
    return false;
  });
  await page.goto('/ken-blog/manage/');
  await expect(page.locator('#dashboard')).toBeVisible();
  delay = true;
  await page.locator('#refresh-post-status').click();
  await expect.poll(() => !!finish).toBe(true);
  await page.getByRole('button', { name: '로그아웃', exact: true }).click();
  await expect(page.locator('#login')).toBeVisible();
  finish();
  await expect(page.locator('#dashboard')).toBeHidden();
  await expect(page.locator('#login')).toBeVisible();
});

// 구분 문자가 든 태그와 공개 분류 표시 순서 검증
test('public tags and category names retain their data', async ({ page }) => {
  await mockApi(page);
  await page.goto('/ken-blog/posts/?tag=A%7CB');
  await expect(page.locator('[data-search-card]:visible')).toHaveCount(17);
  const roots = page.locator('[data-category-link]');
  await expect(roots.nth(0)).toContainText('Z First');
  await expect(roots.nth(1)).toContainText('Child Name');
});

// 터키어 대소문자 변환이 빌드된 색인의 비교 키와 달라지지 않는지 검증
test('category filtering uses the same case rules in every browser locale', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'tr-TR' });
  try {
    const page = await context.newPage(); await mockApi(page);
    await page.goto('/ken-blog/posts/?category=Z-FIRST');
    await expect(page.locator('[data-search-card]:visible')).toHaveCount(17);
  } finally { await context.close(); }
});

// 구 slug 주소의 공개 글 이동과 알 수 없는 글의 목록 복귀 검증
test('legacy slug redirects only to generated public posts', async ({ page }) => {
  await mockApi(page);
  await page.goto('/ken-blog/post/?slug=fixture-1#section-첫-제목');
  await expect(page).toHaveURL(/\/post\/fixture-1\//);
  await page.goto('/ken-blog/post/?slug=private-missing');
  await expect(page).toHaveURL(/\/posts\/$/);
  await page.goto('/ken-blog/project/?slug=demo&doc=intro');
  await expect(page).toHaveURL(/\/post\/project-intro\/$/);
  await page.goto('/ken-blog/course/?slug=old&chapter=first');
  await expect(page).toHaveURL(/\/post\/fixture-1\/$/);
});

// 데스크톱에서도 넓은 표의 오른쪽 열까지 스크롤 가능한지 검증
test('wide tables scroll within the article', async ({ page }) => {
  await mockApi(page); await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/ken-blog/post/fixture-1/');
  expect(await page.locator('.markdown-body table').evaluate(table => { table.scrollLeft = 100; return table.scrollLeft; })).toBeGreaterThan(0);
});

// 저장 성공 뒤 조회 실패가 닫힌 대화상자에 숨지 않는지 검증
test('series save reports a refresh failure without offering duplicate creation', async ({ page }) => {
  let saved = false;
  await mockApi(page, async (route, path) => {
    if (path === '/admin/series' && route.request().method() === 'POST') {
      saved = true;
      await route.fulfill({ json: { id: 90, ...route.request().postDataJSON() } }); return true;
    }
    if (saved && route.request().method() === 'GET') {
      await route.fulfill({ status: 503, json: { detail: '조회 실패' } }); return true;
    }
    return false;
  });
  await page.goto('/ken-blog/manage/#series');
  await page.getByRole('button', { name: '+ 새 시리즈', exact: true }).click();
  await page.locator('#edit-dialog input[name=name]').fill('검사 시리즈');
  await page.locator('#edit-dialog button[type=submit]').click();
  await expect(page.locator('#edit-dialog')).not.toBeVisible();
  await expect(page.locator('#dashboard-message')).toBeVisible();
  await expect(page.locator('#dashboard-message')).toContainText('저장했습니다. 목록을 새로고침하지 못했습니다.');
});

// 기본 정보 저장 뒤 순서의 401도 인증 만료로 전달
test('series order authentication failure returns to login', async ({ page }) => {
  await mockApi(page, async (route, path) => {
    if (!/^\/admin\/series\/\d+\/order$/.test(path)) return false;
    await route.fulfill({ status: 401, json: { detail: '만료' } }); return true;
  });
  await page.goto('/ken-blog/manage/#series');
  await page.getByRole('button', { name: '+ 새 시리즈', exact: true }).click();
  await page.locator('#edit-dialog input[name=name]').fill('순서 인증 검사');
  await page.locator('#edit-dialog input[name=order]').fill('7');
  await page.locator('#edit-dialog button[type=submit]').click();
  await expect(page.locator('#login')).toBeVisible();
  await expect(page.locator('#dashboard')).toBeHidden();
});

// 순서 저장 재시도에서 이미 성공한 생성·메타데이터 요청을 반복하지 않음
test('series order retry reuses the committed metadata', async ({ page }) => {
  let creates = 0, metadataWrites = 0, orders = 0;
  await mockApi(page, async (route, path) => {
    if (path === '/admin/series' && route.request().method() === 'POST') creates++;
    if (/^\/admin\/series\/\d+\/metadata$/.test(path)) metadataWrites++;
    if (/^\/admin\/series\/\d+\/order$/.test(path) && ++orders === 1) {
      await route.fulfill({ status: 503, json: { detail: '일시 장애' } }); return true;
    }
    return false;
  });
  await page.goto('/ken-blog/manage/#series');
  await page.getByRole('button', { name: '+ 새 시리즈', exact: true }).click();
  await page.locator('#edit-dialog input[name=name]').fill('순서 재시도 검사');
  await page.locator('#edit-dialog input[name=order]').fill('7');
  await page.locator('#edit-dialog button[type=submit]').click();
  await expect(page.locator('#dialog-message')).toContainText('카드 순서');
  await page.locator('#edit-dialog button[type=submit]').click();
  await expect(page.locator('#edit-dialog')).not.toBeVisible();
  expect(creates).toBe(1); expect(metadataWrites).toBe(0); expect(orders).toBe(2);
});

// 선택 개수 초과 후 제거하면 유효성 오류가 해제되는지 검증
test('removing a tag clears the capacity error', async ({ page }) => {
  await mockApi(page);
  await page.goto('/ken-blog/posts/new/');
  const input = page.getByRole('combobox', { name: '태그 검색' });
  for (let index = 0; index < 16; index++) { await input.fill(`tag${index}`); await input.press(','); }
  await input.fill('extra'); await input.press(',');
  expect(await input.evaluate(input => input.validity.customError)).toBe(true);
  await page.getByRole('button', { name: 'tag0 태그 제거', exact: true }).click();
  expect(await input.evaluate(input => input.validity.customError)).toBe(false);
});

// 키보드로 검색 입력에 진입했을 때 가시적 포커스 표시 검증
test('search focus remains visible for keyboard users', async ({ page }) => {
  await mockApi(page); await page.goto('/ken-blog/search/?q=검사');
  // 첫 프레임의 자동 포커스가 적용된 뒤 키보드 이동 시작
  await expect(page.locator('#site-search')).toBeFocused();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('#site-search')).toBeFocused();
  expect(await page.locator('.header-search-unit').evaluate(element => getComputedStyle(element).outlineStyle)).toBe('solid');
});

// 초기 렌더가 늦어져도 먼저 시작한 키보드 탐색의 포커스는 유지
test('delayed search autofocus preserves an earlier keyboard destination', async ({ page }) => {
  await page.addInitScript(() => {
    const frame = window.requestAnimationFrame;
    const pending = [];
    // 초기 프레임을 잡아 두고 사용자 탐색 뒤 같은 콜백을 실행
    window.requestAnimationFrame = callback => pending.push(callback);
    window.releaseInitialFrames = () => {
      window.requestAnimationFrame = frame;
      for (const callback of pending.splice(0)) frame(callback);
      return new Promise(resolve => frame(resolve));
    };
  });
  await mockApi(page); await page.goto('/ken-blog/search/?q=검사');
  await page.keyboard.press('Tab');
  const destination = page.getByRole('link', { name: '본문으로 건너뛰기', exact: true });
  await expect(destination).toBeFocused();
  await page.evaluate(() => window.releaseInitialFrames());
  await expect(destination).toBeFocused();
});

// 본문 검색 색인과 추가 표시가 카드 DOM을 필요한 결과로 제한하는지 검증
test('search loads body text separately and renders results in batches', async ({ page }) => {
  await mockApi(page); await page.goto('/ken-blog/search/?q=needle-');
  await expect(page.locator('[data-search-card]')).toHaveCount(20);
  await expect(page.locator('#search-filter')).toContainText('34편');
  await page.getByRole('button', { name: '더 보기', exact: true }).click();
  await expect(page.locator('[data-search-card]')).toHaveCount(34);
  await page.locator('#site-search').fill('needle-34');
  await expect(page.locator('[data-search-card]')).toHaveCount(1);
  await expect(page.locator('.post-list')).toContainText('검사 글 34');
});

// 목록의 익명 방문에서는 폼·본문 자산을 받지 않고 클릭 후에만 작성 창 연결
test('writer assets load only after an authenticated click', async ({ page }) => {
  await mockApi(page); await page.goto('/ken-blog/posts/');
  await expect(page.getByRole('button', { name: '글쓰기', exact: true })).toBeVisible();
  await expect(page.locator('#post-dialog')).toHaveCount(0);
  expect(await page.locator('link[rel=stylesheet]').count()).toBe(1);
  await page.getByRole('button', { name: '글쓰기', exact: true }).click();
  await expect(page.locator('#post-dialog')).toBeVisible();
  await expect(page.locator('#post-dialog input[name=title]')).toBeVisible();
  expect(await page.locator('link[rel=stylesheet]').count()).toBe(2);
});

// 현장 편집도 클릭 시에만 로딩하고 이전 저장 응답이 새 입력을 지우지 않는지 검증
test('public editing loads on demand and preserves a reopened form', async ({ page }) => {
  let finish;
  await mockApi(page, async (route, path) => {
    if (!path.endsWith('/metadata')) return false;
    await new Promise(resolve => { finish = resolve; });
    await route.fulfill({ json: {} }); return true;
  });
  await page.goto('/ken-blog/post/fixture-1/');
  await expect(page.locator('[data-post-edit]')).toBeVisible();
  await expect(page.locator('#detail-edit-dialog')).toHaveCount(0);
  const styles = await page.locator('link[rel=stylesheet]').count();
  await page.locator('[data-post-edit]').click();
  await expect(page.locator('#detail-edit-dialog input[name=title]')).toHaveValue('검사 글 1');
  expect(await page.locator('link[rel=stylesheet]').count()).toBe(styles + 1);
  // 분류 트리 접기는 선택값을 유지하고 선택 해제는 제출값만 비움
  const category = page.locator('#detail-edit-dialog input[name=categoryId]');
  await expect(category).toHaveValue('2');
  await page.getByRole('button', { name: 'Z First 하위 분류', exact: true }).click();
  await expect(category).toHaveValue('2');
  await page.getByRole('button', { name: '분류 없음', exact: true }).click();
  await expect(category).toHaveValue('');
  await page.getByRole('button', { name: '글 정보 저장', exact: true }).click();
  await expect.poll(() => !!finish).toBe(true);
  await page.locator('#detail-edit-dialog .dialog-close').click();
  await page.locator('[data-post-edit]').click();
  await page.locator('#detail-edit-dialog input[name=title]').fill('유지할 제목');
  const response = page.waitForResponse(response => response.url().endsWith('/metadata'));
  finish(); await response;
  await expect(page.locator('#detail-edit-dialog')).toBeVisible();
  await expect(page.locator('#detail-edit-dialog input[name=title]')).toHaveValue('유지할 제목');
  await expect(page.locator('.post-edit-notice')).toBeHidden();
  expect(await page.locator('link[rel=stylesheet]').count()).toBe(styles + 1);
});

// 화면 밖 도식은 초기화하지 않고 접근·테마 변경 시 올바른 SVG 표시
test('Mermaid renders on approach and follows theme changes', async ({ page }) => {
  await mockApi(page); await page.goto('/ken-blog/post/fixture-1/');
  const diagram = page.locator('.ken-mermaid');
  await expect(diagram.locator('img')).toHaveCount(0);
  await diagram.scrollIntoViewIfNeeded();
  await expect(diagram.locator('img')).toBeVisible({ timeout: 15000 });
  await expect(diagram).toHaveAttribute('data-enhanced', 'light');
  await page.locator('#theme-toggle').click();
  await diagram.scrollIntoViewIfNeeded();
  await expect(diagram).toHaveAttribute('data-enhanced', 'dark');
  await page.locator('#theme-toggle').click();
  await diagram.scrollIntoViewIfNeeded();
  await expect(diagram).toHaveAttribute('data-enhanced', 'light');
});

// 접힌 제목은 제외하고 펼치거나 문서 끝에 도달하면 목차 캐시 갱신
test('TOC updates after details toggle and at the document end', async ({ page }) => {
  await mockApi(page); await page.goto('/ken-blog/post/fixture-1/');
  await page.locator('.markdown-body summary').click();
  await page.getByRole('heading', { name: '숨겨진 제목', exact: true }).scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect(page.locator('.post-toc a[aria-current]')).toHaveText('마지막 제목');
});

// 공용 선택 입력으로 바꾼 뒤에도 기술 순서·키보드 선택·제거 유지 검증
test('stack picker preserves selection order through keyboard and removal', async ({ page }) => {
  await mockApi(page); await page.goto('/ken-blog/manage/#series');
  await page.getByRole('button', { name: '+ 새 프로젝트', exact: true }).click();
  const input = page.getByRole('combobox', { name: '기술 스택 검색' });
  for (const value of ['Gamma', 'Alpha']) { await input.fill(value); await input.press('ArrowDown'); await input.press('Enter'); }
  expect(await page.locator('input[name=stackBadgeNames]').evaluateAll(inputs => inputs.map(input => input.value))).toEqual(['Gamma', 'Alpha']);
  await page.getByRole('button', { name: 'Gamma 선택 해제' }).click();
  expect(await page.locator('input[name=stackBadgeNames]').evaluateAll(inputs => inputs.map(input => input.value))).toEqual(['Alpha']);
});

// 익명 독자에게 관리자 모듈·폼 생성이 발생하지 않는지 검증
test('anonymous listing and article have no editor dialogs or form stylesheet', async ({ page }) => {
  await mockApi(page, async (route, path) => {
    if (path !== '/auth/me') return false;
    await route.fulfill({ status: 401, json: {} }); return true;
  });
  await page.goto('/ken-blog/posts/');
  await expect(page.locator('[data-post-create]')).toBeHidden();
  await expect(page.locator('#post-dialog')).toHaveCount(0);
  expect(await page.locator('link[rel=stylesheet]').count()).toBe(1);
  await page.goto('/ken-blog/post/fixture-1/');
  await expect(page.locator('[data-post-edit]')).toBeHidden();
  await expect(page.locator('#detail-edit-dialog')).toHaveCount(0);
  expect(await page.locator('link[rel=stylesheet]').count()).toBe(2);
});

// 좁은 화면에서 정리한 공개·관리 스타일이 가로 페이지 넘침을 만들지 않는지 검증
test('mobile posts, project and admin panels fit the viewport', async ({ page }) => {
  await mockApi(page); await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ['/ken-blog/posts/', '/ken-blog/projects/', '/ken-blog/post/project-intro/', '/ken-blog/manage/']) {
    await page.goto(path);
    await expect(page.locator('#main-content, #dashboard').filter({ visible: true }).first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

// 공용 입력에서도 키보드·포인터 정렬과 취소가 실제 제출 순서에 반영되는지 검증
test('sortable tags preserve submitted order through keyboard, drag and cancellation', async ({ page }) => {
  await mockApi(page); await page.goto('/ken-blog/posts/new/');
  const input = page.getByRole('combobox', { name: '태그 검색' });
  for (const name of ['tag0', 'tag1', 'tag2']) { await input.fill(name); await input.press(','); }

  /**
   * 현재 제출되는 태그 순서
   */
  const values = () => page.locator('input[name=tags]').evaluateAll(inputs => inputs.map(input => input.value));

  /**
   * 키보드 이동·취소 애니메이션이 안정된 손잡이에서 같은 드래그 시작
   */
  async function beginDrag() {
    const handle = page.locator('[data-sort-key=tag1] .chip-drag-handle');
    // hover의 위치 안정성 검사를 거친 뒤 실제 드래그 좌표를 읽음
    await handle.hover();
    const first = await handle.boundingBox();
    const last = await page.locator('[data-sort-key=tag0]').boundingBox();
    await page.mouse.move(first.x + first.width / 2, first.y + first.height / 2); await page.mouse.down();
    await page.mouse.move(last.x + last.width - 4, last.y + last.height / 2, { steps: 5 });
  }
  await page.getByRole('button', { name: 'tag0 순서 이동, 1/3' }).press('End');
  expect(await values()).toEqual(['tag1', 'tag2', 'tag0']);
  // 실제 포인터로 마지막 칩 앞으로 이동한 뒤 Escape는 기존 제출 순서를 유지
  await beginDrag();
  await expect(page.locator('.chip-drag-preview')).toHaveCount(1);
  await page.keyboard.press('Escape'); await page.mouse.up();
  await expect(page.locator('.chip-drag-preview')).toHaveCount(0);
  expect(await values()).toEqual(['tag1', 'tag2', 'tag0']);
  // 같은 이동을 놓아서 확정하면 숨김 값과 화면 순서가 일치
  await beginDrag(); await page.mouse.up();
  await expect.poll(values).toEqual(['tag2', 'tag0', 'tag1']);
  await expect(page.locator('.chip-drag-preview')).toHaveCount(0);
  await page.getByRole('button', { name: 'tag0 태그 제거', exact: true }).click();
  expect(await values()).toEqual(['tag2', 'tag1']);
});

// 드래그 종료 애니메이션 중 창을 닫고 새 폼을 열어도 이전 손잡이가 포커스를 빼앗지 않음
test('closing a drag editor leaves the reopened form focused', async ({ page }) => {
  await mockApi(page); await page.goto('/ken-blog/manage/#series');
  await page.getByRole('button', { name: '+ 새 프로젝트', exact: true }).click();
  const input = page.getByRole('combobox', { name: '기술 스택 검색' });
  for (const name of ['Alpha', 'Beta', 'Gamma']) { await input.fill(name); await input.press('ArrowDown'); await input.press('Enter'); }
  const first = await page.locator('[data-sort-key=Alpha] .chip-drag-handle').boundingBox();
  const last = await page.locator('[data-sort-key=Gamma]').boundingBox();
  await page.mouse.move(first.x + first.width / 2, first.y + first.height / 2); await page.mouse.down();
  await page.mouse.move(last.x + last.width - 4, last.y + last.height / 2, { steps: 5 });
  await expect(page.locator('.chip-drag-preview')).toHaveCount(1);
  // 닫기·재열기를 같은 이벤트 순서로 수행하여 착지 콜백과 경쟁시킴
  await page.mouse.up();
  await page.evaluate(() => {
    document.querySelector('#edit-dialog').close();
    [...document.querySelectorAll('#series-create button')].find(button => button.textContent === '+ 새 프로젝트').click();
    document.querySelector('#edit-dialog input[name=name]').focus();
  });
  await expect(page.locator('.chip-drag-preview')).toHaveCount(0);
  await expect(page.locator('#edit-dialog input[name=name]')).toBeFocused();
});

// 긴 분류 트리의 선택 위치는 자체 스크롤로 표시하고 사이드바 전환은 키보드 지원
test('category scroll and sidebar radio navigation remain independent', async ({ page }) => {
  await mockApi(page, async (route, path) => {
    if (path !== '/admin/categories') return false;
    const categories = Array.from({ length: 60 }, (_, index) => ({
      id: index + 100, name: `추가 분류 ${index}`, path: `extra-${index}`, depth: 1, sortOrder: index, directCount: 1, children: [],
    }));
    categories.push({ id: 2, name: '기존 선택', path: 'selected', depth: 1, sortOrder: 61, directCount: 1, children: [] });
    await route.fulfill({ json: categories }); return true;
  });
  await page.goto('/ken-blog/manage/');
  await page.getByRole('button', { name: '검사 글 1', exact: true }).click();
  const scroll = page.locator('.category-tree-scroll');
  await expect.poll(() => scroll.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  await expect(page.locator('#edit-dialog input[name=categoryId]')).toHaveValue('2');
  expect(await scroll.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
  await page.goto('/ken-blog/posts/');
  await expect(page.locator('#sidebar-categories')).toBeVisible();
  await expect(page.locator('#sidebar-series')).toBeHidden();
  await page.getByRole('radio', { name: '분류', exact: true }).focus(); await page.keyboard.press('ArrowRight');
  await expect(page.locator('#sidebar-series')).toBeVisible();
  await expect(page.locator('#sidebar-categories')).toBeHidden();
  await page.keyboard.press('Tab'); await expect(page.locator('#sidebar-series')).toBeFocused();
});

// 종류 필터는 목록만 좁히며 조회 없이 이동하고 늦은 생성 결과는 사용자의 새 선택을 덮지 않음
test('series kind filters survive an older creation response', async ({ page }) => {
  let finish;
  await mockApi(page, async (route, path) => {
    if (path !== '/admin/series' || route.request().method() !== 'POST') return false;
    await new Promise(resolve => { finish = resolve; });
    await route.fulfill({ json: { ...fixture.series[0], ...route.request().postDataJSON().metadata } }); return true;
  });
  await page.goto('/ken-blog/manage/#series');
  await page.locator('[data-series-filter=PROJECT]').click();
  await expect(page.locator('#series-list')).toContainText('UI 검사 프로젝트');
  await page.getByRole('button', { name: '+ 새 프로젝트', exact: true }).click();
  await page.locator('#edit-dialog input[name=name]').fill('새 프로젝트');
  await page.locator('#edit-dialog input[name=startPeriod]').fill('2026.10');
  await page.locator('#edit-dialog button[type=submit]').click();
  await expect.poll(() => !!finish).toBe(true);
  await page.locator('#dialog-close').click(); await page.locator('[data-series-filter=TECH]').click();
  finish();
  await expect(page.locator('#dashboard-message')).toContainText('저장했습니다');
  await expect(page.locator('[data-series-filter=TECH]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#series-list')).toContainText('등록된 시리즈가 없습니다.');
});

// 실제 프로젝트 원고의 고정 배치·로고·테마를 브라우저 SVG 경계까지 검증
test('reference architecture diagrams render completely in both themes', async ({ page }) => {
  test.setTimeout(90000);
  await page.addInitScript(() => {
    window.diagramSvgs = [];
    const create = URL.createObjectURL;
    URL.createObjectURL = blob => {
      if (blob.type === 'image/svg+xml') void blob.text().then(svg => window.diagramSvgs.push(svg));
      return create.call(URL, blob);
    };
  });
  await mockApi(page); await page.goto('/ken-blog/post/project-intro/');
  const diagrams = page.locator('.ken-mermaid');
  await expect(diagrams).toHaveCount(2);
  for (const theme of ['light', 'dark']) {
    if (theme === 'dark') await page.locator('#theme-toggle').click();
    for (const diagram of await diagrams.all()) {
      await diagram.scrollIntoViewIfNeeded();
      await expect(diagram.locator('img')).toBeVisible({ timeout: 35000 });
      await expect(diagram).toHaveAttribute('data-enhanced', theme, { timeout: 35000 });
    }
  }
  const rendered = await page.evaluate(() => window.diagramSvgs.map(svg => {
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    return { services: doc.querySelectorAll('.architecture-service').length, external: !!doc.querySelector('image,script,foreignObject'),
      texts: doc.documentElement.textContent, width: +doc.documentElement.getAttribute('width') };
  }));
  expect(rendered.map(item => item.services).sort()).toEqual([13, 13, 17, 17]);
  expect(rendered.every(item => !item.external && item.width > 1000)).toBe(true);
  expect(rendered.filter(item => item.services === 13).every(item => item.texts.includes('API 컨테이너 교체'))).toBe(true);
});

// 좁은 화면의 여러 줄 칩도 터치로 이동하고 동작 축소 설정에서 정렬 유지
test('touch sorting works across wrapped rows with reduced motion', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ reducedMotion: 'reduce' });
  await mockApi(page); await page.goto('/ken-blog/posts/new/');
  const input = page.getByRole('combobox', { name: '태그 검색' });
  for (let index = 0; index < 8; index++) { await input.fill(`tag${index}`); await input.press(','); }
  // 위로 열리는 후보 목록을 닫은 뒤 실제 손잡이 좌표로 터치
  await input.press('Escape');
  await page.locator('.sortable-chips').scrollIntoViewIfNeeded();
  const first = await page.locator('[data-sort-key=tag0] .chip-drag-handle').boundingBox();
  const last = await page.locator('[data-sort-key=tag7]').boundingBox();
  expect(last.y).toBeGreaterThan(first.y);
  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: first.x + first.width / 2, y: first.y + first.height / 2 }] });
  await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: last.x + last.width - 4, y: last.y + last.height / 2 }] });
  await expect(page.locator('.chip-drag-preview')).toHaveCount(1);
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.locator('.chip-drag-preview')).toHaveCount(0);
  expect(await page.locator('input[name=tags]').evaluateAll(inputs => inputs.map(input => input.value)))
    .toEqual(['tag1', 'tag2', 'tag3', 'tag4', 'tag5', 'tag6', 'tag7', 'tag0']);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

// 저장 요청 한 번에 전체 편집 정보와 기준 버전 전달, 성공 뒤 목록에도 반영
test('post edit is atomic and the latest detail supplies its base version', async ({ page }) => {
  let writes = 0;
  await mockApi(page, async (route, path) => {
    if (route.request().method() === 'PATCH' && path.endsWith('/metadata')) {
      writes++;
      expect(route.request().postDataJSON().baseVersion).toBe(0);
    }
    return false;
  });
  await page.goto('/ken-blog/manage/');
  await page.getByRole('button', { name: '검사 글 1', exact: true }).click();
  await page.locator('#edit-dialog input[name=title]').fill('원자적 수정');
  await expect(page.locator('#edit-dialog')).toContainText('content/posts/fixture-1.md');
  await page.getByRole('button', { name: '글 정보 저장', exact: true }).click();
  await expect(page.getByRole('button', { name: '원자적 수정', exact: true })).toBeVisible();
  expect(writes).toBe(1);
});

// 409 응답 뒤 수정 중 입력과 창을 유지
test('stale post conflict preserves the form', async ({ page }) => {
  await mockApi(page, async (route, path) => {
    if (!path.endsWith('/metadata')) return false;
    await route.fulfill({ status: 409, json: { detail: '다른 변경이 저장되었습니다.' } }); return true;
  });
  await page.goto('/ken-blog/manage/');
  await page.getByRole('button', { name: '검사 글 1', exact: true }).click();
  await page.locator('#edit-dialog input[name=title]').fill('보존할 수정');
  await page.getByRole('button', { name: '글 정보 저장', exact: true }).click();
  await expect(page.locator('#dialog-message')).toContainText('다른 변경');
  await expect(page.locator('#edit-dialog input[name=title]')).toHaveValue('보존할 수정');
});

// 자동 새로고침은 목록 내부 버튼의 키보드 포커스 유지
test('automatic dashboard refresh preserves action focus', async ({ page }) => {
  let reads = 0;
  await mockApi(page, async (_, path) => { if (path === '/admin/posts/snapshot') reads++; return false; });
  await page.goto('/ken-blog/manage/');
  const button = page.getByRole('button', { name: '검사 글 1', exact: true });
  await button.focus();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(() => reads).toBeGreaterThan(1);
  await expect(button).toBeFocused();
});

// 저장 후 전체 조회 중 자동 조회가 들어와도 선택 목록의 새 응답을 버리지 않음
test('automatic refresh joins the full refresh after save', async ({ page }) => {
  let categoryReads = 0, release;
  await mockApi(page, async (_, path) => {
    if (path === '/admin/categories' && ++categoryReads === 2) await new Promise(resolve => { release = resolve; });
    return false;
  });
  await page.goto('/ken-blog/manage/');
  await page.getByRole('button', { name: '검사 글 1', exact: true }).click();
  await page.getByRole('button', { name: '글 정보 저장', exact: true }).click();
  await expect.poll(() => !!release).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  release();
  await expect(page.locator('#dashboard-message')).toContainText('저장했습니다');
  expect(categoryReads).toBe(2);
});

// 다른 페이지에서 처음 검색하면 뒤로 가기로 원래 글에 복귀
test('first search navigation preserves the previous article in history', async ({ page }) => {
  await mockApi(page);
  await page.goto('/ken-blog/post/fixture-2/');
  await page.getByRole('button', { name: '검색 열기' }).click();
  await page.locator('#site-search').fill('needle-3');
  await expect(page).toHaveURL(/\/search\//);
  await expect(page.locator('#search-filter')).toHaveAttribute('role', 'status');
  await page.goBack();
  await expect(page).toHaveURL(/\/post\/fixture-2\//);
});

// 주석은 화면 오른쪽에서도 보이며 Escape 뒤 링크 포커스 유지
test('annotation popup stays in the viewport and Escape preserves focus', async ({ page }) => {
  await mockApi(page); await page.setViewportSize({ width: 390, height: 700 });
  await page.goto('/ken-blog/post/fixture-2/');
  const ref = page.locator('.ken-annotation-ref').first();
  const link = ref.locator(':scope > a');
  await ref.evaluate(element => { element.style.position = 'fixed'; element.style.right = '1px'; element.style.top = '100px'; });
  await link.focus();
  const popup = ref.locator('.ken-annotation-popup');
  await expect(popup).toBeVisible();
  const box = await popup.boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(390);
  await link.press('Escape'); await expect(popup).toBeHidden(); await expect(link).toBeFocused();
});

// 링크 첨부는 링크 하나만 키보드 대상이며 문단 안 이미지도 종횡비 보존
test('linked inline attachment keeps link behavior and responsive aspect ratio', async ({ page }) => {
  await mockApi(page); await page.setViewportSize({ width: 390, height: 700 });
  await page.goto('/ken-blog/post/fixture-2/');
  await page.evaluate(() => {
    const body = document.querySelector('.markdown-body');
    const paragraph = document.createElement('p'); paragraph.id = 'image-regression';
    const link = document.createElement('a'); link.href = '#image-destination';
    const image = document.createElement('img'); image.className = 'ken-attachment'; image.width = 1600; image.height = 800;
    image.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="800"></svg>';
    image.alt = '링크 이미지'; link.append(image); paragraph.append('본문 ', link); body.prepend(paragraph);
    document.dispatchEvent(new Event('site-theme'));
  });
  const image = page.locator('#image-regression img');
  await expect(image).not.toHaveAttribute('role', 'button');
  await expect(image).not.toHaveAttribute('tabindex', '0');
  const bounds = await image.boundingBox();
  expect(bounds.width).toBeLessThan(390);
  expect(Math.abs(bounds.width / bounds.height - 2)).toBeLessThan(0.02);
  await image.click();
  await expect(page).toHaveURL(/#image-destination$/);
  await expect(page.locator('dialog[open]')).toHaveCount(0);
});
