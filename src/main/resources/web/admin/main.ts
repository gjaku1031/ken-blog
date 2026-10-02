import './style.css';

type Csrf = { headerName: string; token: string };
type Page<T> = { items: T[]; page: number; totalElements: number; totalPages: number };
type Category = { id: number; path: string; name: string; depth: number; sortOrder: number; directCount: number; children: Category[] };
type Badge = { id: number; name: string; projectCount: number | null };
type Series = { id: number; name: string; slug: string; kind: 'TECH' | 'PROJECT'; description: string; projectStatus: string | null; startPeriod: string | null; endPeriod: string | null; updatedAt: string; sortOrder: number; stackBadges: Badge[] };
type Post = { id: number; title: string; slug: string; section: string; status: string; summary: string; category: Category | null; tags: string[]; series: Series | null; seriesOrder: number | null; relatedSeriesId: number | null };
type AdminData = { posts: Page<Post>; series: Series[]; categories: Category[]; badges: Badge[] };

const root = document.documentElement;
const savedTheme = localStorage.getItem('ken-blog-theme');
if (savedTheme === 'dark' || savedTheme === 'light') root.dataset.theme = savedTheme;
document.querySelector<HTMLButtonElement>('[data-theme-toggle]')?.addEventListener('click', () => {
  const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
  root.dataset.theme = next;
  localStorage.setItem('ken-blog-theme', next);
});

const apiBase = document.body.dataset.apiBase ?? '';
const boot = get('boot');
const login = get('login');
const dashboard = get('dashboard');
const loginMessage = get('login-message');
const dashboardMessage = get('dashboard-message');
const loginForm = get('login-form') as HTMLFormElement;
let csrf: Csrf | null = null;
let postPage = 0;
let sessionReady = false;
let currentData: AdminData | null = null;

