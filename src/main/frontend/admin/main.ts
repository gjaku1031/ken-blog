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
  if (dirty() || writing) { event.preventDefault(); event.returnValue = ''; }
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
  const entries: Array<[View, string]> = [['posts', '글'], ['drafts', '편집본'], ['editor', '새 글'],
    ['projects', '프로젝트'], ['courses', '과목'], ['categories', '분류'], ['profile', '프로필']];
  for (const [view, label] of entries) {
    const link = element('a', '', label); link.href = view === 'editor' ? '/manage/?view=editor' : `/manage/?view=${view}`;
    if (view === activeView) link.setAttribute('aria-current', 'page');
    link.addEventListener('click', (event) => { event.preventDefault(); navigate(link.href); });
    nav.append(link);
  }
  const exportLink = element('a', '', '전체 출간 원고 ZIP');
  exportLink.href = '/api/v1/admin/export?all=true&includeDrafts=false'; exportLink.download = 'ken-blog-export.zip';
  const draftExport = element('a', '', '전체 초안 포함 ZIP');
  draftExport.href = '/api/v1/admin/export?all=true&includeDrafts=true'; draftExport.download = 'ken-blog-drafts-export.zip';
  nav.append(exportLink, draftExport);
  const deploy = element('section', 'deploy-card'); deploy.id = 'deployment';
  aside.append(deploy);
  const content = element('section', 'admin-content'); content.id = 'content';
  layout.append(aside, content); body.append(layout); wrap.append(body, siteFooter());
  return wrap;
}
function renderDeployment(): void {
  const node = document.querySelector<HTMLElement>('#deployment');
  if (!node) return;
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
  panel.append(heading(kind === 'posts' ? '글 관리' : '편집본', button('새 글 작성', () => navigate('/manage/?view=editor'), 'primary-button')));
  const searchField = element('label', 'list-search'); searchField.append(element('span', 'sr-only', '제목 검색'));
  const search = element('input'); search.type = 'search'; search.placeholder = '제목 검색'; searchField.append(search); panel.append(searchField);
  const list = element('div', 'admin-table-wrap post-admin-list-wrap card'); panel.append(list); content.replaceChildren(panel);
  const draw = (): void => {
    list.replaceChildren();
    const filtered = rows.filter((row) => row.title.toLocaleLowerCase().includes(search.value.toLocaleLowerCase()));
    if (filtered.length === 0) { list.append(element('p', 'empty', '표시할 항목이 없습니다.')); return; }
    const table = element('table', 'admin-table post-admin-table');
    const head = element('thead'); const labels = element('tr');
    for (const label of ['제목', '섹션', '상태', '날짜', '관리']) labels.append(element('th', '', label));
    head.append(labels); const body = element('tbody'); table.append(head, body); list.append(table);
    for (const row of filtered) {
      const item = element('tr');
      const title = element('td', 'post-title', row.title || '(제목 없음)'); title.dataset.label = '제목';
      const section = element('td', 'post-section', sectionName[row.section]); section.dataset.label = '섹션';
      const status = element('td', 'post-status', kind === 'posts' ? (row as PostRow).status === 'PUBLISHED' ? '출간됨' : '미출간' : '편집본');
      status.dataset.label = '상태';
      const date = element('td', 'post-date', dateText(row.updatedAt)); date.dataset.label = '날짜';
      const actions = element('div', 'admin-row-actions');
      actions.append(button('수정', () => navigate(`/manage/?view=editor&${kind === 'posts' ? 'postId' : 'draftId'}=${row.id}`), 'quiet'));
      if (kind === 'posts') {
        const post = row as PostRow;
        const selector = post.section === 'PROJECT_HOME' && post.projectId ? `projectId=${post.projectId}` :
          post.section === 'NOTE_CHAPTER' && post.courseId ? `courseId=${post.courseId}` : `postId=${post.id}`;
        const exportLink = element('a', 'quiet', 'ZIP');
        exportLink.href = `/api/v1/admin/export?${selector}&includeDrafts=${post.status === 'DRAFT'}`;
        exportLink.download = `ken-blog-${post.id}.zip`;
        exportLink.setAttribute('aria-label', `${post.title || '제목 없는 글'} ZIP 내보내기`);
        actions.append(exportLink);
      }
      actions.append(writeButton('삭제', () => { void deleteRow(row, kind); }, 'quiet danger'));
      const actionCell = element('td', 'post-actions-cell'); actionCell.dataset.label = '관리'; actionCell.append(actions);
      item.append(title, section, status, date, actionCell); body.append(item);
    }
  };
  search.addEventListener('input', draw); draw();
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
  tools.append(fileLabel, saveButton, publishButton); toolbar.append(tabs, deploy, indicator, tools);
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
  const panel = element('section', 'panel');
  panel.append(heading('프로젝트', button('새 프로젝트 대문', () => navigate('/manage/?view=editor&section=PROJECT_HOME'), 'primary-button')));
  const list = element('div', 'row-list');
  for (const project of projects) {
    const row = element('article', 'row project-row');
    const info = element('div', 'row-info');
    info.append(element('strong', '', project.name), element('span', 'muted', `${project.status} · ${project.startPeriod}`));
    const order = element('label', 'order-field');
    order.append(element('span', '', '카드 순서'));
    const orderInput = element('input'); orderInput.type = 'number'; orderInput.step = '1';
    orderInput.value = Number.isSafeInteger(project.sortOrder) ? String(project.sortOrder) : '';
    orderInput.setAttribute('aria-label', `${project.name} 카드 순서`);
    orderInput.dataset.writeAction = 'true'; orderInput.disabled = isBusy();
    order.append(orderInput);
    const actions = element('div', 'row-actions');
    const exportLink = element('a', 'small-button', 'ZIP');
    exportLink.href = `/api/v1/admin/export?projectId=${project.id}&includeDrafts=false`;
    exportLink.download = `ken-blog-project-${project.id}.zip`;
    exportLink.setAttribute('aria-label', `${project.name} ZIP 내보내기`);
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
    })(); }), exportLink, writeButton('삭제', () => { void (async () => {
      if (!window.confirm(`“${project.name}” 프로젝트와 연결 문서를 삭제하시겠습니까?`)) return;
      if (isBusy()) { window.alert('배포가 끝난 뒤 삭제할 수 있습니다.'); return; }
      try { await api.write('DELETE', `/admin/projects/${project.id}`); await showRoute(); }
      catch (error) { window.alert(errorMessage(error)); await pollDeployment(); }
    })(); }, 'small-button danger'));
    row.append(info, order, actions); list.append(row);
  }
  if (projects.length === 0) list.append(element('p', 'empty', '프로젝트가 없습니다.'));
  panel.append(list); content.replaceChildren(panel);
}

