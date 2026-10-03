import "../shared/theme.css";
import "../shared/stack-icons.css";
import './style.css';
import '../shared/header.css';
import '../shared/forms.css';
import '../shared/category-tree.css';
import { connectHeader, updateHeaderSession } from '../shared/header';
import { request, mutate, refreshCsrf, clearCsrf, HttpError } from '../shared/admin-api';
import { el, setMessage, field, submit, value, stackIcon, type Badge } from '../shared/forms';
import { seriesEditor, type Series } from '../shared/series-editor';
import { deploymentManifest, readDeploymentManifest, deploymentState, filterPosts, type DeploymentComparison, type PostFilter } from '../shared/deployment-status';
import { postEditor } from '../shared/post-editor';
import { postFields, postPayload, type Category, type Tag } from '../shared/post-fields';

/**
 * 페이지 조회 결과
 */
type Page<T> = {
  /**
   * 조회 결과 목록
   */
  items: T[];

  /**
   * 0 기반 페이지 번호
   */
  page: number;

  /**
   * 전체 결과 수
   */
  totalElements: number;

  /**
   * 전체 페이지 수
   */
  totalPages: number
};

/**
 * 분류 참조
 */
type CategoryRef = {
  /**
   * ID
   */
  id: number;

  /**
   * 분류 경로
   */
  path: string;

  /**
   * 이름
   */
  name: string;

  /**
   * 분류 깊이
   */
  depth: number;

  /**
   * 정렬 순서
   */
  sortOrder: number
};

/**
 * 시리즈 참조
 */
type SeriesRef = {
  /**
   * ID
   */
  id: number;

  /**
   * 이름
   */
  name: string;

  /**
   * 공개 주소 식별자
   */
  slug: string;

  /**
   * 시리즈 종류
   */
  kind: 'TECH' | 'PROJECT'
};

/**
 * 게시글 메타데이터
 */
type Post = {
  /**
   * 수정 시각
   */
  updatedAt: string;

  /**
   * 최초 출간 시각
   */
  publishedAt: string | null;

  /**
   * ID
   */
  id: number;

  /**
   * 제목
   */
  title: string;

  /**
   * 공개 주소 식별자
   */
  slug: string;

  /**
   * 탐색 구획
   */
  section: 'TECH' | 'PROJECT';

  /**
   * 상태
   */
  status: 'DRAFT' | 'PUBLISHED';

  /**
   * 공개 범위
   */
  visibility: 'PUBLIC' | 'PRIVATE';

  /**
   * 요약
   */
  summary: string;

  /**
   * 분류
   */
  category: CategoryRef | null;

  /**
   * 태그 목록
   */
  tags: string[];

  /**
   * 시리즈
   */
  series: SeriesRef | null;

  /**
   * 시리즈 내 정렬 순서
   */
  seriesOrder: number | null;

  /**
   * 관련 프로젝트 시리즈 ID
   */
  relatedSeriesId: number | null
};

/**
 * 게시글 상세와 첨부·위키 선언
 */
type PostDetail = Post & {
  /**
   * 첨부 ID 목록
   */
  attachmentIds: number[];

  /**
   * 위키 대상 제목 목록
   */
  wikiTargets: string[]
};

/**
 * 관리자 화면 조회 데이터
 */
type AdminData = {
  /**
   * 게시글 목록
   */
  posts: Post[];

  /**
   * 현재 공개 내용과 서비스 중인 배포의 비교, 조회 실패 시 null
   */
  deployment: DeploymentComparison | null;

  /**
   * 시리즈
   */
  series: Series[];

  /**
   * 분류 목록
   */
  categories: Category[];

  /**
   * 기술 목록
   */
  badges: Badge[];

  /**
   * 태그 목록
   */
  tags: Tag[]
};

/**
 * 초기화 상태 영역
 */
const boot = get('boot');

/**
 * 로그인 화면
 */
const login = get('login');

/**
 * 관리자 화면
 */
const dashboard = get('dashboard');

/**
 * 로그인 결과 메시지 영역
 */
