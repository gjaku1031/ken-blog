import './style.css';

type Csrf = { headerName: string; token: string };
type Page<T> = { items: T[]; page: number; totalElements: number; totalPages: number };
type CategoryRef = { id: number; path: string; name: string; depth: number; sortOrder: number };
type Category = CategoryRef & { totalCount?: number; directCount: number; children: Category[] };
type SeriesRef = { id: number; name: string; slug: string; kind: 'TECH' | 'PROJECT' };
type Badge = { id: number; name: string; imageUrl: string };
type Series = { id: number; name: string; slug: string; kind: 'TECH' | 'PROJECT'; description: string; projectStatus: string | null; startPeriod: string | null; endPeriod: string | null; updatedAt: string; sortOrder: number; stackBadges: Badge[] };
type Post = { updatedAt: string; publishedAt: string | null; id: number; title: string; slug: string; section: 'TECH' | 'PROJECT'; status: 'DRAFT' | 'PUBLISHED'; visibility: 'PUBLIC' | 'PRIVATE'; summary: string; category: CategoryRef | null; tags: string[]; series: SeriesRef | null; seriesOrder: number | null; relatedSeriesId: number | null };
type PostDetail = Post & { attachmentIds: number[]; wikiTargets: string[] };
type AdminData = { posts: Page<Post>; series: Series[]; categories: Category[]; badges: Badge[] };

