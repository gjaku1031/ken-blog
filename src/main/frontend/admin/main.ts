import './style.css';
import { AdminApi, ApiError, errorMessage } from './api';
import { MarkdownEditor } from './editor';
import { renderMarkdown } from '../shared/markdown';

type Section = 'TECH' | 'PROJECT_HOME' | 'PROJECT_DOC' | 'NOTE_CHAPTER';
type View = 'posts' | 'drafts' | 'editor' | 'projects' | 'courses' | 'categories' | 'profile';
type Page<T> = { items: T[]; totalPages: number; totalElements: number };
type ProjectMetadata = Record<string, unknown> & { status: 'PLAN' | 'DEV' | 'MAINT' | 'DONE'; startPeriod: string;
  endPeriod: string | null; overview: string; visibility: 'PUBLIC'; baseProjectUpdatedAt: string | null; stackBadgeNames: string[] };
type Draft = { id: number; revision: number; postId: number | null; baseUpdatedAt: string | null; title: string;
  body: string; updatedAt: string; section: Section; categoryId: number | null; tags: string[];
  projectId: number | null; relatedProjectId: number | null; documentOrder: number | null;
  projectMetadata: ProjectMetadata | null; courseId: number | null; chapterOrder: number | null;
  techSeriesOrder: number | null; summary: string; attachmentIds: number[]; wikiTargets: string[] };
type Post = { id: number; title: string; body: string; updatedAt: string; status: 'DRAFT' | 'PUBLISHED';
  section: Section; category: { id: number } | null; tags: string[]; projectId: number | null;
  relatedProjectId: number | null; documentOrder: number | null; projectMetadata: ProjectMetadata | null;
  courseId: number | null; chapterOrder: number | null; techSeriesOrder: number | null;
  summary: string; attachmentIds: number[]; wikiTargets: string[]; slug: string };
type PostRow = Pick<Post, 'id' | 'title' | 'section' | 'status' | 'updatedAt' | 'projectId' | 'courseId' | 'slug'> &
  { projectName?: string | null; courseName?: string | null; documentOrder?: number | null; chapterOrder?: number | null };
type DraftRow = Pick<Draft, 'id' | 'title' | 'section' | 'updatedAt' | 'revision' | 'postId' | 'projectId' | 'courseId'>;
type Category = { id: number; path: string; name: string; depth: number; totalCount: number;
  sortOrder?: number; children: Category[] };
type Project = { id: number; name: string; updatedAt: string; status: string; startPeriod: string; endPeriod: string | null;
  overview: string; stackBadges?: { name: string }[]; homePostId?: number | null; sortOrder?: number };
type Course = { id: number; field: string; name: string; description: string; status: 'IN_PROGRESS' | 'COMPLETED' };
type Deployment = { id?: string | null; status: 'IDLE' | 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  runId?: string | null; htmlUrl?: string | null; error?: string | null };
type Form = { title: string; body: string; section: Section; categoryId: number | null; tags: string[];
  projectId: number | null; relatedProjectId: number | null; documentOrder: number | null;
  projectMetadata: ProjectMetadata | null; courseId: number | null; chapterOrder: number | null;
  techSeriesOrder: number | null; summary: string };

const PUBLIC_SITE = 'https://gjaku1031.github.io/ken-blog/';
const app = document.querySelector<HTMLElement>('#app') ?? document.body;
const api = new AdminApi();
let editor: MarkdownEditor | null = null;
let currentForm: Form | null = null;
let currentDraft: Draft | null = null;
let currentPost: Post | null = null;
let savedFingerprint = '';
let writing = false;
let deployment: Deployment | null = null;
let deploymentAvailable = false;
let deploymentTimer = 0;
let routeTicket = 0;
let activeView: View = 'posts';
let statusNode: HTMLElement | null = null;
let conflictActions: HTMLElement | null = null;
let saveButton: HTMLButtonElement | null = null;
let publishButton: HTMLButtonElement | null = null;
let uploadInput: HTMLInputElement | null = null;
let loginUser = '';
let publicationBaselineId: string | null = null;
let publicationDeploymentId: string | null = null;
let publicationPending = false;
const expandedCategoryIds = new Set<number>();
let profileObjectUrl: string | null = null;
let approvedSearchNavigation = false;

const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const button = (label: string, run: () => void, className = 'small-button'): HTMLButtonElement => {
  const node = element('button', className, label);
  node.type = 'button';
  node.addEventListener('click', run);
  return node;
};
const writeButton = (label: string, run: () => void, className = 'small-button'): HTMLButtonElement => {
  const node = button(label, run, className);
  node.dataset.writeAction = 'true'; node.disabled = isBusy();
  return node;
};
const validId = (value: string | null): number | null => value && /^[1-9]\d*$/.test(value) &&
  Number.isSafeInteger(Number(value)) ? Number(value) : null;