function get(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (!found) throw new Error(`화면 요소 누락: ${id}`);
  return found;
}
function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (text) item.textContent = text;
  return item;
}
function setMessage(target: HTMLElement, message: string, error = false) {
  target.textContent = message;
  target.hidden = !message;
  target.classList.toggle('error', error);
  target.setAttribute('role', error ? 'alert' : 'status');
}
function clearDashboard() {
  currentData = null;
  for (const id of ['post-create', 'post-list', 'post-pages', 'category-create', 'category-list', 'series-create', 'series-list', 'badge-create', 'badge-list']) get(id).replaceChildren();
}
function showLogin(message = '') {
  sessionReady = false;
  csrf = null;
  clearDashboard();
  boot.hidden = true;
  dashboard.hidden = true;
  login.hidden = false;
  setMessage(loginMessage, message, !!message);
}
function showDashboard() {
  boot.hidden = true;
  login.hidden = true;
  dashboard.hidden = false;
  setMessage(loginMessage, '');
}
class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
async function request<T>(path: string, method = 'GET', body?: object | FormData): Promise<T> {
  if (!apiBase) throw new Error('관리자 연결 주소가 설정되지 않았습니다.');
  const headers = new Headers({ Accept: 'application/json' });
  if (method !== 'GET') {
    if (!csrf) await refreshCsrf();
    if (csrf) headers.set(csrf.headerName, csrf.token);
  }
  if (body && !(body instanceof FormData)) headers.set('Content-Type', 'application/json');
  let response: Response;
  try {
    response = await fetch(new URL('/api/v1' + path, apiBase), {
      method, headers, credentials: 'include', cache: 'no-store', redirect: 'error',
      body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('관리자 연결에 실패했습니다. 인터넷 연결과 브라우저의 사이트 간 쿠키 허용 설정을 확인하세요.');
  }
  if (!response.ok) {
    let detail = '';
    try {
      const problem = await response.json() as { detail?: unknown; title?: unknown };
      detail = typeof problem.detail === 'string' ? problem.detail : typeof problem.title === 'string' ? problem.title : '';
    } catch { /* 응답 본문이 없는 오류 */ }
    if (response.status === 401) throw new HttpError(401, '로그인이 만료되었습니다. 다시 로그인하세요.');
    if (response.status === 403) throw new HttpError(403, '요청이 거부되었습니다. 페이지를 새로고침한 뒤 다시 시도하세요.');
    throw new HttpError(response.status, detail || `요청에 실패했습니다. HTTP ${response.status}`);
  }
  if (response.status === 204) return undefined as T;
  return await response.json() as T;
}
async function refreshCsrf(): Promise<void> {
  csrf = await request<Csrf>('/auth/csrf');
  if (!csrf || !csrf.headerName || !csrf.token) throw new Error('로그인 보호 토큰을 받지 못했습니다.');
}
async function mutate<T>(path: string, method: string, body?: object | FormData): Promise<T> {
  try { return await request<T>(path, method, body); }
  catch (error) {
    if (error instanceof HttpError && error.status === 403) csrf = null;
    throw error;
  }
}
async function action(operation: () => Promise<unknown>, success: string) {
  setMessage(dashboardMessage, '');
  try {
    await operation();
    await loadDashboard();
    setMessage(dashboardMessage, success + ' 공개 사이트 반영은 GitHub Actions의 Pages 워크플로를 실행하세요.');
  } catch (error) {
    if (error instanceof HttpError && error.status === 401) showLogin(error.message);
    else setMessage(dashboardMessage, error instanceof Error ? error.message : '요청에 실패했습니다.', true);
  }
}
function form(onSubmit: (data: FormData) => Promise<unknown>, success: string): HTMLFormElement {
  const item = el('form', 'field-grid');
  item.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!item.reportValidity()) return;
    const button = item.querySelector<HTMLButtonElement>('button[type=submit]');
    if (button) button.disabled = true;
    await action(() => onSubmit(new FormData(item)), success);
    if (button) button.disabled = false;
  });
  return item;
}
function field(form: HTMLElement, title: string, name: string, value = '', options: { required?: boolean; max?: number; type?: string; wide?: boolean; placeholder?: string } = {}) {
  const label = el('label', options.wide ? 'wide' : '', title);
  const input = el('input');
  input.name = name;
  input.type = options.type ?? 'text';
  input.value = value;
  input.required = options.required ?? false;
  if (options.max) input.maxLength = options.max;
  if (options.placeholder) input.placeholder = options.placeholder;
  label.append(input);
  form.append(label);
  return input;
}
function area(form: HTMLElement, title: string, name: string, value = '', max = 500, wide = true) {
  const label = el('label', wide ? 'wide' : '', title);
  const input = el('textarea');
  input.name = name; input.value = value; input.rows = 3; input.maxLength = max;
  label.append(input); form.append(label);
  return input;
}
function choice(form: HTMLElement, title: string, name: string, options: Array<[string, string]>, value = '') {
  const label = el('label', '', title);
  const input = el('select');
  input.name = name;
  for (const [key, caption] of options) {
    const option = el('option', '', caption);
    option.value = key;
    input.append(option);
  }
  input.value = value;
  label.append(input); form.append(label);
  return input;
}
function submit(form: HTMLFormElement, title: string) {
  const row = el('div', 'form-actions');
  const button = el('button', 'button primary', title);
  button.type = 'submit';
  row.append(button);
  form.append(row);
}
function value(data: FormData, name: string): string { return String(data.get(name) ?? '').trim(); }
function optionalNumber(data: FormData, name: string): number | null {
  const raw = value(data, name);
  return raw ? Number(raw) : null;
}
function tags(data: FormData): string[] { return value(data, 'tags').split(',').map(item => item.trim()).filter(Boolean); }
function categoryOptions(categories: Category[]): Array<[string, string]> {
  return [['', '분류 없음'], ...flatten(categories).map(item => [String(item.id), item.path] as [string, string])];
}
function flatten(nodes: Category[]): Category[] { return nodes.flatMap(item => [item, ...flatten(item.children ?? [])]); }
function checkboxes(form: HTMLElement, title: string, badges: Badge[], selected: string[] = []) {
  const group = el('fieldset', 'wide badge-list');
  group.append(el('legend', '', title));
  for (const badge of badges) {
    const label = el('label', 'check');
    const checkbox = el('input'); checkbox.type = 'checkbox'; checkbox.name = 'stackBadgeNames'; checkbox.value = badge.name;
    checkbox.checked = selected.includes(badge.name);
    label.append(checkbox, document.createTextNode(badge.name)); group.append(label);
  }
  form.append(group);
}
function badgeNames(data: FormData): string[] { return data.getAll('stackBadgeNames').map(String); }
function itemHeading(title: string, detail = '') {
  const heading = el('div', 'item-title');
  heading.append(el('h3', '', title));
  if (detail) heading.append(el('span', 'pill', detail));
  return heading;
}
function smallAction(parent: HTMLElement, title: string, operation: () => Promise<unknown>, success: string, confirmText = '') {
  const button = el('button', 'button ghost', title);
  button.type = 'button';
  button.addEventListener('click', async () => {
    if (confirmText && !window.confirm(confirmText)) return;
    button.disabled = true;
    await action(operation, success);
    button.disabled = false;
  });
  parent.append(button);
}

