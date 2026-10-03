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
    const size = Number(new URL(route.request().url()).searchParams.get('size') || 10);
    const posts = fixture.posts.map(post => ({ ...post, updatedAt: post.publishedAt, status: 'DRAFT', visibility: 'PUBLIC', seriesOrder: null, relatedSeriesId: post.relatedSeries?.id ?? null }));
    const data = path === '/auth/me' ? { role: 'ADMIN' } : path === '/auth/csrf' ? { headerName: 'X-CSRF', token: 'fixture' }
      : path === '/pages/snapshot' ? fixture
      : path === '/admin/posts' ? { items: posts.slice(number * size, (number + 1) * size), page: number, totalPages: Math.ceil(posts.length / size), totalElements: posts.length }
      : /^\/admin\/posts\/\d+$/.test(path) ? posts.find(post => post.id === Number(path.split('/').at(-1)))
      : path === '/admin/categories' ? fixture.categories.filter(item => item.depth === 1).map(item => ({ ...item, directCount: 1, children: fixture.categories.filter(child => child.path.startsWith(item.path + '/')).map(child => ({ ...child, directCount: 1, children: [] })) }))
      : path === '/admin/tags' ? Array.from({ length: 20 }, (_, i) => ({ name: `tag${i}`, count: 1 }))
      : path === '/admin/series' ? fixture.series
      : /^\/admin\/series\/\d+$/.test(path) ? { series: fixture.series.find(series => series.id === Number(path.split('/').at(-1))) }
      : path === '/admin/stack-badges' ? ['Alpha', 'Beta', 'Gamma'].map((name, index) => ({ id: index + 1, name, imageUrl: `/api/v1/stack-badges/${index + 1}/image` })) : [];
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