const numberOrNull = (value: string): number | null => value === '' ? null : validId(value);
const dateText = (value: string): string => {
  const date = new Date(`${value.replace(/Z$/, '')}Z`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('ko-KR',
    { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Seoul' }).format(date);
};
const sectionName: Record<Section, string> = {
  TECH: 'Tech', PROJECT_HOME: '프로젝트 대문', PROJECT_DOC: '프로젝트 문서', NOTE_CHAPTER: 'Notes 회차',
};
const isBusy = (): boolean => deployment?.status === 'QUEUED' || deployment?.status === 'RUNNING';
const message = (value: string, error = false): void => {
  if (!statusNode) return;
  statusNode.textContent = value;
  statusNode.classList.toggle('error', error);
  statusNode.setAttribute('role', error ? 'alert' : 'status');
};

function formFingerprint(): string {
  if (!currentForm) return '';
  return JSON.stringify({ ...currentForm, body: editor?.value ?? currentForm.body });
}
function captureForm(form: Form): Form {
  return { ...form, body: editor?.value ?? form.body, tags: [...form.tags],
    projectMetadata: form.projectMetadata ? { ...form.projectMetadata,
      stackBadgeNames: [...form.projectMetadata.stackBadgeNames] } : null };
}
/** 서버에 확정한 스냅샷과 현재 입력을 비교해 이탈 경고와 저장 표시를 일치시킨다. */
function dirty(): boolean { return Boolean(currentForm && formFingerprint() !== savedFingerprint); }
function updateEditorActions(): void {
  const blocked = writing || isBusy();
  if (saveButton) saveButton.disabled = blocked;
  if (publishButton) publishButton.disabled = blocked;
  if (uploadInput) uploadInput.disabled = blocked;
  document.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('.metadata input, .metadata select, .metadata textarea')
    .forEach((field) => { field.disabled = blocked || field.dataset.fixedDisabled === 'true'; });
  document.querySelectorAll<HTMLButtonElement | HTMLInputElement>('[data-write-action]')
    .forEach((field) => { field.disabled = isBusy(); });
  document.querySelectorAll<HTMLFieldSetElement>('[data-content-form] fieldset')
    .forEach((field) => { field.disabled = isBusy() || field.dataset.saving === 'true'; });
  const indicator = document.querySelector<HTMLElement>('#save-indicator');
  if (indicator) indicator.textContent = writing ? '처리 중…' : dirty() ? '저장하지 않은 변경' :
    currentPost?.status === 'PUBLISHED' ? !deploymentAvailable ? 'DB 출간됨 · 배포 상태 확인 불가' :
      publicationDeploymentId !== null && deployment?.id === publicationDeploymentId ?
        deployment.status === 'SUCCEEDED' ? 'DB 출간됨 · Pages 배포 완료' :
          deployment.status === 'FAILED' ? 'DB 출간됨 · Pages 배포 실패' : 'DB 출간됨 · Pages 배포 중' :
        publicationPending ? 'DB 출간됨 · Pages 배포 요청 확인 중' : 'DB 출간됨 · 최근 배포 상태는 관리 메뉴에서 확인' :
      isBusy() ? '배포 중 · 입력과 미리보기만 가능' :
        currentDraft ? `편집본 저장됨 · ${dateText(currentDraft.updatedAt)}` : currentPost ? '원본 저장됨' : '새 원고';
}
function guardNavigation(): boolean {
  if (writing) { window.alert('처리가 끝난 뒤 화면을 이동해 주세요. 현재 입력은 유지됩니다.'); return false; }
  return !dirty() || window.confirm('저장하지 않은 변경이 있습니다. 이 화면을 떠나시겠습니까?');
}
window.addEventListener('beforeunload', (event) => {
  if (!approvedSearchNavigation && (dirty() || writing)) { event.preventDefault(); event.returnValue = ''; }
});
window.addEventListener('popstate', () => {
  if (!guardNavigation()) { history.go(1); return; }
  void showRoute();
});

function navigate(url: string, replace = false): void {
  if (!replace && !guardNavigation()) return;
  if (replace) history.replaceState({}, '', url);
  else history.pushState({}, '', url);
  void showRoute();
}
function currentRoute(): { view: View; draftId: number | null; postId: number | null; section: Section;
  projectId: number | null; courseId: number | null } {
  const params = new URLSearchParams(location.search);
  const view = params.get('view');
  const allowed: View[] = ['posts', 'drafts', 'editor', 'projects', 'courses', 'categories', 'profile'];
  const section = params.get('section');
  return { view: allowed.includes(view as View) ? view as View : 'posts', draftId: validId(params.get('draftId')),
    postId: validId(params.get('postId')), projectId: validId(params.get('projectId')),
    courseId: validId(params.get('courseId')),
    section: ['TECH', 'PROJECT_HOME', 'PROJECT_DOC', 'NOTE_CHAPTER'].includes(section ?? '') ? section as Section : 'TECH' };
}

function clearEditor(): void {
  editor?.destroy(); editor = null; currentForm = null; currentDraft = null; currentPost = null;
  saveButton = null; publishButton = null; uploadInput = null; statusNode = null; savedFingerprint = '';
  conflictActions = null;
  publicationBaselineId = null; publicationDeploymentId = null; publicationPending = false;
}
/** 원본 사이트 헤더를 관리자와 로그인 화면에서 같은 구조로 표시한다. */
function siteHeader(authenticated: boolean): HTMLElement {
  const header = element('header', 'site-header');
  const inner = element('div', 'header-inner');
  const brand = element('a', 'brand'); brand.href = PUBLIC_SITE; brand.setAttribute('aria-label', 'ken.blog 홈');
  brand.innerHTML = '<svg width="32" height="32" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><g transform="rotate(-45 24 24)"><path d="M8 12.5 L45 24 L8 35.5 Z"/><path d="M14 14.4 Q17.5 24 14 33.6 M22 16.9 Q24.8 24 22 31.1 M30 19.4 Q32 24 30 28.6 M37 21.6 Q38.2 24 37 26.4"/></g></svg><span>ken<span class="brand-dot">.</span>blog</span>';
  const publicNav = element('nav', 'main-nav'); publicNav.setAttribute('aria-label', '공개 사이트');
  for (const [path, label] of [['', 'Home'], ['tech/', 'Tech'], ['projects/', 'Projects'], ['notes/', 'Notes']]) {
    const link = element('a', '', label); link.href = `${PUBLIC_SITE}${path}`; publicNav.append(link);
  }
  const right = element('div', 'header-actions');
  const searchUnit = element('div', 'header-search-unit');
  const searchToggle = button('', () => {
    const open = !searchUnit.classList.contains('is-open');
    searchUnit.classList.toggle('is-open', open);
    searchToggle.setAttribute('aria-expanded', String(open));
    searchToggle.setAttribute('aria-label', open ? '검색 닫기' : '검색 열기');
    searchForm.setAttribute('aria-hidden', String(!open)); searchForm.inert = !open;
    if (open) requestAnimationFrame(() => searchInput.focus());
  }, 'header-search-toggle');
  searchToggle.setAttribute('aria-label', '검색 열기'); searchToggle.setAttribute('aria-expanded', 'false');
  searchToggle.setAttribute('aria-controls', 'site-search');
  searchToggle.innerHTML = '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 5 5"/></svg>';
  const searchForm = element('form', 'header-search'); searchForm.role = 'search';
  searchForm.action = `${PUBLIC_SITE}search/`; searchForm.method = 'get';
  searchForm.setAttribute('aria-hidden', 'true'); searchForm.inert = true;
  const searchInput = element('input'); searchInput.id = 'site-search'; searchInput.name = 'q'; searchInput.type = 'search';
  searchInput.placeholder = '제목 · 본문 · 태그 검색';
  const searchLabel = element('label', 'sr-only', '글 검색'); searchLabel.htmlFor = searchInput.id;
  const closeSearch = button('×', () => searchToggle.click(), 'header-search-close');
  closeSearch.setAttribute('aria-label', '검색 닫기');
  searchForm.append(searchLabel, searchInput, closeSearch);
  let searchComposing = false;
  searchInput.addEventListener('compositionstart', () => { searchComposing = true; });
  searchInput.addEventListener('compositionend', () => { searchComposing = false; });
  searchForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const query = searchInput.value.trim();
    if (!query || searchComposing || !guardNavigation()) return;
    approvedSearchNavigation = true;
    window.location.assign(`${PUBLIC_SITE}search/?q=${encodeURIComponent(query)}`);
  });
  searchForm.addEventListener('keydown', (event) => { if (event.key === 'Escape') { event.preventDefault(); searchToggle.click(); } });
  searchUnit.append(searchToggle, searchForm); right.append(searchUnit);
  const theme = button('', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('ken-admin-theme', next);
    theme.setAttribute('aria-checked', String(next === 'dark'));
    theme.querySelector('svg')!.innerHTML = next === 'dark' ?
      '<path d="M20.6 14.1A8.6 8.6 0 0 1 9.9 3.4 8.6 8.6 0 1 0 20.6 14.1Z"/>' :
      '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/>';
    if (activeView === 'editor') editor?.refreshTheme();
  }, 'theme-switch');
  theme.setAttribute('role', 'switch'); theme.setAttribute('aria-label', '다크 모드');
  theme.setAttribute('aria-checked', String(document.documentElement.dataset.theme === 'dark'));
  theme.innerHTML = `<span class="theme-switch-track"><span class="theme-switch-thumb"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${document.documentElement.dataset.theme === 'dark' ?
    '<path d="M20.6 14.1A8.6 8.6 0 0 1 9.9 3.4 8.6 8.6 0 1 0 20.6 14.1Z"/>' :
    '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/>'}</svg></span></span>`;
  right.append(theme);
  if (authenticated) {
    const manage = element('span', 'header-text-button', '관리');
    const avatar = element('span', 'account-avatar', loginUser.slice(0, 1).toUpperCase()); avatar.title = loginUser;
    right.append(manage, avatar, button('로그아웃', () => { void logout(); }, 'header-text-button'));
  } else {
    const login = element('span', 'header-text-button', '관리자'); right.append(login);
  }
  inner.append(brand, publicNav, right); header.append(inner);
  return header;
}
function shell(): HTMLElement {
  const wrap = element('div', 'site-root');
  wrap.append(siteHeader(true));
  const body = element('div', 'site-content');
  if (activeView === 'editor') {
    const content = element('main', 'write-page editor-design-page'); content.id = 'content';
    body.append(content); wrap.append(body); return wrap;
  }
  const layout = element('main', 'page-container admin-page admin-layout');
  const aside = element('aside', 'admin-nav'); aside.setAttribute('aria-label', '관리 메뉴');
  aside.append(element('span', '', '관리'));
  const nav = element('nav'); aside.append(nav);
  const entries: Array<[View, string]> = [['posts', '글 관리'], ['categories', '분류 관리'], ['profile', '홈 소개']];
  for (const [view, label] of entries) {
    const link = element('a', '', label); link.href = `/manage/?view=${view}`;
    if (view === activeView || view === 'posts' && ['drafts', 'projects', 'courses'].includes(activeView))
      link.setAttribute('aria-current', 'page');
    link.addEventListener('click', (event) => { event.preventDefault(); navigate(link.href); });
    nav.append(link);
  }
  const content = element('section', 'admin-content'); content.id = 'content';
  layout.append(aside, content); body.append(layout); wrap.append(body, siteFooter());
  return wrap;
}
function renderDeployment(): void {
  const node = document.querySelector<HTMLElement>('#deployment');
  if (!node) { updateEditorActions(); return; }
  node.replaceChildren(element('strong', '', 'Pages 배포'));
  let label = '상태 확인 불가';
  if (deploymentAvailable && deployment) {
    label = { IDLE: '대기', QUEUED: '배포 요청됨', RUNNING: '배포 중', SUCCEEDED: '배포 완료',
      FAILED: '배포 실패' }[deployment.status];
  }
  node.append(element('p', isBusy() ? 'busy' : '', label));
  if (deployment?.status === 'FAILED') node.append(element('small', '', '배포 결과를 확인한 뒤 다시 요청할 수 있습니다.'));
  const refresh = button('새로고침', () => { void pollDeployment(); }, 'quiet');
  node.append(refresh);
  if (deploymentAvailable && isBusy()) node.append(button('종료 확인', () => { void recoverDeployment(); }, 'quiet'));
  if (deploymentAvailable && !isBusy()) node.append(button('배포 요청', () => { void startDeployment(); }, 'quiet'));
  updateEditorActions();
}
async function pollDeployment(): Promise<void> {
  try {
    const value = await api.get<Deployment>('/admin/deployments');
    if (!value || !['IDLE', 'QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED'].includes(value.status)) throw new ApiError(0, 'response');
    deployment = value; deploymentAvailable = true;
    if (publicationPending && typeof value.id === 'string' && value.id !== publicationBaselineId)
      publicationDeploymentId = value.id;
  } catch (error) {
    deploymentAvailable = false; deployment = null;
    if (error instanceof ApiError && error.status === 401 && statusNode)
      message('로그인 세션이 만료되었습니다. 현재 입력은 유지됩니다. 다시 로그인해 주세요.', true);
  }
  renderDeployment();
}
async function startDeployment(): Promise<void> {
  if (isBusy()) return;
  try { await api.write('POST', '/admin/deployments'); await pollDeployment(); }
  catch (error) { window.alert(errorMessage(error)); await pollDeployment(); }
}
async function recoverDeployment(): Promise<void> {
  try { await api.write('POST', '/admin/deployments/recover'); await pollDeployment(); }
  catch (error) { window.alert(errorMessage(error)); await pollDeployment(); }
}
async function logout(): Promise<void> {
  if (!guardNavigation()) return;
  clearEditor();
  try { await api.logout(); }
  catch { /* 화면과 원문은 이미 지운다. */ }
  await showLogin();
}