const loginMessage = get('login-message');

/**
 * 관리자 작업 결과 메시지 영역
 */
const dashboardMessage = get('dashboard-message');

/**
 * 로그인 폼
 */
const loginForm = get('login-form') as HTMLFormElement;

/**
 * 현재 글 목록 페이지
 */
let postPage = 0;

/**
 * 전체 글에 적용하는 상태 필터
 */
let postFilter: PostFilter = 'all';

/**
 * 로그아웃·새 조회 이후 도착한 응답을 폐기하는 세대
 */
let dashboardGeneration = 0;

/**
 * 자동 갱신 중복 실행 차단
 */
let refreshingStatus = false;

/**
 * 관리자 세션 확인 여부
 */
let sessionReady = false;

/**
 * 요청한 편집 화면 종류
 */
const editorMode = document.body.dataset.editor ?? '';

/**
 * 메타데이터 편집 대화상자
 */
const dialog = get('edit-dialog') as HTMLDialogElement;

/**
 * 마지막 관리자 조회 결과
 */
let latestData: AdminData;

/**
 * 편집 대상으로 선택한 프로젝트 ID
 */
let selectedProject: number | null = null;

/**
 * URL로 지정한 편집기를 아직 열지 않았는지 여부
 */
let linkedEditorPending = true;
get('dialog-close').addEventListener('click', () => dialog.close());

/**
 * 제목·내용을 설정하고 편집 대화상자 열기
 */
function openDialog(title: string, content: HTMLElement) {
  get('dialog-title').textContent = title;
  get('dialog-content').replaceChildren(content);
  setMessage(get('dialog-message'), '');
  dialog.classList.toggle('project-edit-dialog', !!content.querySelector('.project-form-columns'));
  dialog.showModal();
}

/**
 * 선택한 관리 구간과 탐색 상태 표시
 */
function selectPanel() {
  const name = ['posts', 'categories', 'series'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'posts';
  document.querySelectorAll<HTMLElement>('[data-panel]').forEach(panel => { panel.hidden = panel.id !== name; });
  document.querySelectorAll<HTMLElement>('[data-panel-link]').forEach(link => {
    if (link.dataset.panelLink === name) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
}
window.addEventListener('hashchange', selectPanel);
selectPanel();

/**
 * 필수 DOM 요소 조회, 없으면 초기화 실패
 */
function get(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (!found) throw new Error(`화면 요소 누락: ${id}`);
  return found;
}

/**
 * 관리자 목록과 결과 메시지 비움
 */
function clearDashboard() {
  dashboardGeneration++;
  for (const id of ['post-list', 'post-pages', 'category-create', 'category-list', 'series-create', 'series-list', 'editor-content', 'dialog-content']) document.getElementById(id)?.replaceChildren();
  dialog.close();
}

/**
 * 관리자 상태를 비우고 로그인 화면 표시
 */
function showLogin(message = '') {
  sessionReady = false;
  updateHeaderSession(false);
  clearCsrf();
  clearDashboard();
  boot.hidden = true;
  dashboard.hidden = true;
  login.hidden = false;
  setMessage(loginMessage, message, !!message);
}

/**
 * 인증 후 관리자 화면 표시
 */
function showDashboard() {
  updateHeaderSession(true);
  boot.hidden = true;
  login.hidden = true;
  dashboard.hidden = false;
  setMessage(loginMessage, '');
}

/**
 * 관리 작업 수행 후 목록 갱신·결과 표시, 세션 만료 시 로그인 전환
 */
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

/**
 * 제출 데이터를 비동기 작업에 연결한 폼 생성
 *
 * 1. 유효한 입력만 제출하고 처리 중 중복 제출 차단
 * 2. 성공·실패 표시 후 제출 버튼 복구
 */
function form(onSubmit: (data: FormData) => Promise<unknown>, success: string): HTMLFormElement {
  const item = el('form', 'field-grid');
  // 유효한 입력만 제출하고 처리 중 중복 제출 차단
  item.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!item.reportValidity()) return;
    const button = item.querySelector<HTMLButtonElement>('button[type=submit]');
    if (button) button.disabled = true;
    // 성공·실패 표시 후 제출 버튼 복구
    await action(() => onSubmit(new FormData(item)), success);
    if (button) button.disabled = false;
  });
  return item;
}