// 전체 필터를 보존하며 페이지 이동은 재조회 없이 수행, 상태 갱신은 선택 목록 재사용
test('pagination uses cached posts and status refresh reuses options', async ({ page }) => {
  let postReads = 0, categoryReads = 0;
  await mockApi(page, async (route, path) => {
    if (path === '/admin/categories') categoryReads++;
    if (path === '/admin/posts') postReads++;
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
    if (path === '/admin/posts' && delay) await new Promise(resolve => { finish = resolve; });
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

// 목록과 본문 검색에서 조건에 맞는 전체 글을 추가 조작 없이 표시하는지 검증
test('listing and search show all matching posts without a more button', async ({ page }) => {
  await mockApi(page); await page.goto('/ken-blog/posts/');
  await expect(page.locator('[data-search-card]:visible')).toHaveCount(34);
  await expect(page.getByRole('button', { name: '더 보기', exact: true })).toHaveCount(0);
  await page.goto('/ken-blog/search/?q=needle-');
  await expect(page.locator('[data-search-card]')).toHaveCount(34);
  await expect(page.locator('#search-filter')).toContainText('34편');
  await expect(page.getByRole('button', { name: '더 보기', exact: true })).toHaveCount(0);
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

// 프로젝트 소속 탐색 다음에 공개 관련 글 다섯 편을 표시하고 본문으로 이동
test('project rail lists related posts below its own documents', async ({ page }) => {
  await mockApi(page); await page.goto('/ken-blog/post/project-intro/');
  const related = page.getByRole('navigation', { name: '관련된 글 목록' });
  await expect(related.getByRole('link')).toHaveCount(5);
  await expect(related.getByRole('link').first()).toHaveText('검사 글 5');
  expect(await related.evaluate(node => node.previousElementSibling?.getAttribute('aria-label'))).toBe('프로젝트 글 목록');
  await related.getByRole('link').first().click();
  await expect(page).toHaveURL(/post\/fixture-5\//);
});

// 연결 글이 남으면 서버의 거부 안내를 유지하고 마지막 글 삭제 후 시리즈 제거
test('series deletion stays blocked until both owned and related posts are removed', async ({ page }) => {
  const remaining = new Set([1, 35]);
  let deleted = false;
  await mockApi(page, async (route, path) => {
    if (path === '/admin/series' && route.request().method() === 'GET') {
      await route.fulfill({ json: deleted ? [] : fixture.series }); return true;
    }
    if (path === '/admin/series/90' && route.request().method() === 'DELETE') {
      if (remaining.size) await route.fulfill({ status: 409, json: { detail: '소속 글과 관련된 글을 먼저 모두 삭제해야 합니다. 초안도 포함됩니다.' } });
      else { deleted = true; await route.fulfill({ status: 204 }); }
      return true;
    }
    if (/^\/admin\/posts\/\d+$/.test(path) && route.request().method() === 'DELETE') {
      remaining.delete(Number(path.split('/').at(-1))); await route.fulfill({ status: 204 }); return true;
    }
    return false;
  });
  page.on('dialog', dialog => dialog.accept());
  await page.goto('/ken-blog/manage/#series');
  const remove = page.getByRole('button', { name: 'UI 검사 프로젝트 삭제', exact: true });
  await remove.click(); await expect(page.locator('#dashboard-message')).toContainText('먼저 모두 삭제');
  await page.getByRole('link', { name: '글 관리', exact: true }).click();
  await page.getByRole('button', { name: '다음', exact: true }).click();
  await page.getByRole('button', { name: '다음', exact: true }).click();
  await page.getByRole('button', { name: '다음', exact: true }).click();
  await page.getByRole('button', { name: '프로젝트 소개 삭제', exact: true }).click();
  await expect.poll(() => remaining.has(35)).toBe(false);
  await page.getByRole('link', { name: '시리즈·프로젝트', exact: true }).click();
  await remove.click(); await expect(page.locator('#dashboard-message')).toContainText('먼저 모두 삭제');
  await page.getByRole('link', { name: '글 관리', exact: true }).click();
  await page.getByRole('button', { name: '이전', exact: true }).click();
  await page.getByRole('button', { name: '이전', exact: true }).click();
  await page.getByRole('button', { name: '이전', exact: true }).click();
  await page.getByRole('button', { name: '검사 글 1 삭제', exact: true }).click();
  await expect.poll(() => remaining.has(1)).toBe(false);
  await page.getByRole('link', { name: '시리즈·프로젝트', exact: true }).click();
  await remove.click(); await expect(page.locator('#series-list')).toContainText('등록된 시리즈·프로젝트가 없습니다');
});

/**
 * 변경 후 재조회·거부 응답을 포함한 분류 관리용 모의 API
 */
async function categoryApi(page) {
  let roots = [
    { id: 201, name: 'Alpha', path: 'alpha', depth: 1, sortOrder: 1, directCount: 0, children: [
      { id: 202, name: 'First', path: 'alpha/first', depth: 2, sortOrder: 1, directCount: 1, children: [] },
      { id: 203, name: 'Second', path: 'alpha/second', depth: 2, sortOrder: 2, directCount: 0, children: [] },
    ] },
    { id: 204, name: 'Beta', path: 'beta', depth: 1, sortOrder: 2, directCount: 0, children: [] },
  ];
  const orders = [];
  let reject = false;
  await mockApi(page, async (route, path) => {
    if (!path.startsWith('/admin/categories')) return false;
    const method = route.request().method();
    if (method === 'GET') { await route.fulfill({ json: roots }); return true; }
    if (path === '/admin/categories/order') {
      const body = route.request().postDataJSON(); orders.push(body);
      if (reject) { await route.fulfill({ status: 409, json: { detail: '순서 저장 충돌' } }); return true; }
      const parent = roots.find(root => root.id === body.parentId);
      const current = parent ? parent.children : roots;
      const next = body.ids.map(id => current.find(item => item.id === id));
      if (parent) parent.children = next; else roots = next;
      await route.fulfill({ json: next }); return true;
    }
    const id = Number(path.split('/')[3]);
    if (path.endsWith('/name')) {
      const category = roots.flatMap(root => [root, ...root.children]).find(item => item.id === id);
      category.name = route.request().postDataJSON().name;
      await route.fulfill({ json: category }); return true;
    }
    if (method === 'DELETE') {
      roots = roots.filter(root => root.id !== id).map(root => ({ ...root, children: root.children.filter(child => child.id !== id) }));
      await route.fulfill({ status: 204 }); return true;
    }
    return false;
  });
  return { orders, reject: () => { reject = true; } };
}

// 행 안에서 이름 수정·삭제, 대분류와 소분류 정렬 저장·실패 복원 검증
test('category rows rename and delete inline and reorder complete sibling groups', async ({ page }) => {
  const api = await categoryApi(page); await page.goto('/ken-blog/manage/#categories');
  await expect(page.getByRole('button', { name: 'First 수정', exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('categories-desktop.png') });
  await page.getByRole('button', { name: 'First 수정', exact: true }).click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await page.getByRole('textbox', { name: 'First 새 이름' }).fill('Renamed');
  await page.locator('.category-rename').getByRole('button', { name: '저장', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Renamed 수정', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Second 순서 이동', exact: true }).press('ArrowUp');
  await expect.poll(() => api.orders.length).toBe(1);
  expect(api.orders[0]).toEqual({ parentId: 201, ids: [203, 202] });
  await expect(page.locator('#dashboard-message')).toContainText('분류 순서를 저장했습니다');
  // 부모 행을 이동하면 하위 분류가 함께 따라가며 부모 ID는 변경되지 않음
  const from = await page.getByRole('button', { name: 'Alpha 순서 이동', exact: true }).boundingBox();
  const target = await page.locator('[data-category-id="204"] > .category-line').boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2); await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2, target.y + target.height - 2, { steps: 8 }); await page.mouse.up();
  await expect.poll(() => api.orders.length).toBe(2);
  expect(api.orders[1]).toEqual({ parentId: null, ids: [204, 201] });
  await expect(page.locator('#category-list > ul > [data-category-id]').first()).toHaveAttribute('data-category-id', '204');
  api.reject();
  await page.getByRole('button', { name: 'Alpha 순서 이동', exact: true }).press('ArrowUp');
  await expect(page.locator('#dashboard-message')).toContainText('순서 저장 충돌');
  await expect(page.locator('#category-list > ul > [data-category-id]').first()).toHaveAttribute('data-category-id', '204');
  page.on('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Renamed 삭제', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Renamed 삭제', exact: true })).toHaveCount(0);
});

// 좁은 화면에서 터치 정렬과 Escape 취소가 저장 요청·부모 관계를 지키는지 검증
test('category touch sorting and cancelled drags preserve the hierarchy', async ({ page }) => {
  const api = await categoryApi(page); await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/ken-blog/manage/#categories');
  const handle = page.getByRole('button', { name: 'Second 순서 이동', exact: true });
  await expect(handle).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('categories-mobile.png') });
  const from = await handle.boundingBox();
  const target = await page.locator('[data-category-id="202"] > .category-line').boundingBox();
  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x + from.width / 2, y: from.y + from.height / 2 }] });
  await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + from.width / 2, y: target.y + 2 }] });
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(() => api.orders.length).toBe(1);
  expect(api.orders[0]).toEqual({ parentId: 201, ids: [203, 202] });
  await expect(page.locator('#category-children-201 > [data-category-id]').first()).toHaveAttribute('data-category-id', '203');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const start = await page.getByRole('button', { name: 'Alpha 순서 이동', exact: true }).boundingBox();
  const end = await page.locator('[data-category-id="204"] > .category-line').boundingBox();
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2); await page.mouse.down();
  await page.mouse.move(start.x + start.width / 2, end.y + end.height - 2, { steps: 5 });
  await page.keyboard.press('Escape'); await page.mouse.up();
  expect(api.orders).toHaveLength(1);
  await expect(page.locator('#category-list > ul > [data-category-id]').first()).toHaveAttribute('data-category-id', '201');
});