async function showLogin(): Promise<void> {
  clearEditor();
  window.clearInterval(deploymentTimer);
  app.replaceChildren();
  const frame = element('div', 'site-root'); frame.append(siteHeader(false));
  const body = element('div', 'site-content');
  const wrap = element('main', 'login-page');
  const form = element('form', 'login-card card');
  form.append(element('h1', '', '관리자 로그인'));
  const passwordLabel = element('label', '', '비밀번호'); passwordLabel.htmlFor = 'password';
  const password = element('input'); password.id = 'password'; password.name = 'password'; password.type = 'password';
  password.placeholder = '비밀번호'; password.required = true; password.autocomplete = 'current-password';
  const codeLabel = element('label', '', '인증 앱 코드'); codeLabel.htmlFor = 'verification-code';
  const code = element('input'); code.id = 'verification-code'; code.name = 'verificationCode'; code.type = 'text';
  code.required = true; code.autocomplete = 'one-time-code'; code.inputMode = 'numeric'; code.pattern = '[0-9]{6}';
  code.maxLength = 6; code.placeholder = '6자리 코드'; code.spellcheck = false;
  let recovery = false;
  code.addEventListener('input', () => { if (!recovery) code.value = code.value.replace(/\D/g, '').slice(0, 6); });
  const switchCode = button('복구 코드 사용', () => {
    recovery = !recovery; code.value = ''; codeLabel.textContent = recovery ? '복구 코드' : '인증 앱 코드';
    code.placeholder = recovery ? '복구 코드' : '6자리 코드'; code.inputMode = recovery ? 'text' : 'numeric';
    code.autocomplete = recovery ? 'off' : 'one-time-code';
    if (recovery) code.removeAttribute('pattern'); else code.pattern = '[0-9]{6}';
    code.maxLength = recovery ? 64 : 6; switchCode.textContent = recovery ? '인증 앱 코드 사용' : '복구 코드 사용'; code.focus();
  }, 'login-code-switch');
  switchCode.setAttribute('aria-controls', 'verification-code');
  form.append(passwordLabel, password, codeLabel, code, switchCode);
  const remember = element('label', 'login-remember');
  const checkbox = element('input'); checkbox.type = 'checkbox';
  remember.append(checkbox, element('span', '', '로그인 기억하기'), element('span', 'login-remember-duration', '(30일)'));
  const submit = element('button', 'primary-button', '로그인'); submit.type = 'submit';
  const note = element('p', 'notice'); note.setAttribute('role', 'status'); note.hidden = true;
  form.append(remember, submit, note);
  form.addEventListener('submit', (event) => { event.preventDefault(); void (async () => {
    submit.disabled = true; note.textContent = ''; note.hidden = true;
    try { await api.login(password.value, code.value, checkbox.checked); password.value = ''; code.value = '';
      const user = await api.me(); loginUser = user.username; await showRoute(); await pollDeployment(); startDeploymentPolling(); }
    catch (error) { note.textContent = error instanceof ApiError && (error.status === 401 || error.status === 403) ?
      '비밀번호 또는 인증 코드를 확인해 주세요.' : errorMessage(error); note.hidden = false; submit.disabled = false; }
  })(); });
  wrap.append(form); body.append(wrap); frame.append(body, siteFooter()); app.append(frame);
}
/** 원본 공개 사이트의 바닥글을 관리 화면에 재사용한다. */
function siteFooter(): HTMLElement {
  const footer = element('footer', 'site-footer'); footer.append(element('span', '', `© ${new Date().getFullYear()} ken.blog`));
  const links = element('div'); const github = element('a', '', 'GitHub'); github.href = 'https://github.com/gjaku1031/ken-blog';
  const admin = element('a', '', '관리자'); admin.href = '/manage/'; links.append(github, admin); footer.append(links);
  return footer;
}

function inputField(parent: HTMLElement, label: string, type = 'text', name = ''): HTMLInputElement {
  const field = element('label', 'field'); field.append(element('span', '', label));
  const input = element('input'); input.type = type; input.name = name; field.append(input); parent.append(field);
  return input;
}
function textareaField(parent: HTMLElement, label: string, rows = 3): HTMLTextAreaElement {
  const field = element('label', 'field'); field.append(element('span', '', label));
  const input = element('textarea'); input.rows = rows; field.append(input); parent.append(field); return input;
}
function selectField(parent: HTMLElement, label: string, options: Array<[string, string]>): HTMLSelectElement {
  const field = element('label', 'field'); field.append(element('span', '', label));
  const select = element('select');
  for (const [value, text] of options) { const option = element('option', '', text); option.value = value; select.append(option); }
  field.append(select); parent.append(field); return select;
}
function heading(title: string, action?: HTMLElement): HTMLElement {
  const node = element('div', 'admin-heading heading'); node.append(element('h1', '', title)); if (action) node.append(action); return node;
}

async function showRoute(): Promise<void> {
  const ticket = ++routeTicket;
  if (profileObjectUrl) { URL.revokeObjectURL(profileObjectUrl); profileObjectUrl = null; }
  clearEditor();
  const route = currentRoute(); activeView = route.view;
  app.replaceChildren(shell()); renderDeployment();
  const content = document.querySelector<HTMLElement>('#content')!;
  content.append(element('div', 'loading', '불러오는 중…'));
  try {
    if (route.view === 'editor') await showEditor(content, route, ticket);
    else if (route.view === 'posts' || route.view === 'drafts') await showList(content, route.view, ticket);
    else if (route.view === 'projects') await showProjects(content, ticket);
    else if (route.view === 'courses') await showCourses(content, ticket);
    else if (route.view === 'categories') await showCategories(content, ticket);
    else await showProfile(content, ticket);
  } catch (error) {
    if (ticket !== routeTicket) return;
    if (error instanceof ApiError && error.status === 401) { await showLogin(); return; }
    content.replaceChildren(element('p', 'notice error', errorMessage(error)),
      button('다시 시도', () => { void showRoute(); }));
  }
}

async function allPages<T>(path: string, size = 100): Promise<T[]> {
  const items: T[] = [];
  for (let page = 0; page < 100; page++) {
    const result = await api.get<Page<T>>(`${path}?page=${page}&size=${size}`);
    if (!Array.isArray(result?.items) || !Number.isSafeInteger(result.totalPages)) throw new ApiError(0, 'response');
    items.push(...result.items);
    if (page + 1 >= result.totalPages) return items;
  }
  throw new ApiError(0, 'response');
}
async function showList(content: HTMLElement, kind: 'posts' | 'drafts', ticket: number): Promise<void> {
  const rows = kind === 'posts' ? await allPages<PostRow>('/admin/posts') : await allPages<DraftRow>('/admin/editor-drafts');
  if (ticket !== routeTicket) return;
  const panel = element('section', 'list-page');
  const top = element('div', 'admin-heading with-filters');
  top.append(element('h1', '', kind === 'posts' ? '글 관리' : '임시저장'));
  const filters = element('nav', 'admin-filter'); filters.setAttribute('aria-label', '글 관리 보기');
  if (kind === 'posts') {
    const params = new URLSearchParams(location.search);
    const selected = params.get('filter') === 'published' ? 'published' :
      params.get('filter') === 'draft' ? 'draft' : 'all';
    for (const [value, label] of [['all', '전체'], ['published', '출간'], ['draft', '미출간']]) {
      const tab = button(label, () => navigate(value === 'all' ? '/manage/?view=posts' :
        `/manage/?view=posts&filter=${value}`), 'filter-tab');
      tab.setAttribute('aria-pressed', String(selected === value)); filters.append(tab);
    }
  } else {
    const link = element('a', '', '글 관리'); link.href = '/manage/?view=posts';
    link.addEventListener('click', (event) => { event.preventDefault(); navigate(link.href); }); filters.append(link);
  }
  const drafts = element('a', '', '임시저장'); drafts.href = '/manage/?view=drafts';
  if (kind === 'drafts') drafts.setAttribute('aria-current', 'page');
  drafts.addEventListener('click', (event) => { event.preventDefault(); navigate(drafts.href); });
  if (kind === 'posts') filters.append(drafts);
  top.append(filters, button('새 글 작성', () => navigate('/manage/?view=editor'), 'primary-button'));
  panel.append(top);
  if (kind === 'posts') {
    const context = element('div', 'content-context');
    context.append(button('프로젝트 관리', () => navigate('/manage/?view=projects')),
      button('Notes 과목 관리', () => navigate('/manage/?view=courses')));
    panel.append(context);
  }
  const searchField = element('label', 'list-search'); searchField.append(element('span', 'sr-only', '제목 검색'));
  const search = element('input'); search.type = 'search'; search.placeholder = '제목 검색'; searchField.append(search); panel.append(searchField);
  const list = element('div', 'admin-table-wrap post-admin-list-wrap card'); panel.append(list); content.replaceChildren(panel);
  const draw = (): void => {
    list.replaceChildren();
    const selected = new URLSearchParams(location.search).get('filter');
    const filtered = rows.filter((row) => row.title.toLocaleLowerCase().includes(search.value.toLocaleLowerCase()) &&
      (kind === 'drafts' || selected !== 'published' && selected !== 'draft' ||
        (row as PostRow).status === (selected === 'published' ? 'PUBLISHED' : 'DRAFT')));
    if (filtered.length === 0) { list.append(element('p', 'empty', '표시할 항목이 없습니다.')); return; }
    const table = element('table', 'admin-table post-admin-table');
    const head = element('thead'); const labels = element('tr');
    for (const label of ['제목', '섹션', '상태', '날짜', '관리']) labels.append(element('th', '', label));
    head.append(labels); const body = element('tbody'); table.append(head, body); list.append(table);
    for (const row of filtered) {
      const item = element('tr');
      const title = element('td'); title.dataset.label = '제목';
      title.append(element('div', 'post-title', row.title || '(제목 없음)'));
      const detail = row.section === 'PROJECT_DOC' ? `Projects · ${(row as PostRow).projectName ?? '프로젝트'}${(row as PostRow).documentOrder ? ` · 문서 ${(row as PostRow).documentOrder}` : ''}` :
        row.section === 'NOTE_CHAPTER' ? `Notes · ${(row as PostRow).courseName ?? '과목'}${(row as PostRow).chapterOrder ? ` · ${(row as PostRow).chapterOrder}강` : ''}` : sectionName[row.section];
      title.append(element('small', '', detail));
      const section = element('td', 'post-section', sectionName[row.section]); section.dataset.label = '섹션';
      const status = element('td', 'post-status', kind === 'posts' ? (row as PostRow).status === 'PUBLISHED' ? '출간됨' : '미출간' : '편집본');
      status.dataset.label = '상태';
      const date = element('td', 'post-date', dateText(row.updatedAt)); date.dataset.label = '날짜';
      const actions = element('div', 'admin-row-actions');
      actions.append(button('수정', () => navigate(`/manage/?view=editor&${kind === 'posts' ? 'postId' : 'draftId'}=${row.id}`), 'quiet'));
      actions.append(writeButton('삭제', () => { void deleteRow(row, kind); }, 'quiet danger'));
      const actionCell = element('td', 'post-actions-cell'); actionCell.dataset.label = '관리'; actionCell.append(actions);
      item.append(title, section, status, date, actionCell); body.append(item);
    }
  };
  search.addEventListener('input', draw); draw();
  if (kind === 'posts') {
    const deploy = element('details', 'deployment-details');
    deploy.append(element('summary', '', '배포 상태'));
    const controls = element('section', 'deploy-card'); controls.id = 'deployment'; deploy.append(controls);
    panel.append(deploy); renderDeployment();
  }
}
async function deleteRow(row: PostRow | DraftRow, kind: 'posts' | 'drafts'): Promise<void> {
  const label = kind === 'posts' ? '원본 글' : '편집본';
  if (!window.confirm(`“${row.title}” ${label}을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`)) return;
  if (isBusy()) { window.alert('배포가 끝난 뒤 삭제할 수 있습니다.'); return; }
  let path = '';
  if (kind === 'drafts') path = `/admin/editor-drafts/${row.id}?revision=${(row as DraftRow).revision}`;
  else {
    const post = row as PostRow;
    path = post.section === 'TECH' ? `/admin/posts/${post.id}` :
      post.section === 'PROJECT_HOME' && post.projectId ? `/admin/projects/${post.projectId}` :
        post.section === 'PROJECT_DOC' && post.projectId ? `/admin/projects/${post.projectId}/documents/${post.id}` :
          post.section === 'NOTE_CHAPTER' && post.courseId ? `/admin/courses/${post.courseId}/chapters/${post.id}` : '';
  }
  if (!path) { window.alert('삭제 경로를 확인할 수 없습니다.'); return; }
  try { await api.write('DELETE', path); await pollDeployment(); await showRoute(); }
  catch (error) { window.alert(errorMessage(error)); }
}

