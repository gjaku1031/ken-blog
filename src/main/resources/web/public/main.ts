import "@fontsource-variable/noto-sans-kr/index.css";
import "@fontsource/ibm-plex-mono/400.css";
import "katex/dist/katex.min.css";
import "./style.css";
import { enhanceMarkdown } from "../shared/enhance";

/** 공개 HTML의 테마를 로컬 상태에 맞춰 적용한다. */
function setTheme(theme: "light" | "dark"): void {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem("ken-blog-theme", theme); } catch { /* 저장소가 막혀도 현재 화면의 테마는 유지한다. */ }
  const toggle = document.querySelector<HTMLButtonElement>("#theme-toggle");
  if (toggle) { toggle.setAttribute("aria-checked", String(theme === "dark")); toggle.title = theme === "dark" ? "다크 모드 켜짐" : "다크 모드 꺼짐"; }
  document.querySelectorAll<HTMLElement>(".markdown-body").forEach((root) => { void enhanceMarkdown(root, { theme }); });
}

let saved: string | null = null;
try { saved = localStorage.getItem("ken-blog-theme"); } catch { /* 저장소가 막힌 브라우저는 시스템 테마를 사용한다. */ }
setTheme(saved === "dark" || (saved !== "light" && matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light");
document.querySelector<HTMLButtonElement>("#theme-toggle")?.addEventListener("click", () => setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));

/** 원본 헤더 검색 UI를 정적 결과 주소와 연결한다. */
const query = new URLSearchParams(location.search);
const route = document.body.dataset.route;
const searchPath = "/ken-blog/search/";
const homePath = "/ken-blog/";
const searchUnit = document.querySelector<HTMLElement>(".header-search-unit");
const searchToggle = document.querySelector<HTMLButtonElement>("#header-search-toggle");
const searchClose = document.querySelector<HTMLButtonElement>("#header-search-close");
const searchForm = document.querySelector<HTMLFormElement>(".header-search");
const search = document.querySelector<HTMLInputElement>("#site-search");
let searchTimer: number | undefined;
let searchComposing = false;

/** 검색 화면에서는 주소만 바꾸고, 다른 화면에서는 전체 검색 결과로 이동한다. */
function navigateSearch(submitted: boolean): void {
  const value = search?.value.trim() ?? "";
  if (!value) {
    if (route === "search") location.assign(homePath);
    return;
  }
  const target = `${searchPath}?q=${encodeURIComponent(value)}`;
  if (route === "search") {
    if (location.pathname + location.search !== target) {
      if (submitted) history.pushState(history.state, "", target);
      else history.replaceState(history.state, "", target);
    }
    filterCards();
  } else if (submitted) location.assign(target);
  else location.replace(target);
}

/** 원본 검색창처럼 입력이 잠시 멈추면 이동하되 한글 조합 중에는 기다린다. */
function scheduleSearch(): void {
  window.clearTimeout(searchTimer);
  if (!searchComposing) searchTimer = window.setTimeout(() => navigateSearch(false), 180);
}

/** 검색창을 접을 때 예약된 이동을 취소하고 검색 결과에서는 홈으로 돌아간다. */
function openSearch(open: boolean): void {
  if (!open) {
    window.clearTimeout(searchTimer);
    if (route === "search") location.assign(homePath);
  }
  searchUnit?.classList.toggle("is-open", open);
  searchToggle?.setAttribute("aria-expanded", String(open));
  searchToggle?.setAttribute("aria-label", open ? "검색 닫기" : "검색 열기");
  searchForm?.setAttribute("aria-hidden", String(!open));
  if (searchForm) searchForm.inert = !open;
  if (open) search?.focus({ preventScroll: true });
}
searchToggle?.addEventListener("click", () => openSearch(!searchUnit?.classList.contains("is-open")));
searchClose?.addEventListener("click", () => { openSearch(false); searchToggle?.focus(); });
searchForm?.addEventListener("keydown", (event) => {
  if (event.key === "Escape") { event.preventDefault(); openSearch(false); searchToggle?.focus(); }
  if (event.key === "Enter" && event.isComposing) event.preventDefault();
});
searchForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  if (searchComposing) return;
  window.clearTimeout(searchTimer);
  navigateSearch(true);
});