async function showCourses(content: HTMLElement, ticket: number): Promise<void> {
  const response = await api.get<{ items: Course[] }>('/admin/courses');
  if (ticket !== routeTicket) return;
  const panel = element('section', 'panel'); panel.append(heading('Notes 과목'));
  const list = element('div', 'row-list');
  for (const course of response.items) {
    const row = element('div', 'row'); const info = element('div', 'row-info');
    info.append(element('strong', '', `${course.field} › ${course.name}`), element('span', 'muted', course.description));
    const actions = element('div', 'row-actions');
    actions.append(button('회차 쓰기', () => navigate(`/manage/?view=editor&section=NOTE_CHAPTER&courseId=${course.id}`)),
      writeButton('수정', () => {
        field.value = course.field; name.value = course.name; description.value = course.description;
        status.value = course.status; editingId = course.id; formTitle.textContent = '과목 수정'; submit.textContent = '변경 저장';
        cancel.hidden = false; field.focus();
      }),
      writeButton('삭제', () => { void (async () => {
        if (!window.confirm(`“${course.name}” 과목을 삭제하시겠습니까? 회차 연결도 제거됩니다.`)) return;
        if (isBusy()) { window.alert('배포가 끝난 뒤 삭제할 수 있습니다.'); return; }
        try { await api.write('DELETE', `/admin/courses/${course.id}`); await showRoute(); }
        catch (error) { window.alert(errorMessage(error)); }
      })(); }, 'small-button danger'));
    row.append(info, actions); list.append(row);
  }
  panel.append(list);
  const form = element('form', 'subform');
  const formTitle = element('h2', '', '과목 만들기'); form.append(formTitle);
  let editingId: number | null = null;
  const field = inputField(form, '분야'); field.required = true;
  const name = inputField(form, '과목 이름'); name.required = true;
  const description = textareaField(form, '소개', 2); description.required = true;
  const status = selectField(form, '상태', [['IN_PROGRESS', '진행 중'], ['COMPLETED', '완료']]);
  const submit = element('button', 'primary-button', '과목 생성'); submit.type = 'submit'; submit.dataset.writeAction = 'true';
  submit.disabled = isBusy(); form.append(submit);
  const cancel = button('수정 취소', () => { editingId = null; form.reset(); formTitle.textContent = '과목 만들기';
    submit.textContent = '과목 생성'; cancel.hidden = true; }, 'small-button');
  cancel.hidden = true; form.append(cancel);
  const note = element('p', 'notice'); form.append(note);
  form.addEventListener('submit', (event) => { event.preventDefault(); void (async () => {
    if (isBusy()) { note.textContent = '배포가 끝난 뒤 생성할 수 있습니다.'; return; }
    submit.disabled = true;
    try { await api.write(editingId === null ? 'POST' : 'PUT', editingId === null ? '/admin/courses' : `/admin/courses/${editingId}`,
      { field: field.value, name: name.value, description: description.value, status: status.value }); await showRoute(); }
    catch (error) { note.textContent = errorMessage(error); submit.disabled = false; }
  })(); });
  panel.append(form); content.replaceChildren(panel);
}