function blankForm(section: Section): Form {
  return { title: '', body: '', section, categoryId: null, tags: [], projectId: null, relatedProjectId: null,
    documentOrder: null, projectMetadata: section === 'PROJECT_HOME' ? {
      status: 'DEV', startPeriod: '', endPeriod: null, overview: '', visibility: 'PUBLIC',
      baseProjectUpdatedAt: null, stackBadgeNames: [],
    } : null, courseId: null, chapterOrder: null, techSeriesOrder: null, summary: '' };
}
function fromDraft(draft: Draft): Form { return { title: draft.title, body: draft.body, section: draft.section,
  categoryId: draft.categoryId, tags: draft.tags, projectId: draft.projectId, relatedProjectId: draft.relatedProjectId,
  documentOrder: draft.documentOrder, projectMetadata: draft.projectMetadata, courseId: draft.courseId,
  chapterOrder: draft.chapterOrder, techSeriesOrder: draft.techSeriesOrder, summary: draft.summary }; }
function fromPost(post: Post): Form { return { title: post.title, body: post.body, section: post.section,
  categoryId: post.category?.id ?? null, tags: post.tags, projectId: post.projectId,
  relatedProjectId: post.relatedProjectId, documentOrder: post.documentOrder, projectMetadata: post.projectMetadata,
  courseId: post.courseId, chapterOrder: post.chapterOrder, techSeriesOrder: post.techSeriesOrder, summary: post.summary }; }
function flattenCategories(nodes: Category[], prefix = ''): Array<[string, string]> {
  return nodes.flatMap((node): Array<[string, string]> => [
    [String(node.id), `${prefix}${node.name}`], ...flattenCategories(node.children, `${prefix}${node.name} › `),
  ]);
}
function categoryDepth(nodes: Category[], id: number | null): number | null {
  for (const node of nodes) {
    if (node.id === id) return node.depth;
    const child = categoryDepth(node.children, id);
    if (child !== null) return child;
  }
  return null;
}