/**
 * 목록 항목의 제목·보조 설명 생성
 */
function itemHeading(title: string, detail = '') {
  const heading = el('div', 'item-title');
  heading.append(el('h3', '', title));
  if (detail) heading.append(el('span', 'pill', detail));
  return heading;
}

/**
 * 비동기 관리 동작을 연결한 버튼 생성
 */
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
  return button;
}

/**
 * 모든 관리자 페이지를 수집한 뒤 필터링할 글 목록 반환
 */
async function allPosts(): Promise<Post[]> {
  const result: Post[] = [];
  let page = 0;
  do {
    const data = await request<Page<Post>>(`/admin/posts?page=${page++}&size=100`);
    result.push(...data.items);
    if (page >= data.totalPages) return Array.from(new Map(result.map(post => [post.id, post])).values());
  } while (page < 10_000);
  throw new Error('글 목록이 너무 많아 전체 상태를 확인하지 못했습니다.');
}

/**
 * 실제 서비스 중인 정적 기록과 현재 공개 스냅샷을 캐시 없이 비교
 * 한쪽이라도 실패하면 배포 완료로 표시하지 않음
 */
async function loadDeployment(): Promise<DeploymentComparison | null> {
  try {
    const [response, snapshotResponse] = await Promise.all([
      fetch(`/ken-blog/deployment.json?check=${Date.now()}`, { cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(15_000) }),
      fetch(new URL('/api/v1/pages/snapshot', document.body.dataset.apiBase), { cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(15_000) }),
    ]);
    if (!response.ok || !snapshotResponse.ok) return null;
    return { deployed: readDeploymentManifest(await response.json()), current: await deploymentManifest(await snapshotResponse.json()) };
  } catch { return null; /* 비교 실패는 별도 안내하고 편집·미발행 필터는 계속 제공 */ }
}

/**
 * 글·시리즈·분류·기술 조회 후 관리자 화면 갱신
 *
 * 1. 글·시리즈·분류·기술·태그 병렬 조회
 * 2. 세션 유지 시 화면 갱신
 * 3. 상세 페이지에서 지정한 편집 대상도 최신 정보로 열기
 */
async function loadDashboard() {
  if (!sessionReady) return;
  // 글·시리즈·분류·기술·태그 병렬 조회
  const generation = ++dashboardGeneration;
  const data = await Promise.all([
    allPosts(),
    request<Series[]>('/admin/series'),
    request<Category[]>('/admin/categories'),
    request<Badge[]>('/admin/stack-badges'),
    request<Tag[]>('/admin/tags'),
    loadDeployment(),
  ]);
  if (!sessionReady || generation !== dashboardGeneration) return;
  // 세션 유지 시 화면 갱신
  render({ posts: data[0], series: data[1], categories: data[2], badges: data[3], tags: data[4], deployment: data[5] });
  showDashboard();
  // 상세 페이지에서 지정한 편집 대상도 최신 정보로 열기
  await openLinkedEditor(latestData);
}

/**
 * 상세 페이지에서 지정한 항목을 목록 페이지와 관계없이 최신 메타데이터로 엶
 *
 * 1. 편집 전용 화면·재진입·비인증 요청 제외
 * 2. URL의 단일 글·프로젝트 ID 검사
 * 3. 대상 최신 상세를 조회해 글 또는 프로젝트 편집 폼 열기
 * 4. 처리한 ID를 URL에서 제거하고 관리 패널 선택
 * 5. 세션 만료 시 로그인 후 재시도할 수 있도록 대기 상태 복원
 */