const root = document.documentElement;
let savedTheme: string | null = null;
try { savedTheme = localStorage.getItem('ken-blog-theme'); } catch { /* 저장소가 막혀도 화면은 사용할 수 있다. */ }
function setTheme(theme: string) {
  root.dataset.theme = theme;
  document.querySelector('[data-theme-toggle]')?.setAttribute('aria-pressed', String(theme === 'dark'));
  try { localStorage.setItem('ken-blog-theme', theme); } catch { /* 현재 화면의 테마는 유지한다. */ }
}
setTheme(savedTheme ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
document.querySelector('[data-theme-toggle]')?.addEventListener('click', () => setTheme(root.dataset.theme === 'dark' ? 'light' : 'dark'));

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
const editorMode = document.body.dataset.editor ?? '';
const dialog = get('edit-dialog') as HTMLDialogElement;
let latestData: AdminData;
let selectedProject: number | null = null;
get('dialog-close').addEventListener('click', () => dialog.close());
function openDialog(title: string, content: HTMLElement) {
  get('dialog-title').textContent = title;
  get('dialog-content').replaceChildren(content);
  setMessage(get('dialog-message'), '');
  dialog.showModal();
}
function selectPanel() {
  const name = ['posts', 'categories', 'series', 'deployment'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'posts';
  document.querySelectorAll<HTMLElement>('[data-panel]').forEach(panel => { panel.hidden = panel.id !== name; });
  document.querySelectorAll<HTMLElement>('[data-panel-link]').forEach(link => {
    if (link.dataset.panelLink === name) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
}
window.addEventListener('hashchange', selectPanel);
selectPanel();

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
  for (const id of ['post-list', 'post-pages', 'category-create', 'category-list', 'series-create', 'series-list', 'editor-content', 'dialog-content']) document.getElementById(id)?.replaceChildren();
  dialog.close();
}
function showLogin(message = '') {
  sessionReady = false;
  get('logout').hidden = true;
  csrf = null;
  clearDashboard();
  boot.hidden = true;
  dashboard.hidden = true;
  login.hidden = false;
  setMessage(loginMessage, message, !!message);
}
function showDashboard() {
  get('logout').hidden = false;
  boot.hidden = true;
  login.hidden = true;
  dashboard.hidden = false;
  setMessage(loginMessage, '');
}
class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
async function request<T>(path: string, method = 'GET', body?: object): Promise<T> {
  if (!apiBase) throw new Error('관리자 연결 주소가 설정되지 않았습니다.');
  const headers = new Headers({ Accept: 'application/json' });
  if (method !== 'GET') {
    if (!csrf) await refreshCsrf();
    if (csrf) headers.set(csrf.headerName, csrf.token);
  }
  if (body) headers.set('Content-Type', 'application/json');
  let response: Response;
  try {
    response = await fetch(new URL('/api/v1' + path, apiBase), {
      method, headers, credentials: 'include', cache: 'no-store', redirect: 'error',
      body: body ? JSON.stringify(body) : undefined,
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
async function mutate<T>(path: string, method: string, body?: object): Promise<T> {
  try { return await request<T>(path, method, body); }
  catch (error) {
    if (error instanceof HttpError && error.status === 403) csrf = null;
    throw error;
  }
}
async function action(operation: () => Promise<unknown>, success: string) {
  const message = dialog.open ? get('dialog-message') : dashboardMessage;
  setMessage(message, '');
  try {
    await operation();
    if (dialog.open) dialog.close();
    await loadDashboard();
    setMessage(dashboardMessage, success);
  } catch (error) {
    if (error instanceof HttpError && error.status === 401) showLogin(error.message);
    else setMessage(dialog.open ? message : dashboardMessage, error instanceof Error ? error.message : '요청에 실패했습니다.', true);
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
function choice(form: HTMLElement, title: string, name: string, options: Array<[string, string]>, value = options[0]?.[0] ?? '') {
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
let pickerId = 0;
function stackPicker(parent: HTMLElement, badges: Badge[], initial: string[] = []) {
  const group = el('fieldset', 'wide stack-picker');
  group.append(el('legend', '', '기술 스택'));
  let selected = [...initial];
  const chips = el('div', 'stack-chips');
  const input = el('input', 'stack-search');
  input.type = 'search'; input.placeholder = '기술 스택 검색'; input.autocomplete = 'off';
  input.setAttribute('aria-label', '기술 스택 검색'); input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list'); input.setAttribute('aria-expanded', 'false');
  const list = el('div', 'stack-options'); list.id = `stack-options-${++pickerId}`;
  list.setAttribute('role', 'listbox'); list.setAttribute('aria-label', '등록된 기술 스택'); list.hidden = true;
  input.setAttribute('aria-controls', list.id);
  const values = el('div');
  let active = -1;
  function icon(badge: Badge) {
    const image = el('img'); image.src = new URL(`/api/v1/stack-badges/${badge.id}/image`, apiBase).href;
    image.width = 20; image.height = 20; image.alt = ''; image.addEventListener('error', () => { image.hidden = true; });
    return image;
  }
  function close() { list.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); active = -1; }
  function options() {
    list.replaceChildren(); active = -1; input.removeAttribute('aria-activedescendant');
    const matches = badges.filter(b => !selected.includes(b.name) && b.name.toLocaleLowerCase().includes(input.value.trim().toLocaleLowerCase()));
    for (const badge of matches) {
      const option = el('button', 'stack-option'); option.type = 'button'; option.tabIndex = -1;
      option.id = `${list.id}-${badge.id}`; option.setAttribute('role', 'option'); option.setAttribute('aria-selected', 'false');
      option.append(icon(badge), document.createTextNode(badge.name));
      option.addEventListener('mousedown', event => event.preventDefault());
      option.addEventListener('click', () => {
        if (selected.length >= 30) return;
        selected.push(badge.name); input.value = ''; render(); input.focus(); options();
      }); list.append(option);
    }
    if (!matches.length) list.append(el('p', 'stack-empty', badges.length ? '선택할 기술 스택이 없습니다.' : '등록된 기술 스택이 없습니다.'));
    if (selected.length >= 30) list.replaceChildren(el('p', 'stack-empty', '기술 스택은 최대 30개까지 선택할 수 있습니다.'));
    list.hidden = false; input.setAttribute('aria-expanded', 'true');
  }
  function render() {
    chips.replaceChildren(); values.replaceChildren();
    for (const name of selected) {
      const chip = el('span', 'stack-chip');
      const badge = badges.find(b => b.name === name); if (badge) chip.append(icon(badge));
      chip.append(document.createTextNode(name));
      const remove = el('button', 'chip-remove', '×'); remove.type = 'button'; remove.setAttribute('aria-label', `${name} 선택 해제`);
      remove.addEventListener('click', () => { selected = selected.filter(item => item !== name); render(); input.focus(); options(); });
      chip.append(remove); chips.append(chip);
      const hidden = el('input'); hidden.type = 'hidden'; hidden.name = 'stackBadgeNames'; hidden.value = name; values.append(hidden);
    }
  }
  input.addEventListener('focus', options); input.addEventListener('input', options);
  input.addEventListener('keydown', event => {
    if (event.isComposing) return;
    if (event.key === 'Escape' && !list.hidden) { event.preventDefault(); event.stopPropagation(); close(); return; }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault(); if (list.hidden) options();
      const buttons = [...list.querySelectorAll<HTMLButtonElement>('button')];
      if (!buttons.length) return;
      active = (active + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      buttons.forEach((button, index) => button.setAttribute('aria-selected', String(index === active)));
      input.setAttribute('aria-activedescendant', buttons[active].id); buttons[active].scrollIntoView({ block: 'nearest' });
    } else if (event.key === 'Enter') {
      event.preventDefault(); if (!list.hidden && active >= 0) list.querySelectorAll<HTMLButtonElement>('button')[active]?.click();
    }
  });
  group.addEventListener('focusout', event => { if (!(event.relatedTarget instanceof Node) || !group.contains(event.relatedTarget)) close(); });
  group.append(chips, input, list, values); parent.append(group); render();
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
    request<Page<Post>>(`/admin/posts?page=${postPage}&size=10`),
    request<Series[]>('/admin/series'),
    request<Category[]>('/admin/categories'),
    request<Badge[]>('/admin/stack-badges'),
  ]);
  if (!sessionReady) return;
  render({ posts: data[0], series: data[1], categories: data[2], badges: data[3] });
  showDashboard();
}
function render(data: AdminData) {
  latestData = data;
  if (editorMode) renderEditor(data);
  else { renderPosts(data); renderCategories(data); renderSeries(data); }
}
function renderPosts(data: AdminData) {
  get('post-count').textContent = `전체 ${data.posts.totalElements}`;
  const list = get('post-list'); list.replaceChildren();
  if (!data.posts.items.length) list.append(el('p', 'empty', '등록된 글이 없습니다.'));
  else {
    const table = el('table', 'admin-table');
    const head = el('thead'); const labels = el('tr');
    for (const title of ['제목', '섹션', '상태', '수정일', '관리']) { const cell = el('th', '', title); cell.scope = 'col'; labels.append(cell); }
    head.append(labels); table.append(head);
    const body = el('tbody');
    for (const post of data.posts.items) {
      const row = el('tr'); const title = el('td', 'post-title');
      const editLink = el('button', 'title-button', post.title); editLink.type = 'button';
      editLink.addEventListener('click', () => editPost(post, data)); title.append(editLink);
      title.append(el('small', 'muted', [post.category?.path, post.series?.name].filter(Boolean).join(' · ') || `/${post.slug}`));
      const section = el('td', 'muted', post.section === 'PROJECT' ? 'Projects' : 'Posts'); section.dataset.label = '섹션';
      const state = el('td'); state.dataset.label = '상태';
      state.append(el('span', `status ${post.status === 'PUBLISHED' ? 'published' : ''}`, post.status === 'PUBLISHED' ? post.visibility === 'PUBLIC' ? '공개 발행' : '비공개 발행' : '미발행'));
      const date = el('td', 'mono muted', post.updatedAt.slice(0, 10).replaceAll('-', '.')); date.dataset.label = '수정일';
      const actions = el('td', 'row-actions');
      const edit = el('button', 'text-button', '수정'); edit.type = 'button'; edit.addEventListener('click', () => editPost(post, data)); actions.append(edit);
      const published = post.status === 'PUBLISHED';
      smallAction(actions, published ? '발행 취소' : '발행', () => mutate(`/admin/posts/${post.id}/publication`, 'PUT', { published: !published }), published ? '발행을 취소했습니다.' : '발행했습니다.', published ? '이 글의 발행을 취소할까요?' : '저장소 Markdown 원고를 확인하고 이 글을 발행할까요?');
      row.append(title, section, state, date, actions); body.append(row);
    }
    table.append(body); list.append(table);
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
function editPost(post: Post, data: AdminData) {
  const content = el('div');
  content.append(el('p', 'source-path mono', `content/posts/${post.slug}.md`));
  const edit = form(input => mutate(`/admin/posts/${post.id}/metadata`, 'PATCH', {
    title: value(input, 'title'), summary: value(input, 'summary'),
    categoryId: optionalNumber(input, 'categoryId'), tags: tags(input),
  }), '글 메타데이터를 저장했습니다.');
  field(edit, '제목', 'title', post.title, { required: true, max: 200 });
  field(edit, '요약', 'summary', post.summary, { max: 120 });
  choice(edit, '분류', 'categoryId', categoryOptions(data.categories), String(post.category?.id ?? ''));
  field(edit, '태그 (쉼표 구분)', 'tags', post.tags.join(', '));
  submit(edit, '메타데이터 저장'); content.append(edit);
  const membership = form(input => mutate(`/admin/posts/${post.id}/series`, 'PUT', {
    seriesId: optionalNumber(input, 'seriesId'), relatedSeriesId: optionalNumber(input, 'relatedSeriesId'), order: optionalNumber(input, 'order'),
  }), '시리즈와 문서 순서를 저장했습니다.');
  seriesFields(membership, data, post.series?.id ?? null, post.seriesOrder, post.relatedSeriesId);
  submit(membership, '시리즈·순서 저장'); content.append(membership);
  content.append(postDeclarations(post));

  openDialog('글 수정', content);
}

function renderEditor(data: AdminData) {
  const container = get('editor-content');
  if (container.childElementCount) {
    const select = container.querySelector<HTMLSelectElement>('select[name=seriesId]');
    if (select && editorMode === 'project') {
      const current = selectedProject ? String(selectedProject) : select.value;
      select.replaceChildren();
      for (const [key, title] of [['', '프로젝트 선택'], ...data.series.filter(item => item.kind === 'PROJECT').map(item => [String(item.id), item.name])]) {
        const option = el('option', '', title); option.value = key; select.append(option);
      }
      select.value = current; selectedProject = null;
    }
    return;
  }
  const create = form(async input => {
    const post = await mutate<Post>('/admin/posts', 'POST', {
      title: value(input, 'title'), summary: value(input, 'summary'),
      categoryId: optionalNumber(input, 'categoryId'), tags: tags(input),
      seriesId: optionalNumber(input, 'seriesId'), relatedSeriesId: optionalNumber(input, 'relatedSeriesId'), order: optionalNumber(input, 'order'),
    });
    const done = el('div', 'creation-complete');
    done.append(el('h2', '', '글 정보가 저장되었습니다.'), el('p', '', post.title), el('p', 'source-path mono', `content/posts/${post.slug}.md`));
    const back = el('a', 'button primary', '목록으로'); back.href = `/ken-blog/${editorMode === 'project' ? 'projects' : 'posts'}/`;
    const manage = el('a', 'button ghost', '글 관리'); manage.href = '/ken-blog/manage/#posts'; done.append(back, manage);
    container.replaceChildren(done);
  }, '미발행 글로 저장했습니다.');
  field(create, '제목', 'title', '', { required: true, max: 200, wide: true });
  area(create, '요약', 'summary', '', 120);
  choice(create, '분류', 'categoryId', categoryOptions(data.categories));
  field(create, '태그 (쉼표 구분)', 'tags');
  const project = editorMode === 'project';
  const select = choice(create, project ? '프로젝트' : '시리즈', 'seriesId', [['', project ? '프로젝트 선택' : '없음'], ...data.series.filter(item => item.kind === (project ? 'PROJECT' : 'TECH')).map(item => [String(item.id), item.name] as [string, string])]);
  select.required = project;
  field(create, '문서 순서 (비우면 마지막)', 'order', '', { type: 'number' }).min = '1';
  if (project) {
    const add = el('button', 'text-button new-project', '+ 새 프로젝트'); add.type = 'button';
    add.addEventListener('click', () => openDialog('새 프로젝트', createSeriesForm(latestData, true))); create.append(add);
  } else choice(create, '관련 프로젝트', 'relatedSeriesId', [['', '없음'], ...data.series.filter(item => item.kind === 'PROJECT').map(item => [String(item.id), item.name] as [string, string])]);
  submit(create, '글 정보 저장'); container.append(create);
}

/** 목록에는 없는 선언 관계는 펼칠 때 상세 API로 조회. */
function postDeclarations(post: Post): HTMLDetailsElement {
  const panel = el('details', 'declarations');
  panel.append(el('summary', '', '첨부·위키 연결'));
  const content = el('div');
  panel.append(content);
  let loaded = false;
  let loading = false;
  const load = async () => {
    if (!panel.open || loaded || loading) return;
    loading = true;
    content.replaceChildren(el('p', 'muted', '연결 정보를 읽는 중입니다.'));
    try {
      const detail = await request<PostDetail>(`/admin/posts/${post.id}`);
      if (!panel.isConnected || !sessionReady) return;
      const attachments = form(input => {
        const values = value(input, 'attachmentIds').split(/[\s,]+/).filter(Boolean);
        const ids = values.map(Number);
        if (values.length > 100 || values.some((raw, i) => !/^[0-9]+$/.test(raw) || !Number.isSafeInteger(ids[i]) || ids[i] <= 0))
          throw new Error('첨부 ID는 양의 정수로 최대 100개까지 입력하세요.');
        return mutate(`/admin/posts/${post.id}/attachments`, 'PUT', { attachmentIds: ids });
      }, '첨부 연결을 저장했습니다.');
      field(attachments, '첨부 ID (쉼표 구분)', 'attachmentIds', detail.attachmentIds.join(', '), { wide: true });
      attachments.append(el('p', 'wide muted', '등록된 이미지의 ID를 입력하세요. 비우고 저장하면 이 글의 연결만 해제됩니다.'));
      submit(attachments, '첨부 연결 저장');
      const wiki = form(input => mutate(`/admin/posts/${post.id}/wiki-links`, 'PUT', {
        wikiTargets: value(input, 'wikiTargets').split('\n').map(title => title.trim()).filter(Boolean),
      }), '위키 연결을 저장했습니다.');
      area(wiki, '위키 대상 제목 (한 줄에 하나)', 'wikiTargets', detail.wikiTargets.join('\n'), 26000);
      wiki.append(el('p', 'wide muted', '최대 128개 제목을 입력하세요. 본문의 [[제목]]과 함께 맞춰야 하며, 이 저장은 원고 파일을 바꾸지 않습니다.'));
      submit(wiki, '위키 연결 저장');
      content.replaceChildren(attachments, wiki);
      loaded = true;
    } catch (error) {
      if (error instanceof HttpError && error.status === 401) { showLogin(error.message); return; }
      const notice = el('p', 'notice error', error instanceof Error ? error.message : '연결 정보를 읽지 못했습니다.');
      notice.setAttribute('role', 'alert');
      const retry = el('button', 'button ghost', '다시 시도');
      retry.type = 'button'; retry.addEventListener('click', () => { void load(); });
      content.replaceChildren(notice, retry);
    } finally { loading = false; }
  };
  panel.addEventListener('toggle', () => { void load(); });
  return panel;
}
const collapsedCategories = new Set<number>();
function renderCategories(data: AdminData) {
  get('category-create').replaceChildren();
  const list = get('category-list'); list.replaceChildren();
  const addCategory = (parent: Category | null) => {
    const create = form(input => mutate('/admin/categories', 'POST', {
      path: [parent?.path, value(input, 'name')].filter(Boolean).join('/'),
    }), '분류를 만들었습니다.');
    if (parent) create.append(el('p', 'wide category-parent', parent.path.replaceAll('/', ' › ')));
    const name = field(create, '분류 이름', 'name', '', { required: true, wide: true });
    name.pattern = '[^/]+?';
    submit(create, '추가'); openDialog(parent ? '하위 분류 추가' : '새 대분류', create);
  };
  const editCategory = (category: Category) => {
    const content = el('div');
    content.append(el('p', 'category-parent', category.path.replaceAll('/', ' › ')));
    const order = form(input => mutate(`/admin/categories/${category.id}/order`, 'PUT', { order: Number(value(input, 'order')) }), '분류 순서를 저장했습니다.');
    field(order, '순서', 'order', String(category.sortOrder), { type: 'number', required: true });
    submit(order, '순서 저장'); content.append(order);
    const actions = el('div', 'category-dialog-actions');
    smallAction(actions, '분류 삭제', () => mutate(`/admin/categories/${category.id}`, 'DELETE'), '분류를 삭제했습니다.',
      `${category.path} 분류를 삭제할까요? 글은 상위 분류로 이동합니다.`);
    content.append(actions); openDialog('분류 관리', content);
  };
  const count = (category: Category): number => category.totalCount ?? category.directCount + category.children.reduce((sum, child) => sum + count(child), 0);
  const addButton = (parent: Category | null) => {
    const depth = parent?.depth ?? 0;
    const button = el('button', 'category-add', `＋ 새 ${['대', '중', '소'][depth]}분류`); button.type = 'button';
    button.addEventListener('click', () => addCategory(parent)); return button;
  };
  const tree = (categories: Category[], parent: Category | null): HTMLUListElement => {
    const ul = el('ul', 'admin-category-tree');
    for (const category of categories) {
      const li = el('li');
      const row = el('div', 'admin-category-line');
      const children = category.depth < 3 ? tree(category.children, category) : null;
      const toggle = el('button', 'category-expand'); toggle.type = 'button';
      if (children) {
        children.id = `category-children-${category.id}`;
        children.hidden = collapsedCategories.has(category.id);
        toggle.textContent = '›';
        toggle.setAttribute('aria-controls', children.id);
        toggle.setAttribute('aria-expanded', String(!children.hidden));
        toggle.setAttribute('aria-label', `${category.name} 하위 분류`);
        toggle.addEventListener('click', () => {
          children.hidden = !children.hidden;
          if (children.hidden) collapsedCategories.add(category.id); else collapsedCategories.delete(category.id);
          toggle.setAttribute('aria-expanded', String(!children.hidden));
        });
        row.append(toggle);
      } else row.append(el('span', 'category-expand-spacer'));
      const name = el('button', 'category-name'); name.type = 'button';
      name.setAttribute('aria-label', `${category.path} 분류 관리`);
      const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      icon.setAttribute('viewBox', '0 0 20 20'); icon.setAttribute('width', '15'); icon.setAttribute('height', '15'); icon.setAttribute('aria-hidden', 'true');
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', 'M3 5h5l2 2h7v9H3Z'); path.setAttribute('fill', 'none'); path.setAttribute('stroke', 'currentColor'); path.setAttribute('stroke-linejoin', 'round'); icon.append(path);
      name.append(icon, document.createTextNode(category.name)); name.addEventListener('click', () => editCategory(category));
      const total = el('span', 'category-total mono', String(count(category))); total.setAttribute('aria-label', `${count(category)}개 글`);
      row.append(name, total); li.append(row); if (children) li.append(children); ul.append(li);
    }
    const add = el('li', 'category-add-row'); add.append(addButton(parent)); ul.append(add); return ul;
  };
  list.append(tree(data.categories, null));
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
  const start = field(parent, '시작 기간', 'startPeriod', item?.startPeriod ?? '', { required: true, placeholder: 'YYYY.MM', max: 7 });
  start.pattern = '[0-9]{4}\\.(0[1-9]|1[0-2])';
  const end = field(parent, '종료 기간', 'endPeriod', item?.endPeriod ?? '', { placeholder: 'YYYY.MM', max: 7 });
  end.pattern = start.pattern;
  stackPicker(parent, badges, item?.stackBadges.map(b => b.name) ?? []);
}
function createSeriesForm(data: AdminData, project: boolean) {
  const create = form(async input => {
    const created = await mutate<Series>('/admin/series', 'POST', {
      kind: project ? 'PROJECT' : 'TECH', metadata: seriesMetadata(input, project),
    });
    if (project) selectedProject = created.id;
  }, project ? '프로젝트를 만들었습니다.' : '시리즈를 만들었습니다.');
  field(create, '이름', 'name', '', { required: true, max: 200, wide: true });
  area(create, '개요', 'description', '', 1000);
  if (project) projectFields(create, data.badges);
  submit(create, project ? '프로젝트 만들기' : '시리즈 만들기'); return create;
}
function renderSeries(data: AdminData) {
  const add = el('button', 'button ghost', '+ 시리즈'); add.type = 'button';
  add.addEventListener('click', () => openDialog('새 시리즈', createSeriesForm(data, false)));
  get('series-create').replaceChildren(add);
  const list = get('series-list'); list.replaceChildren();
  if (!data.series.length) list.append(el('p', 'empty', '등록된 시리즈가 없습니다.'));
  for (const item of data.series) {
    const article = el('article', 'item series-row');
    const info = el('div'); info.append(itemHeading(item.name, item.kind === 'PROJECT' ? 'Projects' : 'Posts'));
    if (item.description) info.append(el('p', 'muted', item.description));
    if (item.stackBadges.length) { const stacks = el('div', 'stack-chips'); for (const badge of item.stackBadges) stacks.append(el('span', 'stack-chip', badge.name)); info.append(stacks); }
    const button = el('button', 'text-button', '수정'); button.type = 'button';
    button.addEventListener('click', () => {
      const content = el('div');
      const edit = form(input => mutate(`/admin/series/${item.id}/metadata`, 'PUT', {
        ...seriesMetadata(input, item.kind === 'PROJECT'), baseUpdatedAt: item.updatedAt,
      }), '시리즈 메타데이터를 저장했습니다.');
      field(edit, '이름', 'name', item.name, { required: true, max: 200, wide: true }); area(edit, '개요', 'description', item.description, 1000);
      if (item.kind === 'PROJECT') projectFields(edit, data.badges, item);
      submit(edit, '저장'); content.append(edit);
      const order = form(input => mutate(`/admin/series/${item.id}/order`, 'PUT', { order: Number(value(input, 'order')) }), '시리즈 순서를 저장했습니다.');
      field(order, '카드 순서', 'order', String(item.sortOrder), { type: 'number' }); submit(order, '순서 저장'); content.append(order);
      smallAction(content, '빈 시리즈 삭제', () => mutate(`/admin/series/${item.id}`, 'DELETE'), '시리즈를 삭제했습니다.', `${item.name} 시리즈를 삭제할까요? 연결된 글이 있으면 삭제할 수 없습니다.`);
      openDialog(item.kind === 'PROJECT' ? '프로젝트 수정' : '시리즈 수정', content);
    });
    article.append(info, button); list.append(article);
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