async function showEditor(content: HTMLElement, route: ReturnType<typeof currentRoute>, ticket: number): Promise<void> {
  const [categories, projects, courses] = await Promise.all([
    api.get<Category[]>('/admin/categories'), allPages<Project>('/admin/projects', 20),
    api.get<{ items: Course[] }>('/admin/courses'),
  ]);
  if (ticket !== routeTicket) return;
  let loadedDraft: Draft | null = null;
  let loadedPost: Post | null = null;
  if (route.draftId) loadedDraft = await api.get<Draft>(`/admin/editor-drafts/${route.draftId}`);
  else if (route.postId) {
    const linked = await api.get<Page<DraftRow>>(`/admin/editor-drafts?postId=${route.postId}&page=0&size=10`);
    if (linked.items.length) {
      if (ticket !== routeTicket) return;
      content.replaceChildren(element('p', 'notice', '이 원본에 연결된 편집본이 있습니다. 기존 편집본을 열어 변경을 이어가세요.'),
        button('편집본 열기', () => navigate(`/manage/?view=editor&draftId=${linked.items[0].id}`), 'primary-button'));
      return;
    }
    loadedPost = await api.get<Post>(`/admin/posts/${route.postId}`);
  }
  if (ticket !== routeTicket) return;
  currentDraft = loadedDraft; currentPost = loadedPost;
  currentForm = currentDraft ? fromDraft(currentDraft) : currentPost ? fromPost(currentPost) : blankForm(route.section);
  if (!currentDraft && !currentPost) {
    currentForm.projectId = route.projectId;
    currentForm.courseId = route.courseId;
  }
  if (currentForm.projectMetadata) {
    const project = projects.find((item) => item.id === currentForm?.projectId);
    currentForm.projectMetadata = { ...currentForm.projectMetadata,
      visibility: 'PUBLIC',
      baseProjectUpdatedAt: currentForm.projectMetadata.baseProjectUpdatedAt ?? project?.updatedAt ?? null,
      stackBadgeNames: currentForm.projectMetadata.stackBadgeNames ?? project?.stackBadges?.map((badge) => badge.name) ?? [],
    };
  }
  const form = currentForm;
  const page = element('section', 'editor-page write-surface');
  page.dataset.pane = 'source';
  const top = element('div', 'write-top');
  top.append(button('← 나가기', () => navigate('/manage/?view=posts'), 'back-link'));
  page.append(top);
  const metadata = element('div', 'metadata');
  const first = element('div', 'field-grid'); metadata.append(first);
  const title = inputField(first, '제목'); title.value = form.title; title.maxLength = 200;
  title.placeholder = '제목 없음'; title.className = 'write-title';
  title.addEventListener('input', () => { form.title = title.value; updateEditorActions(); });
  const section = selectField(first, '영역', Object.entries(sectionName)); section.value = form.section;
  section.dataset.fixedDisabled = String(Boolean(currentDraft || currentPost));
  section.disabled = Boolean(currentDraft || currentPost);
  const specific = element('div', 'field-grid'); metadata.append(specific);
  const drawSpecific = (): void => {
    specific.replaceChildren();
    if (form.section === 'TECH' || form.section === 'PROJECT_DOC') {
      const options: Array<[string, string]> = [['', '분류 없음'], ...flattenCategories(categories)];
      const category = selectField(specific, '분류', options); category.value = String(form.categoryId ?? '');
      category.addEventListener('change', () => { form.categoryId = numberOrNull(category.value);
        if (form.section === 'TECH' && categoryDepth(categories, form.categoryId) !== 3) form.techSeriesOrder = null;
        drawSpecific(); updateEditorActions(); });
    }
    if (form.section === 'TECH') {
      const related = selectField(specific, '관련 프로젝트', [['', '없음'], ...projects.map((item) => [String(item.id), item.name] as [string, string])]);
      related.value = String(form.relatedProjectId ?? '');
      related.addEventListener('change', () => { form.relatedProjectId = numberOrNull(related.value); updateEditorActions(); });
      const order = inputField(specific, '시리즈 순서 (선택)', 'number'); order.min = '1'; order.value = String(form.techSeriesOrder ?? '');
      order.dataset.fixedDisabled = String(categoryDepth(categories, form.categoryId) !== 3);
      order.disabled = order.dataset.fixedDisabled === 'true';
      order.addEventListener('input', () => { form.techSeriesOrder = numberOrNull(order.value); updateEditorActions(); });
    } else if (form.section === 'PROJECT_HOME') {
      const meta = form.projectMetadata ?? blankForm('PROJECT_HOME').projectMetadata!; form.projectMetadata = meta;
      const status = selectField(specific, '프로젝트 상태', [['PLAN', '계획'], ['DEV', '개발'], ['MAINT', '유지보수'], ['DONE', '완료']]);
      status.value = meta.status; status.addEventListener('change', () => { meta.status = status.value as ProjectMetadata['status']; updateEditorActions(); });
      const start = inputField(specific, '시작 기간 (YYYY.MM)'); start.value = meta.startPeriod;
      start.addEventListener('input', () => { meta.startPeriod = start.value; updateEditorActions(); });
      const end = inputField(specific, '종료 기간 (선택)'); end.value = meta.endPeriod ?? '';
      end.addEventListener('input', () => { meta.endPeriod = end.value || null; updateEditorActions(); });
      const overview = textareaField(specific, '프로젝트 개요', 2); overview.value = meta.overview; overview.maxLength = 500;
      overview.addEventListener('input', () => { meta.overview = overview.value; updateEditorActions(); });
      const badges = inputField(specific, '기술 배지 (쉼표 구분)'); badges.value = meta.stackBadgeNames.join(', ');
      badges.addEventListener('input', () => { meta.stackBadgeNames = splitCsv(badges.value); updateEditorActions(); });
    } else if (form.section === 'PROJECT_DOC') {
      const project = selectField(specific, '소속 프로젝트', [['', '선택하세요'], ...projects.map((item) => [String(item.id), item.name] as [string, string])]);
      project.value = String(form.projectId ?? ''); project.required = true;
      project.addEventListener('change', () => { form.projectId = numberOrNull(project.value); updateEditorActions(); });
      const order = inputField(specific, '문서 번호', 'number'); order.min = '1'; order.value = String(form.documentOrder ?? '');
      order.addEventListener('input', () => { form.documentOrder = numberOrNull(order.value); updateEditorActions(); });
    } else {
      const course = selectField(specific, '소속 과목', [['', '선택하세요'], ...courses.items.map((item) => [String(item.id), `${item.field} › ${item.name}`] as [string, string])]);
      course.value = String(form.courseId ?? ''); course.required = true;
      course.addEventListener('change', () => { form.courseId = numberOrNull(course.value); updateEditorActions(); });
      const order = inputField(specific, '회차 번호', 'number'); order.min = '1'; order.value = String(form.chapterOrder ?? '');
      order.addEventListener('input', () => { form.chapterOrder = numberOrNull(order.value); updateEditorActions(); });
      const summary = textareaField(specific, '회차 요약', 2); summary.value = form.summary;
      summary.addEventListener('input', () => { form.summary = summary.value; updateEditorActions(); });
    }
  };
  section.addEventListener('change', () => {
    form.section = section.value as Section;
    form.projectMetadata = form.section === 'PROJECT_HOME' ? blankForm('PROJECT_HOME').projectMetadata : null;
    if (form.section === 'PROJECT_HOME' || form.section === 'NOTE_CHAPTER') {
      form.categoryId = null; form.tags = []; tags.value = '';
    }
    if (form.section !== 'TECH') { form.relatedProjectId = null; form.techSeriesOrder = null; }
    if (form.section !== 'PROJECT_DOC') form.documentOrder = null;
    if (form.section !== 'NOTE_CHAPTER') { form.courseId = null; form.chapterOrder = null; form.summary = ''; }
    if (form.section !== 'PROJECT_DOC' && form.section !== 'PROJECT_HOME') form.projectId = null;
    drawSpecific(); updateEditorActions();
  });
  drawSpecific();
  const tags = inputField(metadata, '태그 (쉼표 구분)'); tags.value = form.tags.join(', ');
  tags.closest<HTMLElement>('.field')!.hidden = form.section === 'PROJECT_HOME' || form.section === 'NOTE_CHAPTER';
  tags.addEventListener('input', () => { form.tags = splitCsv(tags.value); updateEditorActions(); });
  section.addEventListener('change', () => { tags.closest<HTMLElement>('.field')!.hidden =
    form.section === 'PROJECT_HOME' || form.section === 'NOTE_CHAPTER'; });
  page.append(metadata);
  const toolbar = element('div', 'editor-toolbar write-toolbar');
  const deploy = element('section', 'deploy-card write-deploy'); deploy.id = 'deployment';
  const indicator = element('span', 'muted'); indicator.id = 'save-indicator';
  const tabs = element('div', 'mobile-tabs');
  tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', '편집 화면');
  const selectPane = (pane: 'source' | 'preview'): void => {
    page.dataset.pane = pane;
    sourceTab.setAttribute('aria-selected', String(pane === 'source'));
    previewTab.setAttribute('aria-selected', String(pane === 'preview'));
    editor?.refreshLayout();
  };
  const sourceTab = button('원문', () => selectPane('source'), 'tab');
  const previewTab = button('미리보기', () => selectPane('preview'), 'tab');
  sourceTab.setAttribute('role', 'tab'); previewTab.setAttribute('role', 'tab');
  sourceTab.setAttribute('aria-selected', 'true'); previewTab.setAttribute('aria-selected', 'false');
  tabs.append(sourceTab, previewTab);
  const tools = element('div', 'editor-tools');
  const fileLabel = element('label', 'editor-tool-icon upload-label');
  fileLabel.setAttribute('aria-label', '이미지 넣기'); fileLabel.title = '이미지 넣기';
  fileLabel.innerHTML = '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/></svg>';
  uploadInput = element('input'); uploadInput.type = 'file'; uploadInput.accept = 'image/jpeg,image/png';
  uploadInput.addEventListener('change', () => { if (uploadInput?.files?.[0]) void uploadAttachment(uploadInput.files[0]); });
  fileLabel.append(uploadInput);
  saveButton = button('편집본 저장', () => { void saveDraft(); }, 'editor-save-button');
  publishButton = button('출간', () => { void publish(); }, 'primary-button');
  tools.append(fileLabel);
  const exportPostId = currentDraft?.postId ?? currentPost?.id ?? null;
  if (exportPostId) {
    const exportLink = element('a', 'editor-save-button', '원고 ZIP');
    exportLink.href = `/api/v1/admin/export?postId=${exportPostId}&includeDrafts=true`;
    exportLink.download = `ken-blog-${exportPostId}.zip`;
    tools.append(exportLink);
  }
  tools.append(saveButton, publishButton); toolbar.append(tabs, deploy, indicator, tools);
  page.append(toolbar);
  const panes = element('div', 'editor-panes');
  const left = element('div', 'editor-pane source-pane');
  left.append(element('div', 'pane-title', 'Markdown 원문 · Tab으로 다음 항목 이동'));
  const editorHost = element('div', 'editor-host'); left.append(editorHost);
  const right = element('div', 'editor-pane preview-pane');
  right.append(element('div', 'pane-title', '자동 미리보기'));
  const preview = element('article', 'markdown-body preview-body'); right.append(preview);
  panes.append(left, right); page.append(panes);
  statusNode = element('p', 'notice'); statusNode.setAttribute('role', 'status'); statusNode.setAttribute('aria-live', 'polite');
  conflictActions = element('div', 'conflict-actions'); conflictActions.hidden = true;
  conflictActions.append(button('현재 원문 다운로드', downloadLocalSource),
    button('서버 저장본 다시 불러오기', () => {
      if (window.confirm('현재 입력을 버리고 서버 저장본을 다시 불러오시겠습니까? 먼저 원문을 다운로드할 수 있습니다.')) void showRoute();
    }));
  page.append(statusNode, conflictActions);
  content.replaceChildren(page);
  renderDeployment();
  editor = new MarkdownEditor(editorHost, preview, form.body, updateEditorActions, () => { void saveDraft(); });
  savedFingerprint = formFingerprint(); updateEditorActions();
}

