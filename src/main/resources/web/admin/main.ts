import "../shared/theme.css";
import "../shared/stack-icons.css";
import './style.css';
import '../shared/header.css';
import '../shared/forms.css';
import '../shared/category-tree.css';
import { connectHeader, updateHeaderSession } from '../shared/header';
import { request, mutate, refreshCsrf, clearCsrf, HttpError } from '../shared/admin-api';
import { el, setMessage, field, area, choice, submit, value, stackIcon, type Badge } from '../shared/forms';
import { seriesEditor, type Series } from '../shared/series-editor';
import { taxonomyFields, postCreateFields, postPayload, postTags, type Category, type Tag } from '../shared/post-fields';

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
  posts: Page<Post>;

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
 * 선택 숫자 입력 변환, 빈 값이면 null
 */
function optionalNumber(data: FormData, name: string): number | null {
  const raw = value(data, name);
  return raw ? Number(raw) : null;
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
 * 글·시리즈·분류·기술 조회 후 관리자 화면 갱신
 *
 * 1. 글·시리즈·분류·기술·태그 병렬 조회
 * 2. 세션 유지 시 화면 갱신
 * 3. 상세 페이지에서 지정한 편집 대상도 최신 정보로 열기
 */
async function loadDashboard() {
  if (!sessionReady) return;
  // 글·시리즈·분류·기술·태그 병렬 조회
  const data = await Promise.all([
    request<Page<Post>>(`/admin/posts?page=${postPage}&size=10`),
    request<Series[]>('/admin/series'),
    request<Category[]>('/admin/categories'),
    request<Badge[]>('/admin/stack-badges'),
    request<Tag[]>('/admin/tags'),
  ]);
  if (!sessionReady) return;
  // 세션 유지 시 화면 갱신
  render({ posts: data[0], series: data[1], categories: data[2], badges: data[3], tags: data[4] });
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
 * 3. 이전·다음 페이지 버튼 구성, 조회 실패 시 기존 페이지 복원
 */
function renderPosts(data: AdminData) {
  // 전체 건수와 글 목록 표시
  get('post-count').textContent = `전체 ${data.posts.totalElements}`;
  const list = get('post-list'); list.replaceChildren();
  if (!data.posts.items.length) list.append(el('p', 'empty', '등록된 글이 없습니다.'));
  else {
    const table = el('table', 'admin-table');
    const head = el('thead'); const labels = el('tr');
    for (const title of ['제목', '섹션', '상태', '수정일', '관리']) { const cell = el('th', '', title); cell.scope = 'col'; labels.append(cell); }
    head.append(labels); table.append(head);
    const body = el('tbody');
    // 각 글의 편집·발행·발행 취소 동작 구성
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
      const publication = smallAction(actions, published ? '발행 취소' : '발행', () => mutate(`/admin/posts/${post.id}/publication`, 'PUT', { published: !published }), published ? '발행을 취소했습니다.' : '발행했습니다.', published ? '이 글의 발행을 취소할까요?' : '저장소 Markdown 원고를 확인하고 이 글을 발행할까요?');
      publication.classList.toggle('danger', published);
      row.append(title, section, state, date, actions); body.append(row);
    }
    table.append(body); list.append(table);
  }
  // 이전·다음 페이지 버튼 구성, 조회 실패 시 기존 페이지 복원
  const pages = get('post-pages'); pages.replaceChildren();

  /**
   * 지정 페이지로 이동하는 버튼 생성
   */
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

/**
 * 글 메타데이터 편집 폼 구성
 *
 * 1. 제목·요약·분류 입력 구성, 프로젝트 글은 태그 비움
 * 2. 시리즈 소속·순서·관련 프로젝트를 별도 저장
 * 3. 첨부·위키 연결 패널을 포함해 대화상자 표시
 */
function editPost(post: Post, data: AdminData) {
  const content = el('div');
  content.append(el('p', 'source-path mono', `content/posts/${post.slug}.md`));
  // 제목·요약·분류 입력 구성, 프로젝트 글은 태그 비움
  const edit = form(input => mutate(`/admin/posts/${post.id}/metadata`, 'PATCH', {
    title: value(input, 'title'), summary: value(input, 'summary'),
    categoryId: optionalNumber(input, 'categoryId'), tags: post.section === 'PROJECT' ? [] : postTags(input),
  }), '글 메타데이터를 저장했습니다.');
  field(edit, '제목', 'title', post.title, { required: true, max: 200 });
  field(edit, '요약', 'summary', post.summary, { max: 120 });
  taxonomyFields(edit, data, post, post.section !== 'PROJECT');
  submit(edit, '메타데이터 저장'); content.append(edit);
  // 시리즈 소속·순서·관련 프로젝트를 별도 저장
  const membership = form(input => mutate(`/admin/posts/${post.id}/series`, 'PUT', {
    seriesId: optionalNumber(input, 'seriesId'), relatedSeriesId: optionalNumber(input, 'relatedSeriesId'), order: optionalNumber(input, 'order'),
  }), '시리즈와 문서 순서를 저장했습니다.');
  seriesFields(membership, data, post.series?.id ?? null, post.seriesOrder, post.relatedSeriesId);
  submit(membership, '시리즈·순서 저장'); content.append(membership);
  // 첨부·위키 연결 패널을 포함해 대화상자 표시
  content.append(postDeclarations(post));

  openDialog('글 수정', content);
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
  postCreateFields(create, data, project, new URLSearchParams(location.search).get('project') ?? '');
  // 프로젝트 글 작성에서는 새 프로젝트 생성 동작도 연결
  if (project) {
    const add = el('button', 'text-button new-project', '+ 새 프로젝트'); add.type = 'button';
    add.addEventListener('click', () => openDialog('새 프로젝트', createSeriesForm(latestData, true))); create.append(add);
  }
  submit(create, '글 정보 저장'); container.append(create);
}

/**
 * 목록에는 없는 선언 관계는 펼칠 때 상세 API로 조회
 *
 * 1. 연결 정보 패널 생성, 처음 펼칠 때 상세 조회
 * 2. 중복 조회·이미 완료한 조회 차단
 * 3. 양수 첨부 ID와 최대 개수 검증 후 전체 교체
 * 4. 줄별 위키 대상 제목으로 전체 교체 요청 구성
 * 5. 조회 실패 시 재시도 버튼 제공
 */
function postDeclarations(post: Post): HTMLDetailsElement {
  // 연결 정보 패널 생성, 처음 펼칠 때 상세 조회
  const panel = el('details', 'declarations');
  panel.append(el('summary', '', '첨부·위키 연결'));
  const content = el('div');
  panel.append(content);
  let loaded = false;
  let loading = false;

  /**
   * 펼친 글의 상세 정보를 한 번 조회해 편집 폼 구성
   */
  const load = async () => {
    // 중복 조회·이미 완료한 조회 차단
    if (!panel.open || loaded || loading) return;
    loading = true;
    content.replaceChildren(el('p', 'muted', '연결 정보를 읽는 중입니다.'));
    try {
      const detail = await request<PostDetail>(`/admin/posts/${post.id}`);
      if (!panel.isConnected || !sessionReady) return;
      // 양수 첨부 ID와 최대 개수 검증 후 전체 교체
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
      // 줄별 위키 대상 제목으로 전체 교체 요청 구성
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
      // 조회 실패 시 재시도 버튼 제공
      const retry = el('button', 'button ghost', '다시 시도');
      retry.type = 'button'; retry.addEventListener('click', () => { void load(); });
      content.replaceChildren(notice, retry);
    } finally { loading = false; }
  };
  panel.addEventListener('toggle', () => { void load(); });
  return panel;
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
 * 시리즈 소속·순서·관련 프로젝트 입력 생성
 */
function seriesFields(parent: HTMLElement, data: AdminData, selected: number | null, order: number | null, related: number | null) {
  choice(parent, '시리즈', 'seriesId', [['', '없음'], ...data.series.map(item => [String(item.id), `${item.kind === 'PROJECT' ? '프로젝트' : '일반'} · ${item.name}`] as [string, string])], String(selected ?? ''));
  field(parent, '문서 순서 (비우면 마지막)', 'order', String(order ?? ''), { type: 'number' }).min = '1';
  choice(parent, '관련 프로젝트', 'relatedSeriesId', [['', '없음'], ...data.series.filter(item => item.kind === 'PROJECT').map(item => [String(item.id), item.name] as [string, string])], String(related ?? ''));
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
