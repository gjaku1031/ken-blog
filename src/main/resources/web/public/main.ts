import "../shared/theme.css";
import "../shared/stack-icons.css";
import "@fontsource-variable/noto-sans-kr/index.css";
import "@fontsource/ibm-plex-mono/400.css";
import "./style.css";
import "../shared/header.css";
import "../shared/category-tree.css";
import { connectHeader, updateHeaderSession } from "../shared/header";
import { connectSearch } from "./search";
import { request } from "../shared/admin-api";
import { connectImageZoom } from "../shared/image-zoom";

/**
 * 현재 URL의 조회 조건
 */
const query = new URLSearchParams(location.search);

/**
 * 현재 화면 경로 종류
 */
const route = document.body.dataset.route;

/**
 * 검색 입력창
 */
const search = document.querySelector<HTMLInputElement>("#site-search");
// 프로필 이미지를 공통 확대 창에 연결
for (const avatar of document.querySelectorAll<HTMLButtonElement>("button.about-avatar")) {
  const image = avatar.querySelector("img");
  if (image) connectImageZoom(image, { trigger: avatar });
}

// 제목 링크를 유지하며 프로젝트 카드의 빈 영역 클릭도 엶
document.addEventListener("click", (event) => {
  if (event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  if (!(event.target instanceof Element) || event.target.closest("a,button,input,textarea,select")) return;
  const card = event.target.closest<HTMLElement>(".project-card");
  if (!card || !window.getSelection()?.isCollapsed) return;
  const link = card.querySelector<HTMLAnchorElement>("h2 a,h3 a");
  if (link) location.assign(link.href);
});

// 현재 목록의 카테고리·태그·검색 조건만 DOM에서 좁힘
if (search && route === "search") search.value = query.get("q") ?? "";

/**
 * 검색·분류·태그 필터 대상 카드
 */
const cards = Array.from(document.querySelectorAll<HTMLElement>("[data-search-card]")).map(element => ({
  element, text: (element.dataset.searchText ?? '').toLocaleLowerCase('und'),
  category: (element.dataset.category ?? '').toLocaleLowerCase('und'),
  tags: new Set((JSON.parse(element.dataset.tags ?? '[]') as string[]).map(tag => tag.toLocaleLowerCase('und'))),
}));

/**
 * 검색 화면의 색인 조회·필터 갱신
 */
const searchResults = route === 'search' && search ? connectSearch(search) : null;

/**
 * 일반 글 목록의 추가 표시 한도
 */
let cardLimit = 20;

// 긴 공개 목록을 단계적으로 표시, 정적 HTML에는 전체 글 링크 유지
const more = document.querySelector<HTMLButtonElement>('#filter-more');
if (!searchResults) more?.addEventListener('click', () => { cardLimit += 20; filterCards(); });

/**
 * 카테고리·태그·검색어에 맞는 카드와 결과 수 갱신
 */
function filterCards(): void {
  if (searchResults) { void searchResults(); return; }
  // 검색어·태그·분류 조건 정규화
  const term = (search?.value ?? "").trim().toLocaleLowerCase();
  const tag = new URLSearchParams(location.search).get("tag")?.toLocaleLowerCase();
  const category = new URLSearchParams(location.search).get("category")?.toLocaleLowerCase();
  let visible = 0;
  // 전체 조건에 맞는 카드만 표시, 분류 경로는 경계까지 비교
  for (const card of cards) {
    const path = card.category;
    const match = (!term || card.text.includes(term)) &&
      (!tag || card.tags.has(tag)) &&
      (!category || (path === category || path.startsWith(category + "/")));
    if (match) visible++;
    const hidden = !match || visible > cardLimit;
    if (card.element.hidden !== hidden) card.element.hidden = hidden;
  }
  // 검색 결과 건수와 빈 목록 안내 갱신
  if (more) more.hidden = visible <= cardLimit;
  const active = document.querySelector<HTMLElement>("#search-filter");
  if (active) active.innerHTML = term ? `<span class="search-filter"></span><span class="mono feed-total">${visible}편</span><a href="/ken-blog/posts/">필터 해제</a>` : "";
  if (active && term) active.querySelector<HTMLElement>(".search-filter")!.textContent = `검색: ${search?.value.trim() ?? ""}`;
  const empty = document.querySelector<HTMLElement>("#filter-empty");
  if (empty) empty.hidden = visible > 0 || cards.length === 0;
}
// 공통 헤더를 현재 화면의 검색·테마·로그아웃 동작에 연결
connectHeader({
  onSearch: filterCards,
  onThemeChange: () => document.dispatchEvent(new Event('site-theme')),
  onLogout: () => { isAdmin = false; document.querySelectorAll<HTMLDialogElement>('dialog.edit-dialog').forEach(dialog => dialog.close()); },
  onError: error => window.alert(error.message),
});
filterCards();

// 세션 조회 결과로 관리자 전용 동작 표시 여부 결정
void request<{
/**
 * 계정 권한
 */
role: string
}>('/auth/me').then(user => { isAdmin = user.role === 'ADMIN'; updateHeaderSession(isAdmin); }).catch(() => updateHeaderSession(false));

// 분류 트리의 접힘 상태와 접근성 속성을 함께 갱신
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-category-toggle]')) {
  button.addEventListener('click', () => {
    const children = document.getElementById(button.getAttribute('aria-controls') ?? '');
    if (!children) return;
    children.hidden = !children.hidden;
    button.setAttribute('aria-expanded', String(!children.hidden));
  });
}

/**
 * 현재 URL의 분류 필터
 */
const category = query.get('category');
// 현재 분류 필터를 탐색 링크에 표시
for (const link of document.querySelectorAll<HTMLAnchorElement>('[data-category-link]')) {
  if (link.dataset.categoryLink === category) link.setAttribute('aria-current', 'page');
}
/**
 * 현재 화면에서 확인한 관리자 권한
 */
let isAdmin = false;

/**
 * 첫 작성 요청이 공유하는 코드·스타일 로딩 작업
 */
let creator: Promise<ReturnType<typeof import('./post-create').connectPostCreator>> | undefined;

// 권한 확인 후 실제 클릭 시에만 폼 코드와 스타일 로딩
document.addEventListener('click', async event => {
  const trigger = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-post-create]') : null;
  if (!trigger || !isAdmin || event.button || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  try {
    creator ??= Promise.all([import('./post-create'), new Promise<void>((resolve, reject) => {
      const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = document.body.dataset.formsCss!;
      link.onload = () => resolve(); link.onerror = () => { link.remove(); reject(new Error('글쓰기 화면을 불러오지 못했습니다.')); };
      document.head.append(link);
    })]).then(([module]) => module.connectPostCreator()).catch(error => { creator = undefined; throw error; });
    const open = await creator;
    if (isAdmin) await open(trigger);
  } catch (error) { window.alert(error instanceof Error ? error.message : '글쓰기 화면을 불러오지 못했습니다.'); }
});