function splitCsv(value: string): string[] { return [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))]; }
function downloadLocalSource(): void {
  if (!editor) return;
  const id = currentDraft?.id ?? currentPost?.id ?? 'new';
  const file = new Blob([editor.value], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(file);
  const link = element('a'); link.href = url; link.download = `ken-blog-${id}-local.md`;
  document.body.append(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function handleWriteFailure(error: unknown): void {
  message(errorMessage(error), true);
  if (conflictActions) conflictActions.hidden = false;
  if (error instanceof ApiError && error.code === 'CONTENT_WRITE_LOCKED') void pollDeployment();
}
function validateForm(form: Form): boolean {
  if (!form.title.trim() || new TextEncoder().encode(form.body).length > 1024 * 1024) {
    message('제목과 본문 크기를 확인해 주세요. 입력은 유지됩니다.', true); return false;
  }
  if (form.section === 'PROJECT_DOC' && !form.projectId || form.section === 'NOTE_CHAPTER' && !form.courseId) {
    message('소속 프로젝트 또는 과목을 선택해 주세요.', true); return false;
  }
  return true;
}
async function draftPayload(form: Form): Promise<Record<string, unknown>> {
  const body = form.body;
  const parsed = await renderMarkdown(body, {
    attachmentUrl: (id) => Number.isSafeInteger(id) && id > 0 ? `/api/v1/admin/attachments/${id}/content` : null,
  });
  if (parsed.attachmentIds.length > 100 || parsed.wikiTargets.length > 128) throw new ApiError(400);
  return { title: form.title, body,
    categoryId: form.section === 'TECH' || form.section === 'PROJECT_DOC' ? form.categoryId : null,
    tags: form.section === 'TECH' || form.section === 'PROJECT_DOC' ? form.tags : [],
    visibility: 'PUBLIC', attachmentIds: parsed.attachmentIds, wikiTargets: parsed.wikiTargets,
    section: form.section, projectId: form.projectId, relatedProjectId: form.relatedProjectId,
    documentOrder: form.documentOrder, projectMetadata: form.projectMetadata ? { ...form.projectMetadata, visibility: 'PUBLIC' } : null,
    courseId: form.courseId, chapterOrder: form.chapterOrder, techSeriesOrder: form.techSeriesOrder,
    summary: form.summary };
}
/** 현재 revision 또는 원본 수정 시각을 기준으로 편집본을 저장하고 주소만 교체한다. */
async function persistDraft(): Promise<{ saved: Draft; fingerprint: string }> {
  if (!currentForm) throw new Error('validation');
  const snapshot = captureForm(currentForm);
  if (!validateForm(snapshot)) throw new Error('validation');
  const fingerprint = JSON.stringify(snapshot);
  const payload = await draftPayload(snapshot);
  const prior = currentDraft;
  const saved = prior ? await api.write<Draft>('PUT', `/admin/editor-drafts/${prior.id}`, { revision: prior.revision, ...payload }) :
    await api.write<Draft>('POST', '/admin/editor-drafts', {
      postId: currentPost?.id ?? null, baseUpdatedAt: currentPost?.updatedAt ?? null, ...payload,
    });
  if (!Number.isSafeInteger(saved?.id) || !Number.isSafeInteger(saved.revision)) throw new ApiError(0, 'response');
  currentDraft = saved; savedFingerprint = fingerprint;
  if (conflictActions) conflictActions.hidden = true;
  if (!prior) history.replaceState({}, '', `/manage/?view=editor&draftId=${saved.id}`);
  updateEditorActions();
  return { saved, fingerprint };
}
async function saveDraft(): Promise<void> {
  if (writing || isBusy() || !currentForm) return;
  writing = true; updateEditorActions(); message('저장 중…');
  try {
    const result = await persistDraft();
    message(result.fingerprint === formFingerprint() ? '편집본을 저장했습니다.' :
      '저장 중 추가한 입력은 아직 저장되지 않았습니다. 다시 저장해 주세요.');
  } catch (error) { if (!(error instanceof Error && error.message === 'validation')) handleWriteFailure(error); }
  finally { writing = false; updateEditorActions(); await pollDeployment(); }
}
async function publish(): Promise<void> {
  if (writing || isBusy() || !currentForm || !validateForm(captureForm(currentForm))) return;
  if (!window.confirm('현재 원고를 공개 출간하시겠습니까? 출간 요청 후 Pages 배포가 시작됩니다.')) return;
  writing = true; updateEditorActions(); message('출간 준비 중…');
  try {
    let saved = currentDraft;
    const snapshot = formFingerprint();
    if (!saved || dirty()) saved = (await persistDraft()).saved;
    if (snapshot !== formFingerprint()) { message('저장 중 추가한 입력이 있습니다. 다시 출간해 주세요.', true); return; }
    publicationBaselineId = typeof deployment?.id === 'string' ? deployment.id : null;
    publicationDeploymentId = null;
    publicationPending = true;
    const published = await api.write<Post>('POST', `/admin/editor-drafts/${saved.id}/publish`, { revision: saved.revision });
    if (!Number.isSafeInteger(published?.id) || typeof published.updatedAt !== 'string') throw new ApiError(0, 'response');
    currentPost = published; currentDraft = null; savedFingerprint = snapshot;
    history.replaceState({}, '', `/manage/?view=editor&postId=${published.id}`);
    await pollDeployment();
    message(deploymentAvailable ? publicationDeploymentId !== null ?
      deployment?.status === 'SUCCEEDED' ? '원고가 DB에 출간되었고 Pages 배포가 완료되었습니다.' :
        deployment?.status === 'FAILED' ? '원고가 DB에 출간되었지만 Pages 배포가 실패했습니다.' :
          '원고가 DB에 출간되었습니다. Pages 배포가 진행 중입니다.' :
        '원고가 DB에 출간되었습니다. Pages 배포 요청 상태를 확인 중입니다.' :
      '원고가 DB에 출간되었습니다. Pages 배포 상태는 현재 확인할 수 없습니다.');
  } catch (error) { handleWriteFailure(error); }
  finally { writing = false; updateEditorActions(); }
}
/** 업로드가 READY로 확인된 뒤에만 첨부 Markdown을 현재 선택 영역에 넣는다. */
async function uploadAttachment(file: File): Promise<void> {
  if (writing || isBusy()) return;
  if (!['image/jpeg', 'image/png'].includes(file.type) || file.size === 0 || file.size > 10 * 1024 * 1024) {
    message('10 MiB 이하 JPEG 또는 PNG를 선택해 주세요.', true); return;
  }
  writing = true; updateEditorActions(); message('이미지 업로드 중…');
  try {
    const form = new FormData(); form.set('file', file, file.name);
    const uploaded = await api.upload<{ id: number; status: string }>('/admin/attachments', form);
    if (!Number.isSafeInteger(uploaded?.id) || uploaded.status !== 'READY') throw new ApiError(0, 'response');
    const caption = file.name.replace(/[\\()[\]|\r\n]/g, ' ').trim() || '이미지';
    editor?.insert(`![${caption}](attachment:${uploaded.id})`);
    message('이미지를 원문에 넣었습니다. 편집본 저장을 눌러 연결하세요.');
  } catch (error) { handleWriteFailure(error); }
  finally { if (uploadInput) uploadInput.value = ''; writing = false; updateEditorActions(); await pollDeployment(); }
}

async function showProjects(content: HTMLElement, ticket: number): Promise<void> {
  const projects = await allPages<Project>('/admin/projects', 20);
  if (ticket !== routeTicket) return;
  const panel = element('section', 'panel project-manager');
  panel.append(heading('Projects', button('글 관리로', () => navigate('/manage/?view=posts'))));
  const list = element('div', 'projects-grid');
  for (const project of projects) {
    const row = element('article', 'project-card card');
    const info = element('div', 'row-info');
    info.append(element('span', 'project-card-top', `${project.status} · ${project.startPeriod}${project.endPeriod ? ` – ${project.endPeriod}` : ''}`),
      element('h2', '', project.name));
    if (project.overview) info.append(element('p', '', project.overview));
    const order = element('label', 'order-field');
    order.append(element('span', '', '카드 순서'));
    const orderInput = element('input'); orderInput.type = 'number'; orderInput.step = '1';
    orderInput.value = Number.isSafeInteger(project.sortOrder) ? String(project.sortOrder) : '';
    orderInput.setAttribute('aria-label', `${project.name} 카드 순서`);
    orderInput.dataset.writeAction = 'true'; orderInput.disabled = isBusy();
    order.append(orderInput);
    const actions = element('div', 'row-actions');
    actions.append(button('대문 편집', () => {
      if (project.homePostId) navigate(`/manage/?view=editor&postId=${project.homePostId}`);
    }), button('문서 쓰기', () => navigate(`/manage/?view=editor&section=PROJECT_DOC&projectId=${project.id}`)),
    writeButton('순서 저장', () => { void (async () => {
      const value = Number(orderInput.value);
      if (!orderInput.value.trim() || !Number.isSafeInteger(value)) {
        window.alert('안전한 정수로 순서를 입력해 주세요.'); return;
      }
      if (isBusy()) { window.alert('배포가 끝난 뒤 저장할 수 있습니다.'); return; }
      try { await api.write('PUT', `/admin/projects/${project.id}/order`, { order: value }); await showRoute(); }
      catch (error) { window.alert(errorMessage(error)); await pollDeployment(); }
    })(); }), writeButton('삭제', () => { void (async () => {
      if (!window.confirm(`“${project.name}” 프로젝트와 연결 문서를 삭제하시겠습니까?`)) return;
      if (isBusy()) { window.alert('배포가 끝난 뒤 삭제할 수 있습니다.'); return; }
      try { await api.write('DELETE', `/admin/projects/${project.id}`); await showRoute(); }
      catch (error) { window.alert(errorMessage(error)); await pollDeployment(); }
    })(); }, 'small-button danger'));
    row.append(info, order, actions); list.append(row);
  }
  const create = button('＋\n새 프로젝트', () => navigate('/manage/?view=editor&section=PROJECT_HOME'), 'project-card project-create-card');
  list.append(create);
  panel.append(list); content.replaceChildren(panel);
}

async function showCourses(content: HTMLElement, ticket: number): Promise<void> {
  const response = await api.get<{ items: Course[] }>('/admin/courses');
  if (ticket !== routeTicket) return;
  const knownFields = [...new Set(response.items.map((item) => item.field))];
  const panel = element('section', 'panel course-manager');
  const createButton = button('새 과목', () => {
    editingId = null; form.reset(); formTitle.textContent = '새 과목'; submit.textContent = '과목 생성';
    status.value = 'IN_PROGRESS'; statusField.hidden = true; form.hidden = !form.hidden;
    fieldChoice.value = knownFields[0] ?? '__new__'; syncFieldChoice();
    if (!form.hidden) (field.hidden ? fieldChoice : field).focus();
  }, 'primary-button');
  panel.append(heading('Notes', createButton));
  const list = element('div', 'course-groups');
  const groups = new Map<string, HTMLElement>();
  for (const course of response.items) {
    let grid = groups.get(course.field);
    if (!grid) { const group = element('section', 'notes-group'); group.append(element('h2', '', course.field));
      grid = element('div', 'notes-grid'); group.append(grid); list.append(group); groups.set(course.field, grid); }
    const row = element('article', 'course-card card');
    row.append(element('h3', '', course.name), element('p', '', course.description),
      element('div', 'course-card-meta', course.status === 'COMPLETED' ? '완결' : '진행 중'));
    const actions = element('div', 'row-actions');
    actions.append(button('회차 쓰기', () => navigate(`/manage/?view=editor&section=NOTE_CHAPTER&courseId=${course.id}`)),
      writeButton('수정', () => {
        fieldChoice.value = knownFields.includes(course.field) ? course.field : '__new__'; syncFieldChoice();
        field.value = course.field; name.value = course.name; description.value = course.description;
        status.value = course.status; editingId = course.id; formTitle.textContent = '과목 수정'; submit.textContent = '변경 저장';
        statusField.hidden = false; form.hidden = false; fieldChoice.focus();
      }),
      writeButton('삭제', () => { void (async () => {
        if (!window.confirm(`“${course.name}” 과목을 삭제하시겠습니까? 회차 연결도 제거됩니다.`)) return;
        if (isBusy()) { window.alert('배포가 끝난 뒤 삭제할 수 있습니다.'); return; }
        try { await api.write('DELETE', `/admin/courses/${course.id}`); await showRoute(); }
        catch (error) { window.alert(errorMessage(error)); }
      })(); }, 'small-button danger'));
    row.append(actions); grid.append(row);
  }
  panel.append(list);
  if (response.items.length === 0) panel.append(element('div', 'message-card card', '아직 등록된 과목이 없습니다.'));
  const form = element('form', 'course-create card'); form.hidden = true;
  const formTitle = element('h2', 'sr-only', '새 과목'); form.append(formTitle);
  let editingId: number | null = null;
  const fieldChoice = selectField(form, '분야', [
    ...knownFields.map((value) => [value, value] as [string, string]), ['__new__', '＋ 새 분야'],
  ]);
  const field = element('input'); field.type = 'text'; field.maxLength = 100;
  field.placeholder = '새 분야 이름'; field.setAttribute('aria-label', '새 분야 이름');
  fieldChoice.closest('label')!.append(field);
  const syncFieldChoice = (): void => {
    const isNew = fieldChoice.value === '__new__';
    field.hidden = !isNew; field.required = isNew;
    field.value = isNew ? '' : fieldChoice.value;
  };
  fieldChoice.addEventListener('change', () => { syncFieldChoice(); if (!field.hidden) field.focus(); });
  fieldChoice.value = knownFields[0] ?? '__new__'; syncFieldChoice();
  const name = inputField(form, '과목 이름'); name.required = true;
  const description = inputField(form, '한 줄 설명'); description.required = true; description.maxLength = 500;
  description.placeholder = '이 과목에서 다루는 것';
  const status = selectField(form, '상태', [['IN_PROGRESS', '진행 중'], ['COMPLETED', '완료']]);
  const statusField = status.closest('label')!; statusField.hidden = true;
  const formActions = element('div', 'course-form-actions');
  const submit = element('button', 'primary-button', '과목 생성'); submit.type = 'submit'; submit.dataset.writeAction = 'true';
  submit.disabled = isBusy(); formActions.append(submit);
  const cancel = button('취소', () => { editingId = null; form.reset(); form.hidden = true;
    statusField.hidden = true; createButton.focus(); }, 'small-button'); formActions.append(cancel); form.append(formActions);
  const note = element('p', 'notice'); form.append(note);
  form.addEventListener('submit', (event) => { event.preventDefault(); void (async () => {
    if (isBusy()) { note.textContent = '배포가 끝난 뒤 생성할 수 있습니다.'; return; }
    submit.disabled = true;
    try { await api.write(editingId === null ? 'POST' : 'PUT', editingId === null ? '/admin/courses' : `/admin/courses/${editingId}`,
      { field: field.value, name: name.value, description: description.value, status: status.value }); await showRoute(); }
    catch (error) { note.textContent = errorMessage(error); submit.disabled = false; }
  })(); });
  panel.insertBefore(form, list); content.replaceChildren(panel);
}

async function showCategories(content: HTMLElement, ticket: number): Promise<void> {
  let categories = await api.get<Category[]>('/admin/categories');
  if (ticket !== routeTicket) return;
  const panel = element('section', 'panel category-page'); panel.append(heading('분류 관리'));
  const tree = element('div', 'category-admin card');
  const note = element('p', 'notice'); note.setAttribute('role', 'status');
  panel.append(tree, note); content.replaceChildren(panel);

  /** 저장 후 현재 폴더 펼침 상태를 유지하면서 서버의 분류 트리를 다시 읽는다. */
  const refresh = async (): Promise<void> => {
    categories = await api.get<Category[]>('/admin/categories');
    if (ticket === routeTicket) drawTree();
  };
  /** 원본 폴더 목록 안에서 대·중·소분류의 새 이름을 입력받는다. */
  const addForm = (parent: Category | null): HTMLFormElement => {
    const form = element('form', 'category-inline-form');
    const input = element('input'); input.type = 'text'; input.maxLength = 100;
    input.required = true; input.setAttribute('aria-label', `새 ${parent ? ['대분류', '중분류', '소분류'][parent.depth] ?? '분류' : '대분류'} 이름`);
    const submit = element('button', '', '추가'); submit.type = 'submit'; submit.dataset.writeAction = 'true'; submit.disabled = isBusy();
    const cancel = button('취소', () => form.replaceWith(addButton(parent)));
    form.append(input, submit, cancel);
    form.addEventListener('submit', (event) => { event.preventDefault(); void (async () => {
      if (isBusy()) { note.textContent = '배포가 끝난 뒤 생성할 수 있습니다.'; return; }
      submit.disabled = true;
      try {
        await api.write('POST', '/admin/categories', { path: parent ? `${parent.path}/${input.value.trim()}` : input.value.trim() });
        if (parent) expandedCategoryIds.add(parent.id);
        note.textContent = '분류를 추가했습니다.'; await refresh();
      } catch (error) { note.textContent = errorMessage(error); submit.disabled = false; }
    })(); });
    return form;
  };
  const addButton = (parent: Category | null): HTMLButtonElement => {
    const trigger = writeButton(`＋ 새 ${parent ? ['대분류', '중분류', '소분류'][parent.depth] ?? '분류' : '대분류'}`,
      () => { const form = addForm(parent); trigger.replaceWith(form); form.querySelector('input')?.focus(); }, 'category-add');
    return trigger;
  };

  /** 원본 폴더/화살표/하위 생성/삭제 확인을 그린다. 순서만 숫자 입력으로 지정한다. */
  const drawNode = (node: Category, parentName: string): HTMLLIElement => {
    const item = element('li', 'category-admin-node');
    item.dataset.categoryId = String(node.id);
    const row = element('div', 'category-admin-row');
    const folder = button('', () => {
      if (expandedCategoryIds.has(node.id)) expandedCategoryIds.delete(node.id);
      else expandedCategoryIds.add(node.id);
      drawTree();
      tree.querySelector<HTMLElement>(`[data-category-id="${node.id}"] > .category-admin-row > .category-folder`)?.focus();
    }, 'category-folder');
    folder.setAttribute('aria-expanded', String(expandedCategoryIds.has(node.id)));
    folder.setAttribute('aria-label', `${node.name} ${expandedCategoryIds.has(node.id) ? '접기' : '펼치기'}`);
    const chevron = element('span', node.children.length ? 'category-chevron' : 'category-chevron-empty');
    chevron.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true" style="transform:rotate(${expandedCategoryIds.has(node.id) ? 90 : 0}deg)"><path d="m9 6 6 6-6 6"/></svg>`;
    const folderIcon = element('span', 'category-folder-icon'); folderIcon.setAttribute('aria-hidden', 'true');
    folderIcon.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';
    folder.append(chevron, folderIcon, element('span', 'category-folder-name', node.name),
      element('span', 'category-folder-count', String(node.totalCount)));
    const order = element('label', 'category-order');
    const input = element('input'); input.type = 'number'; input.step = '1';
    input.min = '-2147483648'; input.max = '2147483647';
    input.value = Number.isInteger(node.sortOrder) ? String(node.sortOrder) : '';
    input.setAttribute('aria-label', `${node.path} 분류 순서`); input.dataset.writeAction = 'true'; input.disabled = isBusy();
    order.append(input);
    const saveOrder = writeButton('저장', () => { void (async () => {
      if (isBusy()) { note.textContent = '배포가 끝난 뒤 저장할 수 있습니다.'; return; }
      const value = Number(input.value);
      if (!input.value.trim() || !Number.isInteger(value) || value < -2147483648 || value > 2147483647) {
        note.textContent = '32비트 정수로 분류 순서를 입력해 주세요.'; return;
      }
      try { await api.write('PUT', `/admin/categories/${node.id}/order`, { order: value });
        note.textContent = '분류 순서를 저장했습니다.'; await refresh(); }
      catch (error) { note.textContent = errorMessage(error); }
    })(); }, 'category-order-save');
    const remove = writeButton('삭제', () => {
      if (item.querySelector('.inline-confirm')) return;
      const confirmation = element('div', 'inline-confirm'); confirmation.setAttribute('role', 'alertdialog');
      confirmation.setAttribute('aria-label', '분류 삭제 확인');
      confirmation.append(element('p', 'inline-confirm-title', `“${node.path.replaceAll('/', ' › ')}” 분류를 삭제합니다.`));
      if (node.totalCount) confirmation.append(element('p', '', `글 ${node.totalCount}개는 “${parentName}”(으)로 옮겨집니다.`));
      if (node.children.length) confirmation.append(element('p', '', `하위 분류 ${node.children.length}개도 함께 삭제됩니다.`));
      const actions = element('div', 'inline-confirm-actions');
      const cancel = button('취소', () => { confirmation.remove(); remove.focus(); });
      actions.append(cancel, writeButton(node.totalCount ? '옮기고 삭제' : '삭제', () => {
        void (async () => { if (isBusy()) { note.textContent = '배포가 끝난 뒤 삭제할 수 있습니다.'; return; }
          try { await api.write('DELETE', `/admin/categories/${node.id}`);
          note.textContent = '분류를 삭제했습니다.'; await refresh(); }
          catch (error) { note.textContent = errorMessage(error); } })();
      }, 'small-button danger'));
      confirmation.append(actions); item.append(confirmation); cancel.focus();
    }, 'category-delete');
    remove.setAttribute('aria-label', `${node.path} 분류 삭제`);
    row.append(folder, order, saveOrder, remove); item.append(row);
    if (expandedCategoryIds.has(node.id)) {
      const children = element('ul');
      for (const child of node.children) children.append(drawNode(child, node.name));
      item.append(children);
      if (node.depth < 3) item.append(addButton(node));
    }
    return item;
  };
  const drawTree = (): void => {
    const roots = element('ul');
    for (const category of categories) roots.append(drawNode(category, '상위 분류'));
    tree.replaceChildren(roots, addButton(null));
  };
  drawTree();
}

async function showProfile(content: HTMLElement, ticket: number): Promise<void> {
  type Profile = { name: string; tagline: string; intro: string; github: string; email: string; photoUrl: string | null };
  const profile = await api.get<Profile>('/profile');
  if (ticket !== routeTicket) return;
  let saved = { ...profile, email: profile.email ?? '' };
  let photoMode: 'keep' | 'upload' | 'remove' = 'keep';
  let selectedPhoto: File | null = null;
  const panel = element('section', 'panel profile-page'); panel.append(heading('홈 소개'));
  const manager = element('div', 'profile-manager');
  const form = element('form', 'admin-form card'); form.dataset.contentForm = 'true';
  const fields = element('fieldset'); fields.disabled = isBusy(); form.append(fields);
  const photoControl = element('div', 'profile-photo-control');
  const avatar = element('span', 'profile-edit-avatar'); avatar.setAttribute('aria-label', '현재 프로필 사진');
  const photoActions = element('div');
  const upload = element('label', 'small-button profile-upload-button', '사진 올리기');
  const photoInput = element('input'); photoInput.type = 'file'; photoInput.accept = 'image/png,image/jpeg,image/webp';
  upload.append(photoInput);
  const removePhoto = button('사진 빼기', () => { selectedPhoto = null;
    if (profileObjectUrl) { URL.revokeObjectURL(profileObjectUrl); profileObjectUrl = null; }
    photoInput.value = ''; photoMode = 'remove'; updatePreview(); });
  photoActions.append(upload, removePhoto); photoControl.append(avatar, photoActions); fields.append(photoControl);
  const name = inputField(fields, '이름'); name.value = saved.name; name.required = true; name.maxLength = 100;
  name.placeholder = '표시될 이름';
  const tagline = inputField(fields, '한 줄 소개'); tagline.value = saved.tagline; tagline.maxLength = 240;
  tagline.placeholder = '이름 옆에 붙는 한 줄';
  const intro = textareaField(fields, '소개', 5); intro.value = saved.intro; intro.maxLength = 5000;
  intro.placeholder = '두세 줄 정도';
  const github = inputField(fields, 'GitHub', 'url'); github.value = saved.github; github.maxLength = 500;
  github.placeholder = 'https://github.com/아이디';
  const email = inputField(fields, '이메일', 'email'); email.value = saved.email; email.maxLength = 254;
  email.placeholder = 'name@example.com (비워 두면 홈에 표시하지 않음)';
  const actions = element('div', 'admin-form-actions');
  const reset = button('되돌리기', () => {
    name.value = saved.name; tagline.value = saved.tagline; intro.value = saved.intro;
    github.value = saved.github; email.value = saved.email; selectedPhoto = null; photoInput.value = '';
    if (profileObjectUrl) { URL.revokeObjectURL(profileObjectUrl); profileObjectUrl = null; }
    photoMode = 'keep'; notice.textContent = ''; updatePreview();
  });
  const submit = element('button', 'primary-button', '저장'); submit.type = 'submit';
  actions.append(reset, submit); fields.append(actions);
  const notice = element('p', 'notice'); notice.setAttribute('role', 'status'); fields.append(notice);
  const preview = element('div', 'profile-preview');
  const previewHeading = element('div', 'profile-preview-heading'); previewHeading.append(element('h2', '', '미리보기'));
  const publicLink = element('a', 'small-button', '홈에서 보기'); publicLink.href = PUBLIC_SITE;
  previewHeading.append(publicLink); preview.append(previewHeading);
  const card = element('section', 'profile-card card'); card.setAttribute('aria-label', '블로그 소개'); preview.append(card);
  manager.append(form, preview); panel.append(manager); content.replaceChildren(panel);

  /** 입력 중인 값과 사진 선택을 원본 홈 프로필 카드 구조로 즉시 표시한다. */
  const updatePreview = (): void => {
    const photo = photoMode === 'remove' ? null : photoMode === 'upload' ? profileObjectUrl : saved.photoUrl;
    const image = (className: string): HTMLElement => {
      const holder = element('span', className);
      if (photo) { const img = element('img'); img.src = photo; img.alt = ''; holder.append(img); }
      else holder.textContent = name.value.trim().slice(0, 1) || 'K';
      return holder;
    };
    avatar.replaceChildren(...image('avatar-preview-content').childNodes);
    removePhoto.hidden = !photo && !saved.photoUrl;
    const head = element('div', 'profile-head');
    const identity = element('div'); identity.append(element('h2', '', name.value || 'ken.blog'));
    if (tagline.value) identity.append(element('p', '', tagline.value));
    head.append(image('profile-avatar'), identity); card.replaceChildren(head);
    if (intro.value) card.append(element('p', 'profile-intro', intro.value));
    const links = element('div', 'profile-links');
    if (github.value.startsWith('https://github.com/')) {
      const link = element('a'); link.href = github.value;
      link.target = '_blank'; link.rel = 'noreferrer noopener'; links.append(link);
      link.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .9a11.1 11.1 0 0 0-3.51 21.63c.55.1.76-.24.76-.54v-2.14c-3.09.67-3.74-1.31-3.74-1.31-.5-1.28-1.23-1.62-1.23-1.62-1.01-.69.08-.68.08-.68 1.12.08 1.71 1.15 1.71 1.15.99 1.7 2.59 1.21 3.22.92.1-.72.39-1.21.71-1.49-2.47-.28-5.07-1.23-5.07-5.49 0-1.21.43-2.2 1.14-2.98-.11-.28-.49-1.41.11-2.94 0 0 .93-.3 3.05 1.14a10.6 10.6 0 0 1 5.55 0c2.12-1.44 3.04-1.14 3.04-1.14.61 1.53.23 2.66.12 2.94.71.78 1.14 1.77 1.14 2.98 0 4.27-2.61 5.21-5.09 5.48.4.35.76 1.03.76 2.08v3.09c0 .3.2.65.77.54A11.1 11.1 0 0 0 12 .9Z"/></svg>';
      link.append(document.createTextNode('GitHub'));
    }
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value)) {
      const link = element('a', 'profile-email-link');
      link.href = `mailto:${encodeURIComponent(email.value).replace('%40', '@')}`;
      link.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="m3.5 6 8.5 7 8.5-7"/></svg>';
      link.append(element('span', '', email.value)); links.append(link);
    }
    if (links.childElementCount) card.append(links);
  };
  for (const field of [name, tagline, intro, github, email]) field.addEventListener('input', updatePreview);
  photoInput.addEventListener('change', () => {
    const file = photoInput.files?.[0]; if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size === 0 || file.size > 10 * 1024 * 1024) {
      notice.textContent = '10MiB 이하 PNG, JPEG 또는 WebP 이미지를 선택해 주세요.'; photoInput.value = ''; return;
    }
    if (profileObjectUrl) URL.revokeObjectURL(profileObjectUrl);
    profileObjectUrl = URL.createObjectURL(file); selectedPhoto = file; photoMode = 'upload';
    notice.textContent = ''; updatePreview();
  });
  form.addEventListener('submit', (event) => { event.preventDefault(); void (async () => {
    if (isBusy()) { notice.textContent = '배포가 끝난 뒤 저장할 수 있습니다.'; return; }
    fields.dataset.saving = 'true'; fields.disabled = true; submit.textContent = '저장 중…'; notice.textContent = '';
    const payload = new FormData();
    payload.set('profile', new Blob([JSON.stringify({ name: name.value, tagline: tagline.value,
      intro: intro.value, github: github.value, email: email.value })], { type: 'application/json' }));
    if (photoMode === 'upload' && selectedPhoto) payload.set('file', selectedPhoto);
    payload.set('removePhoto', String(photoMode === 'remove'));
    try {
      const updated = await api.upload<Profile>('/admin/profile/save', payload);
      if (!updated || typeof updated.name !== 'string' || typeof updated.tagline !== 'string' ||
        typeof updated.intro !== 'string' || typeof updated.github !== 'string' ||
        typeof updated.email !== 'string' || updated.photoUrl !== null && typeof updated.photoUrl !== 'string')
        throw new ApiError(0, 'response');
      saved = updated;
      name.value = saved.name; tagline.value = saved.tagline; intro.value = saved.intro;
      github.value = saved.github; email.value = saved.email;
      selectedPhoto = null; photoInput.value = ''; photoMode = 'keep';
      if (profileObjectUrl) { URL.revokeObjectURL(profileObjectUrl); profileObjectUrl = null; }
      notice.textContent = '저장했습니다.'; updatePreview();
    } catch (error) { notice.textContent = errorMessage(error); }
    finally { delete fields.dataset.saving; fields.disabled = isBusy(); submit.textContent = '저장'; await pollDeployment(); }
  })(); });
  updatePreview();
}

async function start(): Promise<void> {
  const savedTheme = localStorage.getItem('ken-admin-theme');
  document.documentElement.dataset.theme = savedTheme === 'dark' || savedTheme === 'light' ? savedTheme :
    window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  try { loginUser = (await api.me()).username; await showRoute(); await pollDeployment(); startDeploymentPolling(); }
  catch { await showLogin(); }
}
function startDeploymentPolling(): void {
  window.clearInterval(deploymentTimer);
  deploymentTimer = window.setInterval(() => { if (document.visibilityState === 'visible') void pollDeployment(); }, 5000);
}
void start();