async function openLinkedEditor(data: AdminData): Promise<void> {
  // 편집 전용 화면·재진입·비인증 요청 제외
  if (editorMode || !linkedEditorPending || !sessionReady) return;
  linkedEditorPending = false;
  const url = new URL(location.href);
  // URL의 단일 글·프로젝트 ID 검사
  const keys = ['post', 'project'].filter(key => url.searchParams.has(key));
  if (!keys.length) return;
  try {
    const key = keys[0];
    const values = url.searchParams.getAll(key);
    const id = values[0];
    if (keys.length !== 1 || values.length !== 1 || !/^[1-9][0-9]*$/.test(id) || !Number.isSafeInteger(Number(id)))
      throw new Error('수정할 항목의 주소가 올바르지 않습니다.');
    // 대상 최신 상세를 조회해 글 또는 프로젝트 편집 폼 열기
    if (key === 'post') {
      const post = await request<PostDetail>(`/admin/posts/${id}`);
      if (!sessionReady) return;
      editPost(post, data);
    } else {
      const { series } = await request<{
        /**
         * 시리즈
         */
        series: Series
      }>(`/admin/series/${id}`);
      if (!sessionReady) return;
      if (series.kind !== 'PROJECT') throw new Error('프로젝트를 찾을 수 없습니다.');
      openDialog('프로젝트 수정', createSeriesForm(data, true, series));
    }
    // 처리한 ID를 URL에서 제거하고 관리 패널 선택
    url.searchParams.delete(key);
    url.hash = key === 'post' ? 'posts' : 'series';
    history.replaceState(history.state, '', url);
    selectPanel();
  } catch (error) {
    if (error instanceof HttpError && error.status === 401) {
      // 세션 만료 시 로그인 후 재시도할 수 있도록 대기 상태 복원
      linkedEditorPending = true;
      showLogin(error.message);
    } else setMessage(dashboardMessage, error instanceof Error ? error.message : '수정할 항목을 불러오지 못했습니다.', true);
  }
}

/**
 * 조회 결과로 관리자 목록 렌더
 */
function render(data: AdminData) {
  latestData = data;
  if (editorMode) renderEditor(data);
  else { renderPosts(data); renderCategories(data); renderSeries(data); }
}

/**
 * 글 목록·편집·발행 동작과 페이지 이동 구성
 *
 * 1. 전체 건수와 글 목록 표시
 * 2. 각 글의 편집·발행·발행 취소 동작 구성
 * 3. 전체 필터 결과를 열 개씩 페이지로 표시
 */