async function loadDashboard() {
  if (!sessionReady) return;
  const data = await Promise.all([
    request<Page<Post>>(`/admin/posts?page=${postPage}&size=30`),
    request<Series[]>('/admin/series'),
    request<Category[]>('/admin/categories'),
    request<Badge[]>('/admin/stack-badges'),
  ]);
  if (!sessionReady) return;
  currentData = { posts: data[0], series: data[1], categories: data[2], badges: data[3] };
  render(currentData);
  showDashboard();
}
function render(data: AdminData) {
  renderPosts(data);
  renderCategories(data);
  renderSeries(data);
  renderBadges(data);
}
function renderPosts(data: AdminData) {
  const create = form(input => mutate('/admin/posts', 'POST', {
    title: value(input, 'title'), slug: value(input, 'slug'), summary: value(input, 'summary'),
    categoryId: optionalNumber(input, 'categoryId'), tags: tags(input),
    seriesId: optionalNumber(input, 'seriesId'), relatedSeriesId: optionalNumber(input, 'relatedSeriesId'), order: optionalNumber(input, 'order'),
  }), '글 메타데이터를 만들었습니다.');
  field(create, '제목', 'title', '', { required: true, max: 200 });
  field(create, '주소 slug', 'slug', '', { required: true, max: 160, placeholder: 'lowercase-hyphen' });
  field(create, '요약', 'summary', '', { max: 120 });
  choice(create, '분류', 'categoryId', categoryOptions(data.categories));
  field(create, '태그 (쉼표 구분)', 'tags');
  seriesFields(create, data, null, null, null);
  submit(create, '글 만들기'); get('post-create').replaceChildren(create);

  const list = get('post-list'); list.replaceChildren();
  if (!data.posts.items.length) list.append(el('p', 'empty', '등록된 글이 없습니다.'));
  for (const post of data.posts.items) {
    const article = el('article', 'item');
    article.append(itemHeading(post.title, `${post.section} · ${post.status}`));
    article.append(el('p', 'muted', `/${post.slug} · content/posts/${post.slug}.md`));
    {
      const edit = form(input => mutate(`/admin/posts/${post.id}/metadata`, 'PATCH', {
        title: value(input, 'title'), summary: value(input, 'summary'),
        categoryId: optionalNumber(input, 'categoryId'), tags: tags(input),
      }), '글 메타데이터를 저장했습니다.');
      field(edit, '제목', 'title', post.title, { required: true, max: 200 });
      field(edit, '요약', 'summary', post.summary, { max: 120 });
      choice(edit, '분류', 'categoryId', categoryOptions(data.categories), String(post.category?.id ?? ''));
      field(edit, '태그 (쉼표 구분)', 'tags', post.tags.join(', '));
      submit(edit, '메타데이터 저장'); article.append(edit);
    }
    const membership = form(input => mutate(`/admin/posts/${post.id}/series`, 'PUT', {
      seriesId: optionalNumber(input, 'seriesId'), relatedSeriesId: optionalNumber(input, 'relatedSeriesId'), order: optionalNumber(input, 'order'),
    }), '시리즈와 문서 순서를 저장했습니다.');
    seriesFields(membership, data, post.series?.id ?? null, post.seriesOrder, post.relatedSeriesId);
    submit(membership, '시리즈·순서 저장'); article.append(membership);
    const actions = el('div', 'inline-actions');
    const published = post.status === 'PUBLISHED';
    smallAction(actions, published ? '발행 취소' : '발행', () =>
      mutate(`/admin/posts/${post.id}/publication`, 'PUT', { published: !published }),
      published ? '발행을 취소했습니다.' : '발행했습니다.',
      published ? '이 글의 발행을 취소할까요?' : '저장소 Markdown 원고를 확인하고 이 글을 발행할까요?');
    article.append(actions); list.append(article);
  }
  const pages = get('post-pages'); pages.replaceChildren();
  const pageButton = (title: string, next: number) => {
    const button = el('button', 'button ghost', title);
    button.type = 'button';
    button.addEventListener('click', async () => {
      button.disabled = true;
      const previous = postPage;
      postPage = next;
      try { await loadDashboard(); }
      catch (error) {
        postPage = previous;
        if (error instanceof HttpError && error.status === 401) showLogin(error.message);
        else setMessage(dashboardMessage, error instanceof Error ? error.message : '글 목록을 읽지 못했습니다.', true);
        button.disabled = false;
      }
    });
    pages.append(button);
  };
  if (data.posts.page > 0) pageButton('이전', data.posts.page - 1);
  pages.append(el('span', '', `${data.posts.page + 1} / ${Math.max(1, data.posts.totalPages)}`));
  if (data.posts.page + 1 < data.posts.totalPages) pageButton('다음', data.posts.page + 1);
}
function renderCategories(data: AdminData) {
  const create = form(input => mutate('/admin/categories', 'POST', { path: value(input, 'path') }), '분류를 만들었습니다.');
  field(create, '분류 경로', 'path', '', { required: true, placeholder: '상위/하위' });
  submit(create, '분류 만들기'); get('category-create').replaceChildren(create);
  const list = get('category-list'); list.replaceChildren();
  const categories = flatten(data.categories);
  if (!categories.length) list.append(el('p', 'empty', '등록된 분류가 없습니다.'));
  for (const category of categories) {
    const article = el('article', 'item');
    article.append(itemHeading(category.path, `${category.directCount}개 글`));
    const order = form(input => mutate(`/admin/categories/${category.id}/order`, 'PUT', { order: Number(value(input, 'order')) }), '분류 순서를 저장했습니다.');
    field(order, '순서', 'order', String(category.sortOrder), { type: 'number' });
    submit(order, '순서 저장'); article.append(order);
    smallAction(article, '분류 삭제', () => mutate(`/admin/categories/${category.id}`, 'DELETE'), '분류를 삭제했습니다.',
      `${category.path} 분류를 삭제할까요? 글은 상위 분류로 이동합니다.`);
    list.append(article);
  }
}
function seriesFields(parent: HTMLElement, data: AdminData, selected: number | null, order: number | null, related: number | null) {
  choice(parent, '시리즈', 'seriesId', [['', '없음'], ...data.series.map(item => [String(item.id), `${item.kind === 'PROJECT' ? '프로젝트' : '일반'} · ${item.name}`] as [string, string])], String(selected ?? ''));
  field(parent, '문서 순서 (비우면 마지막)', 'order', String(order ?? ''), { type: 'number' }).min = '1';
  choice(parent, '관련 프로젝트', 'relatedSeriesId', [['', '없음'], ...data.series.filter(item => item.kind === 'PROJECT').map(item => [String(item.id), item.name] as [string, string])], String(related ?? ''));
}
function seriesMetadata(input: FormData, project: boolean) {
  return { name: value(input, 'name'), description: value(input, 'description'),
    ...(project ? { projectStatus: value(input, 'projectStatus'), startPeriod: value(input, 'startPeriod'),
      endPeriod: value(input, 'endPeriod') || null, stackBadgeNames: badgeNames(input) } : {}) };
}
function projectFields(parent: HTMLElement, badges: Badge[], item?: Series) {
  choice(parent, '상태', 'projectStatus', [['PLAN', '기획'], ['DEV', '개발'], ['MAINT', '유지보수'], ['DONE', '완료']], item?.projectStatus ?? 'PLAN');
  field(parent, '시작 기간', 'startPeriod', item?.startPeriod ?? '', { placeholder: 'YYYY.MM' });
  field(parent, '종료 기간', 'endPeriod', item?.endPeriod ?? '', { placeholder: 'YYYY.MM' });
  checkboxes(parent, '기술 뱃지', badges, item?.stackBadges.map(b => b.name) ?? []);
}
function renderSeries(data: AdminData) {
  const create = form(input => mutate('/admin/series', 'POST', {
    slug: value(input, 'slug'), kind: value(input, 'kind'), metadata: seriesMetadata(input, value(input, 'kind') === 'PROJECT'),
  }), '시리즈를 만들었습니다.');
  field(create, '이름', 'name', '', { required: true, max: 200 });
  field(create, '주소 slug', 'slug', '', { required: true, max: 160 });
  const kind = choice(create, '종류', 'kind', [['TECH', '일반'], ['PROJECT', '프로젝트']]);
  area(create, '설명', 'description', '', 1000);
  const project = el('fieldset', 'wide field-grid'); projectFields(project, data.badges); create.append(project);
  const toggle = () => { project.hidden = kind.value !== 'PROJECT'; project.disabled = project.hidden; };
  kind.addEventListener('change', toggle); toggle();
  submit(create, '시리즈 만들기'); get('series-create').replaceChildren(create);
  const list = get('series-list'); list.replaceChildren();
  if (!data.series.length) list.append(el('p', 'empty', '등록된 시리즈가 없습니다.'));
  for (const item of data.series) {
    const article = el('article', 'item'); article.append(itemHeading(item.name, `${item.kind === 'PROJECT' ? '프로젝트' : '일반'} · ${item.slug}`));
    const edit = form(input => mutate(`/admin/series/${item.id}/metadata`, 'PUT', {
      ...seriesMetadata(input, item.kind === 'PROJECT'), baseUpdatedAt: item.updatedAt,
    }), '시리즈 메타데이터를 저장했습니다.');
    field(edit, '이름', 'name', item.name, { required: true, max: 200 }); area(edit, '설명', 'description', item.description, 1000);
    if (item.kind === 'PROJECT') projectFields(edit, data.badges, item);
    submit(edit, '메타데이터 저장'); article.append(edit);
    const order = form(input => mutate(`/admin/series/${item.id}/order`, 'PUT', { order: Number(value(input, 'order')) }), '시리즈 순서를 저장했습니다.');
    field(order, '카드 순서', 'order', String(item.sortOrder), { type: 'number' }); submit(order, '순서 저장'); article.append(order);
    smallAction(article, '빈 시리즈 삭제', () => mutate(`/admin/series/${item.id}`, 'DELETE'), '시리즈를 삭제했습니다.', `${item.name} 시리즈를 삭제할까요? 연결된 글이 있으면 삭제할 수 없습니다.`);
    list.append(article);
  }
}
function renderBadges(data: AdminData) {
  const create = form(input => {
    const file = input.get('file');
    if (!(file instanceof File) || !file.size) throw new Error('PNG 파일을 선택하세요.');
    const body = new FormData(); body.set('name', value(input, 'name')); body.set('file', file);
    return mutate('/admin/stack-badges', 'POST', body);
  }, '기술 뱃지를 만들었습니다.');
  field(create, '이름', 'name', '', { required: true, max: 100 });
  const file = field(create, 'PNG 아이콘', 'file', '', { type: 'file' }); file.accept = 'image/png'; file.required = true;
  submit(create, '뱃지 만들기'); get('badge-create').replaceChildren(create);
  const list = get('badge-list'); list.replaceChildren();
  if (!data.badges.length) list.append(el('p', 'empty', '등록된 뱃지가 없습니다.'));
  for (const badge of data.badges) {
    const article = el('article', 'item'); article.append(itemHeading(badge.name, `${badge.projectCount ?? 0}개 프로젝트`));
    const rename = form(input => mutate(`/admin/stack-badges/${badge.id}`, 'PUT', { name: value(input, 'name') }), '뱃지 이름을 저장했습니다.');
    field(rename, '이름', 'name', badge.name, { required: true, max: 100 }); submit(rename, '이름 저장'); article.append(rename);
    const image = form(input => {
      const file = input.get('file');
      if (!(file instanceof File) || !file.size) throw new Error('PNG 파일을 선택하세요.');
      const body = new FormData(); body.set('file', file);
      return mutate(`/admin/stack-badges/${badge.id}/image`, 'POST', body);
    }, '뱃지 아이콘을 저장했습니다.');
    const file = field(image, 'PNG 아이콘 교체', 'file', '', { type: 'file' }); file.accept = 'image/png'; file.required = true;
    submit(image, '아이콘 교체'); article.append(image);
    smallAction(article, '뱃지 삭제', () => mutate(`/admin/stack-badges/${badge.id}`, 'DELETE'),
      '뱃지를 삭제했습니다.', `${badge.name} 뱃지를 삭제할까요?`);
    list.append(article);
  }
}
loginForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (!loginForm.reportValidity()) return;
  const button = loginForm.querySelector<HTMLButtonElement>('button[type=submit]');
  if (button) button.disabled = true;
  setMessage(loginMessage, '');
  let loginAccepted = false;
  try {
    const input = new FormData(loginForm);
    await refreshCsrf();
    await mutate('/auth/login', 'POST', {
      password: String(input.get('password') ?? ''),
      rememberMe: input.has('rememberMe'),
    });
    loginAccepted = true;
    csrf = null;
    await refreshCsrf();
    const user = await request<{ role: string }>('/auth/me');
    if (user.role !== 'ADMIN') throw new Error('관리자 권한이 없습니다.');
    sessionReady = true;
    await loadDashboard();
    loginForm.reset();
  } catch (error) {
    const message = error instanceof HttpError && error.status === 401
      ? loginAccepted ? '로그인 상태를 확인할 수 없습니다. 브라우저에서 사이트 간 쿠키를 허용한 뒤 다시 시도하세요.' : '비밀번호를 확인하세요.'
      : error instanceof HttpError && error.status === 403
        ? '로그인 요청이 거부되었습니다. 브라우저에서 사이트 간 쿠키를 허용하고 새로고침한 뒤 다시 시도하세요.'
        : error instanceof Error ? error.message : '로그인에 실패했습니다.';
    showLogin(message);
    loginForm.querySelectorAll<HTMLInputElement>('input[type=password]').forEach(input => { input.value = ''; });
  } finally { if (button) button.disabled = false; }
});
get('logout').addEventListener('click', async () => {
  try { await mutate('/auth/logout', 'POST'); showLogin(); }
  catch (error) {
    if (error instanceof HttpError && error.status === 401) showLogin();
    else setMessage(dashboardMessage, error instanceof Error ? error.message : '로그아웃에 실패했습니다.', true);
  }
});
async function bootAdmin() {
  try {
    const user = await request<{ role: string }>('/auth/me');
    if (user.role !== 'ADMIN') throw new Error('관리자 권한이 없습니다.');
    sessionReady = true;
    await refreshCsrf();
    await loadDashboard();
  } catch (error) {
    showLogin(error instanceof HttpError && error.status === 401 ? '' :
      error instanceof Error ? error.message : '관리자 연결에 실패했습니다.');
  }
}
void bootAdmin();
