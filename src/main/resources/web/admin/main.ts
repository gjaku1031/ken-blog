import './style.css';

/**
 * CSRF 토큰 응답
 */
type Csrf = {
  /**
   * CSRF 토큰 요청 헤더명
   */
  headerName: string;
  /**
   * 세션별 CSRF 토큰
   */
  token: string
};
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
 * 분류 트리 노드
 */
type Category = CategoryRef & {
  /**
   * 초안을 포함한 해당 분류의 직접 글 수
   */
  directCount: number;
  /**
   * 하위 분류 목록
   */
  children: Category[]
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
 * 기술 뱃지
 */
type Badge = {
  /**
   * ID
   */
  id: number;
  /**
   * 이름
   */
  name: string
};
/**
 * 시리즈 속성과 기술 목록
 */
type Series = {
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
  kind: 'TECH' | 'PROJECT';
  /**
   * 설명
   */
  description: string;
  /**
   * 프로젝트 진행 상태
   */
  projectStatus: string | null;
  /**
   * 시작 연월
   */
  startPeriod: string | null;
  /**
   * 종료 연월
   */
  endPeriod: string | null;
  /**
   * 수정 시각
   */
  updatedAt: string;
  /**
   * 정렬 순서
   */
  sortOrder: number;
  /**
   * 선택 순서의 기술 뱃지 목록
   */
  stackBadges: Badge[]
};
/**
 * 게시글 메타데이터
 */
type Post = {
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
  badges: Badge[]
};

/**
 * 문서 루트
 */
const root = document.documentElement;
/**
 * 저장된 테마
 */
const savedTheme = localStorage.getItem('ken-blog-theme');
if (savedTheme === 'dark' || savedTheme === 'light') root.dataset.theme = savedTheme;
// 테마 선택을 현재 화면과 브라우저 저장소에 반영
document.querySelector<HTMLButtonElement>('[data-theme-toggle]')?.addEventListener('click', () => {
  const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
  root.dataset.theme = next;
  localStorage.setItem('ken-blog-theme', next);
});

/**
 * 관리자 API 기준 URL
 */
const apiBase = document.body.dataset.apiBase ?? '';
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
 * 현재 세션의 CSRF 토큰
 */
let csrf: Csrf | null = null;
/**
 * 현재 글 목록 페이지
 */
let postPage = 0;
/**
 * 관리자 세션 확인 여부
 */
let sessionReady = false;

/**
 * 필수 DOM 요소 조회, 없으면 초기화 실패
 */
function get(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (!found) throw new Error(`화면 요소 누락: ${id}`);
  return found;
}
/**
 * 태그·클래스·텍스트로 DOM 요소 생성
 */
function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (text) item.textContent = text;
  return item;
}
/**
 * 결과 메시지와 오류 표시 갱신
 */
function setMessage(target: HTMLElement, message: string, error = false) {
  target.textContent = message;
  target.hidden = !message;
  target.classList.toggle('error', error);
  target.setAttribute('role', error ? 'alert' : 'status');
}
/**
 * 관리자 목록과 결과 메시지 비움
 */
function clearDashboard() {
  for (const id of ['post-create', 'post-list', 'post-pages', 'category-create', 'category-list', 'series-create', 'series-list']) get(id).replaceChildren();
}
/**
 * 관리자 상태를 비우고 로그인 화면 표시
 */
function showLogin(message = '') {
  sessionReady = false;
  csrf = null;
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
  boot.hidden = true;
  login.hidden = true;
  dashboard.hidden = false;
  setMessage(loginMessage, '');
}
/**
 * HTTP 상태를 보존하는 관리자 요청 오류
 */
class HttpError extends Error {
  /**
   * HTTP 상태와 오류 메시지 설정
   */
  constructor(
    /**
     * HTTP 상태
     */
    readonly status: number, message: string) { super(message); }
}
/**
 * CSRF·세션 쿠키를 포함한 API 요청과 오류 변환
 *
 * 1. API 주소 확인, 변경 요청에는 CSRF 토큰 준비
 * 2. 쿠키 포함·캐시 금지·리다이렉트 거부로 요청
 * 3. 오류 본문·상태를 읽어 인증 실패와 일반 실패 구분
 * 4. 빈 성공 응답 또는 JSON 반환
 */