function renderPosts(data: AdminData) {
  // 전체 건수와 글 목록 표시
  const filtered = filterPosts(data.posts, postFilter, data.deployment);
  const totalPages = Math.max(1, Math.ceil(filtered.length / 10));
  postPage = Math.min(postPage, totalPages - 1);
  const rows = filtered.slice(postPage * 10, (postPage + 1) * 10);
  get('post-count').textContent = postFilter === 'all' ? `전체 ${data.posts.length}` : `${filtered.length}개 / 전체 ${data.posts.length}`;
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-post-filter]')) {
    const filter = button.dataset.postFilter as PostFilter;
    const label = { all: '전체', draft: '미발행', pending: '배포 대기' }[filter];
    button.textContent = `${label} ${filter === 'pending' && !data.deployment ? '—' : filterPosts(data.posts, filter, data.deployment).length}`;
    button.setAttribute('aria-pressed', String(filter === postFilter));
  }
  setMessage(get('deployment-notice'), data.deployment ? '' : '배포 상태를 확인하지 못했습니다. 상태 새로고침으로 다시 확인해 주세요.', true);
  const list = get('post-list'); list.replaceChildren();
  if (!rows.length) list.append(el('p', 'empty', postFilter === 'pending' && !data.deployment ? '배포 상태를 확인한 뒤 대기 글을 표시합니다.' : postFilter === 'all' ? '등록된 글이 없습니다.' : '이 상태의 글이 없습니다.'));
  else {
    const table = el('table', 'admin-table');
    const head = el('thead'); const labels = el('tr');
    for (const title of ['제목', '섹션', '상태', '수정일', '관리']) { const cell = el('th', '', title); cell.scope = 'col'; labels.append(cell); }
    head.append(labels); table.append(head);
    const body = el('tbody');
    // 각 글의 편집·발행·발행 취소 동작 구성
    for (const post of rows) {
      const row = el('tr'); const title = el('td', 'post-title');
      const editLink = el('button', 'title-button', post.title); editLink.type = 'button';
      editLink.addEventListener('click', () => editPost(post, data)); title.append(editLink);
      title.append(el('small', 'muted', [post.category?.path, post.series?.name].filter(Boolean).join(' · ') || `/${post.slug}`));
      const section = el('td', 'muted', post.section === 'PROJECT' ? 'Projects' : 'Posts'); section.dataset.label = '섹션';
      const state = el('td'); state.dataset.label = '상태';
      const deployment = deploymentState(post, data.deployment);
      state.append(el('span', `status ${deployment.kind}`, deployment.label));
      const date = el('td', 'mono muted', post.updatedAt.slice(0, 10).replaceAll('-', '.')); date.dataset.label = '수정일';
      const actions = el('td', 'row-actions');
      const edit = el('button', 'text-button', '수정'); edit.type = 'button'; edit.addEventListener('click', () => editPost(post, data)); actions.append(edit);
      const published = post.status === 'PUBLISHED';
      const publication = smallAction(actions, published ? '발행 취소' : '발행', () => mutate(`/admin/posts/${post.id}/publication`, 'PUT', { published: !published }), published ? '발행을 취소했습니다.' : '발행했습니다.', published ? '이 글의 발행을 취소할까요?' : '저장소 Markdown 원고를 확인하고 이 글을 발행할까요?');
      publication.classList.toggle('danger', published);
      row.append(title, section, state, date, actions); body.append(row);
    }
    table.append(body); list.append(table);
  }
  // 필터를 먼저 적용한 결과를 열 개씩 표시
  const pages = get('post-pages'); pages.replaceChildren();

  /**
   * 같은 필터 내에서 목록 페이지 이동
   */
  const pageButton = (title: string, next: number) => {
    const button = el('button', 'button ghost', title); button.type = 'button';
    button.addEventListener('click', () => { postPage = next; renderPosts(latestData); });
    pages.append(button);
  };
  if (postPage > 0) pageButton('이전', postPage - 1);
  pages.append(el('span', '', `${postPage + 1} / ${totalPages}`));
  if (postPage + 1 < totalPages) pageButton('다음', postPage + 1);
}

/**
 * 상세 페이지와 같은 글 메타데이터 편집 폼 표시
 */
function editPost(post: Post, data: AdminData) {
  const edit = postEditor(post, data, {
    onSaving: () => setMessage(get('dialog-message'), ''),
    onSaved: async () => {
      dialog.close(); await loadDashboard(); setMessage(dashboardMessage, '글 정보를 저장했습니다.');
    },
    onError: error => {
      if (error instanceof HttpError && error.status === 401) showLogin(error.message);
      else setMessage(get('dialog-message'), error instanceof Error ? error.message : '글 정보를 저장하지 못했습니다.', true);
    },
  });
  openDialog(post.section === 'PROJECT' ? 'Projects 글 수정' : 'Posts 글 수정', edit);
}

/**
 * 요청한 글·시리즈의 편집 화면 표시
 *
 * 1. 기존 작성 폼은 유지하며 선택할 프로젝트 목록만 갱신
 * 2. 미발행 글 저장 후 원고 경로와 관리 링크 표시
 * 3. 프로젝트 글 작성에서는 새 프로젝트 생성 동작도 연결
 */
