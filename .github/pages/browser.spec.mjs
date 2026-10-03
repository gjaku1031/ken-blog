import { test, expect } from '@playwright/test';
import { fixture } from './fixture.mjs';

/**
 * 화면별 관리자 API 응답과 요청 관측, 변경 요청은 가상 응답만 반환
 */
async function mockApi(page, override = async () => false) {
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
    if (await override(route, path)) return;
    const number = Number(new URL(route.request().url()).searchParams.get('page') || 0);
    const posts = fixture.posts.map(post => ({ ...post, updatedAt: post.publishedAt, status: 'DRAFT', visibility: 'PUBLIC', seriesOrder: null, relatedSeriesId: null }));
    const data = path === '/auth/me' ? { role: 'ADMIN' } : path === '/auth/csrf' ? { headerName: 'X-CSRF', token: 'fixture' }
      : path === '/admin/posts' ? { items: posts.slice(number * 10, number * 10 + 10), page: number, totalPages: 4, totalElements: 34 }
      : path === '/admin/categories' ? fixture.categories.filter(item => item.depth === 1).map(item => ({ ...item, directCount: 1, children: fixture.categories.filter(child => child.path.startsWith(item.path + '/')).map(child => ({ ...child, directCount: 1, children: [] })) }))
      : path === '/admin/tags' ? Array.from({ length: 20 }, (_, i) => ({ name: `tag${i}`, count: 1 })) : [];
    await route.fulfill({ json: data });
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

// 응답 순서가 뒤집혀도 최신 페이지가 유지되고 분류를 재조회하지 않는지 검증
test('pagination ignores superseded responses and reuses options', async ({ page }) => {
  let delay = false, categoryReads = 0;
  await mockApi(page, async (route, path) => {
    if (path === '/admin/categories') categoryReads++;
    if (path === '/admin/posts' && delay && route.request().url().includes('page=0')) {
      await new Promise(resolve => setTimeout(resolve, 350));
    }
    return false;
  });
  await page.goto('/ken-blog/manage/');
  await page.getByRole('button', { name: '다음', exact: true }).click();
  await expect(page.locator('#post-pages')).toContainText('2 / 4');
  delay = true;
  await page.getByRole('button', { name: '이전', exact: true }).click();
  await page.getByRole('button', { name: '다음', exact: true }).click();
  await expect(page.locator('#post-pages')).toContainText('3 / 4');
  await page.waitForTimeout(450);
  await expect(page.locator('#post-pages')).toContainText('3 / 4');
  expect(categoryReads).toBe(1);
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

// 구 slug 주소의 공개 글 이동과 알 수 없는 글의 목록 복귀 검증
test('legacy slug redirects only to generated public posts', async ({ page }) => {
  await mockApi(page);
  await page.goto('/ken-blog/post/?slug=fixture-1#section-첫-제목');
  await expect(page).toHaveURL(/\/post\/fixture-1\//);
  await page.goto('/ken-blog/post/?slug=private-missing');
  await expect(page).toHaveURL(/\/posts\/$/);
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
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('#site-search')).toBeFocused();
  expect(await page.locator('.header-search-unit').evaluate(element => getComputedStyle(element).outlineStyle)).toBe('solid');
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