async function request<T>(path: string, method = 'GET', body?: object): Promise<T> {
  // API 주소 확인, 변경 요청에는 CSRF 토큰 준비
  if (!apiBase) throw new Error('관리자 연결 주소가 설정되지 않았습니다.');
  const headers = new Headers({ Accept: 'application/json' });
  if (method !== 'GET') {
    if (!csrf) await refreshCsrf();
    if (csrf) headers.set(csrf.headerName, csrf.token);
  }
  if (body) headers.set('Content-Type', 'application/json');
  let response: Response;
  try {
    // 쿠키 포함·캐시 금지·리다이렉트 거부로 요청
    response = await fetch(new URL('/api/v1' + path, apiBase), {
      method, headers, credentials: 'include', cache: 'no-store', redirect: 'error',
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('관리자 연결에 실패했습니다. 인터넷 연결과 브라우저의 사이트 간 쿠키 허용 설정을 확인하세요.');
  }
  // 오류 본문·상태를 읽어 인증 실패와 일반 실패 구분
  if (!response.ok) {
    let detail = '';
    try {
      const problem = await response.json() as {
        /**
         * 오류 상세 설명
         */
        detail?: unknown;
        /**
         * 제목
         */
        title?: unknown
      };
      detail = typeof problem.detail === 'string' ? problem.detail : typeof problem.title === 'string' ? problem.title : '';
    } catch { /* 응답 본문이 없는 오류 */ }
    if (response.status === 401) throw new HttpError(401, '로그인이 만료되었습니다. 다시 로그인하세요.');
    if (response.status === 403) throw new HttpError(403, '요청이 거부되었습니다. 페이지를 새로고침한 뒤 다시 시도하세요.');
    throw new HttpError(response.status, detail || `요청에 실패했습니다. HTTP ${response.status}`);
  }
  // 빈 성공 응답 또는 JSON 반환
  if (response.status === 204) return undefined as T;
  return await response.json() as T;
}
/**
 * 현재 세션의 CSRF 토큰 갱신
 */
async function refreshCsrf(): Promise<void> {
  csrf = await request<Csrf>('/auth/csrf');
  if (!csrf || !csrf.headerName || !csrf.token) throw new Error('로그인 보호 토큰을 받지 못했습니다.');
}
/**
 * 관리자 변경 요청 후 목록 다시 조회
 */
async function mutate<T>(path: string, method: string, body?: object): Promise<T> {
  try { return await request<T>(path, method, body); }
  catch (error) {
    if (error instanceof HttpError && error.status === 403) csrf = null;
    throw error;
  }
}
/**
 * 중복 실행 방지 후 작업 결과 표시, 인증 만료 시 로그인 전환
 *
 * 1. 변경 완료 후 관리자 목록 재조회
 * 2. 세션 만료는 로그인 화면, 다른 실패는 현재 화면에 표시
 */
async function action(operation: () => Promise<unknown>, success: string) {
  setMessage(dashboardMessage, '');
  try {
    // 변경 완료 후 관리자 목록 재조회
    await operation();
    await loadDashboard();
    setMessage(dashboardMessage, success + ' 공개 사이트 반영은 GitHub Actions의 Pages 워크플로를 실행하세요.');
  } catch (error) {
    // 세션 만료는 로그인 화면, 다른 실패는 현재 화면에 표시
    if (error instanceof HttpError && error.status === 401) showLogin(error.message);
    else setMessage(dashboardMessage, error instanceof Error ? error.message : '요청에 실패했습니다.', true);
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
 * 입력 필드 생성
 */
function field(form: HTMLElement, title: string, name: string, value = '', options: {
  /**
   * 필수 입력 여부
   */
  required?: boolean;
  /**
   * 입력 길이 상한
   */
  max?: number;
  /**
   * 종류
   */
  type?: string;
  /**
   * 넓은 입력 영역 여부
   */
  wide?: boolean;
  /**
   * 입력 안내 문구
   */
  placeholder?: string
} = {}) {
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
/**
 * 여러 줄 입력 필드 생성
 */
function area(form: HTMLElement, title: string, name: string, value = '', max = 500, wide = true) {
  const label = el('label', wide ? 'wide' : '', title);
  const input = el('textarea');
  input.name = name; input.value = value; input.rows = 3; input.maxLength = max;
  label.append(input); form.append(label);
  return input;
}
/**
 * 선택 목록 생성
 */
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
/**
 * 폼 제출 버튼 추가
 */
function submit(form: HTMLFormElement, title: string) {
  const row = el('div', 'form-actions');
  const button = el('button', 'button primary', title);
  button.type = 'submit';
  row.append(button);
  form.append(row);
}
/**
 * 폼 입력의 앞뒤 공백 제거
 */
function value(data: FormData, name: string): string { return String(data.get(name) ?? '').trim(); }
/**
 * 선택 숫자 입력 변환, 빈 값이면 null
 */
function optionalNumber(data: FormData, name: string): number | null {
  const raw = value(data, name);
  return raw ? Number(raw) : null;
}
/**
 * 쉼표로 구분한 태그 입력 정리
 */
function tags(data: FormData): string[] { return value(data, 'tags').split(',').map(item => item.trim()).filter(Boolean); }
/**
 * 분류 선택 목록 생성
 */
function categoryOptions(categories: Category[]): Array<[string, string]> {
  return [['', '분류 없음'], ...flatten(categories).map(item => [String(item.id), item.path] as [string, string])];
}
/**
 * 분류 트리를 부모 우선 목록으로 펼침
 */
function flatten(nodes: Category[]): Category[] { return nodes.flatMap(item => [item, ...flatten(item.children ?? [])]); }
/**
 * 기존 선택 순서를 보존한 기술 체크박스 생성
 */
function checkboxes(form: HTMLElement, title: string, badges: Badge[], selected: string[] = []) {
  const group = el('fieldset', 'wide badge-list');
  group.append(el('legend', '', title));
  // 기존 프로젝트의 선택 순서를 유지하고 미선택 기술은 등록순으로 뒤에 배치
  const ordered = [...badges].sort((a, b) => {
    /**
     * 선택한 기술의 기존 순서 조회
     */
    const index = (name: string) => selected.includes(name) ? selected.indexOf(name) : selected.length;
    return index(a.name) - index(b.name);
  });
  for (const badge of ordered) {
    const label = el('label', 'check');
    const checkbox = el('input'); checkbox.type = 'checkbox'; checkbox.name = 'stackBadgeNames'; checkbox.value = badge.name;
    checkbox.checked = selected.includes(badge.name);
    label.append(checkbox, document.createTextNode(badge.name)); group.append(label);
  }
  form.append(group);
}
/**
 * 선택한 기술 이름 목록 조회
 */
function badgeNames(data: FormData): string[] { return data.getAll('stackBadgeNames').map(String); }
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
 * 확인 절차와 비동기 작업을 연결한 버튼 생성
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
}

/**
 * 글·시리즈·분류·기술 조회 후 관리자 화면 갱신
 *
 * 1. 글·시리즈·분류·기술 목록 병렬 조회
 * 2. 조회 중 세션이 해제되지 않았을 때만 화면 갱신
 */
async function loadDashboard() {
  if (!sessionReady) return;
  // 글·시리즈·분류·기술 목록 병렬 조회
  const data = await Promise.all([
    request<Page<Post>>(`/admin/posts?page=${postPage}&size=30`),
    request<Series[]>('/admin/series'),
    request<Category[]>('/admin/categories'),
    request<Badge[]>('/admin/stack-badges'),
  ]);
  if (!sessionReady) return;
  // 조회 중 세션이 해제되지 않았을 때만 화면 갱신
  render({ posts: data[0], series: data[1], categories: data[2], badges: data[3] });
  showDashboard();
}
/**
 * 조회 결과로 관리자 목록 렌더
 */
function render(data: AdminData) {
  renderPosts(data);
  renderCategories(data);
  renderSeries(data);
}
/**
 * 글 생성·편집·출간·순서·관계 관리 화면 렌더
 *
 * 1. 새 글 메타데이터 입력 폼 구성
 * 2. 글별 메타데이터·시리즈·연결·발행 조작 구성
 * 3. 시리즈 소속과 문서 순서를 별도 저장
 * 4. 발행·취소 확인 동작 연결
 * 5. 이전·다음 페이지 구성, 조회 실패 시 기존 페이지 복구
 */
function renderPosts(data: AdminData) {
  // 새 글 메타데이터 입력 폼 구성
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

  // 글별 메타데이터·시리즈·연결·발행 조작 구성
  const list = get('post-list'); list.replaceChildren();
  if (!data.posts.items.length) list.append(el('p', 'empty', '등록된 글이 없습니다.'));
  for (const post of data.posts.items) {
    const article = el('article', 'item');
    article.append(itemHeading(post.title, `${post.section === 'PROJECT' ? '프로젝트' : '일반 글'} · ${post.status === 'PUBLISHED' ? post.visibility === 'PUBLIC' ? '공개 발행' : '비공개 발행' : '미발행'}`));
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
    // 시리즈 소속과 문서 순서를 별도 저장
    const membership = form(input => mutate(`/admin/posts/${post.id}/series`, 'PUT', {
      seriesId: optionalNumber(input, 'seriesId'), relatedSeriesId: optionalNumber(input, 'relatedSeriesId'), order: optionalNumber(input, 'order'),
    }), '시리즈와 문서 순서를 저장했습니다.');
    seriesFields(membership, data, post.series?.id ?? null, post.seriesOrder, post.relatedSeriesId);
    submit(membership, '시리즈·순서 저장'); article.append(membership);
    article.append(postDeclarations(post));
    // 발행·취소 확인 동작 연결
    const actions = el('div', 'inline-actions');
    const published = post.status === 'PUBLISHED';
    smallAction(actions, published ? '발행 취소' : '발행', () =>
      mutate(`/admin/posts/${post.id}/publication`, 'PUT', { published: !published }),
      published ? '발행을 취소했습니다.' : '발행했습니다.',
      published ? '이 글의 발행을 취소할까요?' : '저장소 Markdown 원고를 확인하고 이 글을 발행할까요?');
    article.append(actions); list.append(article);
  }
  // 이전·다음 페이지 구성, 조회 실패 시 기존 페이지 복구
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
 * 분류 생성·정렬·삭제 화면 렌더
 *
 * 1. 분류 경로 생성 폼 구성
 * 2. 트리를 펼쳐 직접 글 수·순서·삭제 동작 표시
 */
function renderCategories(data: AdminData) {
  // 분류 경로 생성 폼 구성
  const create = form(input => mutate('/admin/categories', 'POST', { path: value(input, 'path') }), '분류를 만들었습니다.');
  field(create, '분류 경로', 'path', '', { required: true, placeholder: '상위/하위' });
  submit(create, '분류 만들기'); get('category-create').replaceChildren(create);
  const list = get('category-list'); list.replaceChildren();
  // 트리를 펼쳐 직접 글 수·순서·삭제 동작 표시
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
/**
 * 시리즈 소속·순서·관련 프로젝트 입력 생성
 */
function seriesFields(parent: HTMLElement, data: AdminData, selected: number | null, order: number | null, related: number | null) {
  choice(parent, '시리즈', 'seriesId', [['', '없음'], ...data.series.map(item => [String(item.id), `${item.kind === 'PROJECT' ? '프로젝트' : '일반'} · ${item.name}`] as [string, string])], String(selected ?? ''));
  field(parent, '문서 순서 (비우면 마지막)', 'order', String(order ?? ''), { type: 'number' }).min = '1';
  choice(parent, '관련 프로젝트', 'relatedSeriesId', [['', '없음'], ...data.series.filter(item => item.kind === 'PROJECT').map(item => [String(item.id), item.name] as [string, string])], String(related ?? ''));
}
/**
 * 폼 입력을 시리즈 속성 요청으로 변환
 */
function seriesMetadata(input: FormData, project: boolean) {
  return { name: value(input, 'name'), description: value(input, 'description'),
    ...(project ? { projectStatus: value(input, 'projectStatus'), startPeriod: value(input, 'startPeriod'),
      endPeriod: value(input, 'endPeriod') || null, stackBadgeNames: badgeNames(input) } : {}) };
}
/**
 * 프로젝트 상태·기간·기술 입력 생성
 */
function projectFields(parent: HTMLElement, badges: Badge[], item?: Series) {
  choice(parent, '상태', 'projectStatus', [['PLAN', '기획'], ['DEV', '개발'], ['MAINT', '유지보수'], ['DONE', '완료']], item?.projectStatus ?? 'PLAN');
  const start = field(parent, '시작 기간', 'startPeriod', item?.startPeriod ?? '', { required: true, placeholder: 'YYYY.MM', max: 7 });
  start.pattern = '[0-9]{4}\\.(0[1-9]|1[0-2])';
  const end = field(parent, '종료 기간', 'endPeriod', item?.endPeriod ?? '', { placeholder: 'YYYY.MM', max: 7 });
  end.pattern = start.pattern;
  checkboxes(parent, '기술 스택', badges, item?.stackBadges.map(b => b.name) ?? []);
  if (!badges.length) parent.append(el('p', 'wide muted', '등록된 기술이 없습니다. 기술 이름과 아이콘을 먼저 등록하세요.'));
}
/**
 * 시리즈 생성·편집·삭제 화면 렌더
 *
 * 1. 시리즈 생성 폼 구성
 * 2. 기존 시리즈별 수정·순서·삭제 동작 구성
 */
function renderSeries(data: AdminData) {
  // 시리즈 생성 폼 구성
  const create = form(input => mutate('/admin/series', 'POST', {
    slug: value(input, 'slug'), kind: value(input, 'kind'), metadata: seriesMetadata(input, value(input, 'kind') === 'PROJECT'),
  }), '시리즈를 만들었습니다.');
  field(create, '이름', 'name', '', { required: true, max: 200 });
  field(create, '주소 slug', 'slug', '', { required: true, max: 160 });
  const kind = choice(create, '종류', 'kind', [['TECH', '일반'], ['PROJECT', '프로젝트']]);
  area(create, '설명', 'description', '', 1000);
  const project = el('fieldset', 'wide field-grid'); projectFields(project, data.badges); create.append(project);
  /**
   * 시리즈 종류에 따라 프로젝트 입력 활성화
   */
  const toggle = () => { project.hidden = kind.value !== 'PROJECT'; project.disabled = project.hidden; };
  kind.addEventListener('change', toggle); toggle();
  submit(create, '시리즈 만들기'); get('series-create').replaceChildren(create);
  // 기존 시리즈별 수정·순서·삭제 동작 구성
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
// 로그인 제출 → CSRF 교체 → ADMIN 확인 → 관리자 목록 조회
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
    // 로그인 성공 후 새 세션의 CSRF 토큰으로 교체
    loginAccepted = true;
    csrf = null;
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
    // 실패 원인을 안내하고 비밀번호 입력 제거
    showLogin(message);
    loginForm.querySelectorAll<HTMLInputElement>('input[type=password]').forEach(input => { input.value = ''; });
  } finally { if (button) button.disabled = false; }
});
// 로그아웃 성공 또는 이미 만료된 세션이면 로그인 화면 표시
get('logout').addEventListener('click', async () => {
  try { await mutate('/auth/logout', 'POST'); showLogin(); }
  catch (error) {
    if (error instanceof HttpError && error.status === 401) showLogin();
    else setMessage(dashboardMessage, error instanceof Error ? error.message : '로그아웃에 실패했습니다.', true);
  }
});
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
// 현재 세션 확인으로 관리 화면 초기화
void bootAdmin();