function renderEditor(data: AdminData) {
  const container = get('editor-content');
  // 기존 작성 폼은 유지하며 선택할 프로젝트 목록만 갱신
  if (container.childElementCount) {
    const select = container.querySelector<HTMLSelectElement>('select[name=seriesId]');
    if (select && editorMode === 'project') {
      const current = selectedProject ? String(selectedProject) : select.value;
      select.replaceChildren();
      for (const [key, title] of [['', '프로젝트 선택'], ...data.series.filter(item => item.kind === 'PROJECT').map(item => [String(item.id), item.name])]) {
        const option = el('option', '', title); option.value = key; select.append(option);
      }
      select.value = current; select.dispatchEvent(new Event('change')); selectedProject = null;
    }
    return;
  }
  // 미발행 글 저장 후 원고 경로와 관리 링크 표시
  const create = form(async input => {
    const post = await mutate<Post>('/admin/posts', 'POST', postPayload(input));
    const done = el('div', 'creation-complete');
    done.append(el('h2', '', '글 정보가 저장되었습니다.'), el('p', '', post.title), el('p', 'source-path mono', `content/posts/${post.slug}.md`));
    const back = el('a', 'button primary', '목록으로'); back.href = `/ken-blog/${editorMode === 'project' ? 'projects' : 'posts'}/`;
    const manage = el('a', 'button ghost', '글 관리'); manage.href = '/ken-blog/manage/#posts'; done.append(back, manage);
    container.replaceChildren(done);
  }, '미발행 글로 저장했습니다.');
  const project = editorMode === 'project';
  postFields(create, data, project, { seriesId: Number(new URLSearchParams(location.search).get('project')) || null });
  // 프로젝트 글 작성에서는 새 프로젝트 생성 동작도 연결
  if (project) {
    const add = el('button', 'text-button new-project', '+ 새 프로젝트'); add.type = 'button';
    add.addEventListener('click', () => openDialog('새 프로젝트', createSeriesForm(latestData, true))); create.append(add);
  }
  submit(create, '글 정보 저장'); container.append(create);
}

/**
 * 접어 둔 분류 ID
 */
const collapsedCategories = new Set<number>();

/**
 * 분류 생성·정렬·삭제 화면 렌더
 *
 * 1. 대분류·소분류 생성 폼과 입력 규칙 구성
 * 2. 분류 순서·삭제 관리 동작 구성
 * 3. 접힘 상태를 유지하며 대분류·소분류 재귀 렌더
 */