async function showCategories(content: HTMLElement, ticket: number): Promise<void> {
  const categories = await api.get<Category[]>('/admin/categories');
  if (ticket !== routeTicket) return;
  const panel = element('section', 'panel'); panel.append(heading('분류'));
  const list = element('div', 'row-list');
  const draw = (nodes: Category[], depth: number): void => {
    for (const node of nodes) {
      const row = element('div', 'row category-row'); row.style.paddingLeft = `${16 + depth * 22}px`;
      row.append(element('span', '', `${node.name} · ${node.totalCount}`));
      const order = element('label', 'order-field'); order.append(element('span', '', '분류 순서'));
      const orderInput = element('input'); orderInput.type = 'number'; orderInput.step = '1';
      orderInput.min = String(-2147483648); orderInput.max = String(2147483647);
      orderInput.value = Number.isInteger(node.sortOrder) ? String(node.sortOrder) : '';
      orderInput.setAttribute('aria-label', `${node.path} 분류 순서`);
      orderInput.dataset.writeAction = 'true'; orderInput.disabled = isBusy(); order.append(orderInput);
      const actions = element('div', 'row-actions');
      actions.append(writeButton('순서 저장', () => { void (async () => {
        const value = Number(orderInput.value);
        if (!orderInput.value.trim() || !Number.isInteger(value) || value < -2147483648 || value > 2147483647) {
          window.alert('32비트 정수로 분류 순서를 입력해 주세요.'); return;
        }
        if (isBusy()) { window.alert('배포가 끝난 뒤 저장할 수 있습니다.'); return; }
        try { await api.write('PUT', `/admin/categories/${node.id}/order`, { order: value }); await showRoute(); }
        catch (error) { window.alert(errorMessage(error)); await pollDeployment(); }
      })(); }), writeButton('삭제', () => { void (async () => {
        if (!window.confirm(`“${node.path}” 분류를 삭제하시겠습니까? 글은 상위 분류로 이동합니다.`)) return;
        if (isBusy()) { window.alert('배포가 끝난 뒤 삭제할 수 있습니다.'); return; }
        try { await api.write('DELETE', `/admin/categories/${node.id}`); await showRoute(); }
        catch (error) { window.alert(errorMessage(error)); }
      })(); }, 'small-button danger'));
      row.append(order, actions);
      list.append(row); draw(node.children, depth + 1);
    }
  };
  draw(categories, 0); panel.append(list);
  const form = element('form', 'subform'); form.append(element('h2', '', '분류 만들기'));
  const path = inputField(form, '분류 경로'); path.placeholder = '상위/하위'; path.required = true;
  const submit = element('button', 'primary-button', '생성'); submit.type = 'submit'; submit.dataset.writeAction = 'true';
  submit.disabled = isBusy(); form.append(submit);
  const note = element('p', 'notice'); form.append(note);
  form.addEventListener('submit', (event) => { event.preventDefault(); void (async () => {
    if (isBusy()) { note.textContent = '배포가 끝난 뒤 생성할 수 있습니다.'; return; }
    submit.disabled = true;
    try { await api.write('POST', '/admin/categories', { path: path.value.trim() }); await showRoute(); }
    catch (error) { note.textContent = errorMessage(error); submit.disabled = false; }
  })(); });
  panel.append(form); content.replaceChildren(panel);
}

async function showProfile(content: HTMLElement, ticket: number): Promise<void> {
  const profile = await api.get<{ name: string; tagline: string; intro: string; github: string; email?: string; photoUrl: string | null }>('/profile');
  if (ticket !== routeTicket) return;
  const panel = element('section', 'panel'); panel.append(heading('홈 프로필'));
  const form = element('form', 'subform');
  const name = inputField(form, '이름'); name.value = profile.name; name.required = true;
  const tagline = inputField(form, '한 줄 소개'); tagline.value = profile.tagline;
  const intro = textareaField(form, '소개', 5); intro.value = profile.intro;
  const github = inputField(form, 'GitHub', 'url'); github.value = profile.github;
  const photo = inputField(form, '프로필 사진', 'file'); photo.accept = 'image/png,image/jpeg,image/webp';
  const remove = element('label', 'checkbox'); const removePhoto = element('input'); removePhoto.type = 'checkbox';
  remove.append(removePhoto, document.createTextNode('현재 사진 제거')); form.append(remove);
  const submit = element('button', 'primary-button', '프로필 저장'); submit.type = 'submit'; submit.dataset.writeAction = 'true';
  submit.disabled = isBusy(); form.append(submit);
  const note = element('p', 'notice'); form.append(note);
  form.addEventListener('submit', (event) => { event.preventDefault(); void (async () => {
    if (isBusy()) { note.textContent = '배포가 끝난 뒤 저장할 수 있습니다.'; return; }
    submit.disabled = true;
    const fields = new FormData();
    const values: Record<string, string> = { name: name.value, tagline: tagline.value, intro: intro.value, github: github.value };
    if (typeof profile.email === 'string') values.email = profile.email;
    fields.set('profile', new Blob([JSON.stringify(values)], { type: 'application/json' }));
    if (photo.files?.[0]) fields.set('file', photo.files[0]);
    fields.set('removePhoto', String(removePhoto.checked));
    try { await api.upload('/admin/profile/save', fields); note.textContent = '프로필을 저장했습니다.'; }
    catch (error) { note.textContent = errorMessage(error); }
    finally { submit.disabled = false; await pollDeployment(); }
  })(); });
  panel.append(form); content.replaceChildren(panel);
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