/** 제목 링크를 유지하며 원본 Projects 카드의 빈 영역 클릭도 연다. */
document.addEventListener("click", (event) => {
  if (event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  if (!(event.target instanceof Element) || event.target.closest("a,button,input,textarea,select")) return;
  const card = event.target.closest<HTMLElement>(".project-card,.course-card");
  if (!card || !window.getSelection()?.isCollapsed) return;
  const link = card.querySelector<HTMLAnchorElement>("h2 a,h3 a");
  if (link) location.assign(link.href);
});

/** 기존 slug 쿼리 주소를 생성된 정적 경로로 옮긴다. */
const slug = query.get("slug");
const validSlug = (value: string | null): value is string => !!value && value.length <= 160 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
if (validSlug(slug)) {
  let target = "";
  if (route === "post") target = `post/${slug}/`;
  if (route === "project") target = `project/${slug}/${validSlug(query.get("doc")) ? `docs/${query.get("doc")}/` : ""}`;
  if (route === "course") target = `course/${slug}/${validSlug(query.get("chapter")) ? `chapters/${query.get("chapter")}/` : ""}`;
  if (target) {
    // 배포된 경로 목록에 없는 slug로 이동해 사라진 문서를 추측하지 않는다.
    void fetch("/ken-blog/routes.json", { credentials: "omit" }).then(async (response) => {
      if (!response.ok) return;
      const routes: unknown = await response.json();
      if (Array.isArray(routes) && routes.includes(target)) location.replace(`/ken-blog/${target}`);
    }).catch(() => undefined);
  }
}

/** 현재 목록의 카테고리·태그·검색 조건만 DOM에서 좁힌다. */
if (search && route === "search") search.value = query.get("q") ?? "";
const cards = Array.from(document.querySelectorAll<HTMLElement>("[data-search-card]"));
function filterCards(): void {
  const term = (search?.value ?? "").trim().toLocaleLowerCase();
  const tag = new URLSearchParams(location.search).get("tag")?.toLocaleLowerCase();
  const category = new URLSearchParams(location.search).get("category")?.toLocaleLowerCase();
  let visible = 0;
  for (const card of cards) {
    const match = (!term || (card.dataset.searchText ?? "").toLocaleLowerCase().includes(term)) &&
      (!tag || (card.dataset.tags ?? "").toLocaleLowerCase().split("|").includes(tag)) &&
      (!category || (card.dataset.category ?? "").toLocaleLowerCase().startsWith(category));
    card.hidden = !match; if (match) visible++;
  }
  const count = document.querySelector<HTMLElement>("#filter-count");
  if (count) count.textContent = `${visible}편`;
  const active = document.querySelector<HTMLElement>("#search-filter");
  if (active) active.innerHTML = term ? `<span class="search-filter"></span><span class="mono feed-total">${visible}편</span><a href="/ken-blog/">필터 해제</a>` : "";
  if (active && term) active.querySelector<HTMLElement>(".search-filter")!.textContent = `검색: ${search?.value.trim() ?? ""}`;
  const empty = document.querySelector<HTMLElement>("#filter-empty");
  if (empty) empty.hidden = !term || visible > 0 || cards.length === 0;
}
search?.addEventListener("input", () => {
  if (route === "search") filterCards();
  scheduleSearch();
});
search?.addEventListener("compositionstart", () => { searchComposing = true; window.clearTimeout(searchTimer); });
search?.addEventListener("compositionend", () => { searchComposing = false; scheduleSearch(); });
window.addEventListener("popstate", () => {
  if (route !== "search" || !search) return;
  window.clearTimeout(searchTimer);
  search.value = new URLSearchParams(location.search).get("q") ?? "";
  filterCards();
});
filterCards();
if (route === "search") {
  if (!search?.value.trim()) location.replace(homePath);
  else requestAnimationFrame(() => search.focus({ preventScroll: true }));
}

for (const root of document.querySelectorAll<HTMLElement>(".markdown-body")) void enhanceMarkdown(root, { theme: document.documentElement.dataset.theme === "dark" ? "dark" : "light" });

/** 글쓰기 진입은 실제 관리자 세션을 확인한 뒤에만 표시한다. */
const writeButtons = document.querySelectorAll<HTMLElement>('[data-admin-write]');
const adminApiBase = document.body.dataset.apiBase;
if (writeButtons.length && adminApiBase) {
  void fetch(new URL('/api/v1/auth/me', adminApiBase), {
    credentials: 'include', cache: 'no-store', redirect: 'error', headers: { Accept: 'application/json' },
  }).then(async response => {
    if (response.ok && (await response.json()).role === 'ADMIN') writeButtons.forEach(button => { button.hidden = false; });
  }).catch(() => undefined);
}