function renderCategories(data: AdminData) {
  get('category-create').replaceChildren();
  const list = get('category-list'); list.replaceChildren();
  // 대분류·소분류 생성 폼과 입력 규칙 구성

  /**
   * 부모 경로를 이어 새 분류 생성 폼 열기
   */
  const addCategory = (parent: Category | null) => {
    const create = form(input => mutate('/admin/categories', 'POST', {
      path: [parent?.path, value(input, 'name')].filter(Boolean).join('/'),
    }), '분류를 만들었습니다.');
    if (parent) create.append(el('p', 'wide category-parent', parent.path.replaceAll('/', ' › ')));
    const name = field(create, '분류 이름', 'name', '', { required: true, max: 60, wide: true });
    name.pattern = '[^\\/]+';
    submit(create, '추가'); openDialog(parent ? '새 소분류' : '새 대분류', create);
  };
  // 분류 순서·삭제 관리 동작 구성

  /**
   * 선택 분류의 관리 대화상자 열기
   */
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

  /**
   * 분류의 직접 글과 하위 글 수 합산
   */
  const count = (category: Category): number => category.totalCount ?? category.directCount + category.children.reduce((sum, child) => sum + count(child), 0);

  /**
   * 분류 추가 버튼 생성
   */
  const addButton = (parent: Category | null) => {
    const button = el('button', 'category-add', parent ? '＋ 새 소분류' : '＋ 새 대분류'); button.type = 'button';
    button.addEventListener('click', () => addCategory(parent)); return button;
  };
  // 접힘 상태를 유지하며 대분류·소분류 재귀 렌더

  /**
   * 대분류·소분류 트리와 관리 동작 구성
   */
  const tree = (categories: Category[], parent: Category | null): HTMLUListElement => {
    const ul = el('ul', 'category-tree');
    for (const category of categories) {
      const li = el('li');
      const row = el('div', 'category-line');
      const children = category.depth < 2 ? tree(category.children, category) : null;
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

/**
 * 일반 시리즈·프로젝트 생성 또는 수정 폼 구성
 */
function createSeriesForm(data: AdminData, project: boolean, item?: Series) {
  return seriesEditor({ project, badges: data.badges, item,
    onSaving: () => setMessage(get('dialog-message'), ''),
    onSaved: async created => {
      if (project && !item) selectedProject = created.id;
      dialog.close(); await loadDashboard(); setMessage(dashboardMessage, '저장했습니다.');
    },
    onError: error => {
      if (error instanceof HttpError && error.status === 401) showLogin(error.message);
      else setMessage(get('dialog-message'), error instanceof Error ? error.message : '저장하지 못했습니다.', true);
    },
  });
}

/**
 * 시리즈·프로젝트 목록과 편집 동작 구성
 */
function renderSeries(data: AdminData) {
  const add = el('button', 'button ghost', '+ 새 시리즈'); add.type = 'button';
  add.addEventListener('click', () => openDialog('새 시리즈', createSeriesForm(data, false)));
  const addProject = el('button', 'button ghost', '+ 새 프로젝트'); addProject.type = 'button';
  addProject.addEventListener('click', () => openDialog('새 프로젝트', createSeriesForm(data, true)));
  get('series-create').replaceChildren(add, addProject);
  const list = get('series-list'); list.replaceChildren();
  if (!data.series.length) list.append(el('p', 'empty', '등록된 시리즈가 없습니다.'));
  for (const item of data.series) {
    const article = el('article', 'item series-row');
    const info = el('div'); info.append(itemHeading(item.name, item.kind === 'PROJECT' ? 'Projects' : 'Posts'));
    if (item.description) info.append(el('p', 'muted', item.description));
    if (item.stackBadges.length) {
      const stacks = el('div', 'stack-chips');
      for (const badge of item.stackBadges) {
        const chip = el('span', 'stack-chip'); chip.append(stackIcon(badge), document.createTextNode(badge.name)); stacks.append(chip);
      }
      info.append(stacks);
    }
    const button = el('button', 'text-button', '수정'); button.type = 'button';
    button.addEventListener('click', () => {
      const edit = createSeriesForm(data, item.kind === 'PROJECT', item);
      openDialog(item.kind === 'PROJECT' ? '프로젝트 수정' : '시리즈 수정', edit);
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
    clearCsrf();
    await refreshCsrf();
    const user = await request<{
      /**
       * 계정 권한
       */
      role: string
    }>('/auth/me');
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
connectHeader({ onLogout: () => showLogin(), onError: error => setMessage(dashboardMessage, error.message, true) });

/**
 * CSRF·현재 계정 확인 후 로그인 또는 관리자 화면 초기화
 */
async function bootAdmin() {
  try {
    const user = await request<{
      /**
       * 계정 권한
       */
      role: string
    }>('/auth/me');
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


// 상태 필터 변경은 첫 페이지에서 시작하고 저장 후에도 선택 유지
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-post-filter]')) {
  button.addEventListener('click', () => {
    postFilter = button.dataset.postFilter as PostFilter; postPage = 0;
    if (latestData) renderPosts(latestData);
  });
}

/**
 * 편집 중 입력을 보존하며 관리자 상태 재조회
 */
async function refreshPostStatus() {
  if (!sessionReady || editorMode || dialog.open || document.hidden || refreshingStatus || get('posts').hidden) return;
  refreshingStatus = true;
  const button = get('refresh-post-status') as HTMLButtonElement; button.disabled = true;
  try { await loadDashboard(); }
  catch (error) {
    if (error instanceof HttpError && error.status === 401) showLogin(error.message);
    else setMessage(dashboardMessage, error instanceof Error ? error.message : '상태를 갱신하지 못했습니다.', true);
  } finally { refreshingStatus = false; button.disabled = false; }
}
document.getElementById('refresh-post-status')?.addEventListener('click', () => { void refreshPostStatus(); });
window.addEventListener('focus', () => { void refreshPostStatus(); });
document.addEventListener('visibilitychange', () => { void refreshPostStatus(); });
window.setInterval(() => { void refreshPostStatus(); }, 30_000);
