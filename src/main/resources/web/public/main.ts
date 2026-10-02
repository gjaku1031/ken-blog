import "@fontsource-variable/noto-sans-kr/index.css";
import "@fontsource/ibm-plex-mono/400.css";
import "katex/dist/katex.min.css";
import "./style.css";
import { enhanceMarkdown } from "../shared/enhance";

/**
 * 공개 HTML의 테마를 로컬 상태에 맞춰 적용함
 */
function setTheme(theme: "light" | "dark"): void {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem("ken-blog-theme", theme); } catch { /* 저장소가 막혀도 현재 화면의 테마는 유지함 */ }
  const toggle = document.querySelector<HTMLButtonElement>("#theme-toggle");
  if (toggle) { toggle.setAttribute("aria-checked", String(theme === "dark")); toggle.title = theme === "dark" ? "다크 모드 켜짐" : "다크 모드 꺼짐"; }
  document.querySelectorAll<HTMLElement>(".markdown-body").forEach((root) => { void enhanceMarkdown(root, { theme }); });
}

/**
 * 저장된 테마, 없으면 시스템 설정 사용
 */
let saved: string | null = null;
// 저장된 테마를 읽고 없으면 시스템 설정 사용
try { saved = localStorage.getItem("ken-blog-theme"); } catch { /* 저장소가 막힌 브라우저는 시스템 테마를 사용함 */ }
setTheme(saved === "dark" || (saved !== "light" && matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light");
// 사용자의 테마 전환 요청 반영
document.querySelector<HTMLButtonElement>("#theme-toggle")?.addEventListener("click", () => setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));

/**
 * 현재 URL의 조회 조건
 */
const query = new URLSearchParams(location.search);
/**
 * 현재 화면 경로 종류
 */
const route = document.body.dataset.route;
/**
 * 검색 페이지 경로
 */
const searchPath = "/ken-blog/search/";
/**
 * 홈 경로
 */
const homePath = "/ken-blog/";
/**
 * 검색 UI 영역
 */
const searchUnit = document.querySelector<HTMLElement>(".header-search-unit");
/**
 * 검색창 열기 버튼
 */
const searchToggle = document.querySelector<HTMLButtonElement>("#header-search-toggle");
/**
 * 검색창 닫기 버튼
 */
const searchClose = document.querySelector<HTMLButtonElement>("#header-search-close");
/**
 * 검색 폼
 */
const searchForm = document.querySelector<HTMLFormElement>(".header-search");
/**
 * 검색 입력창
 */
const search = document.querySelector<HTMLInputElement>("#site-search");
/**
 * 예약된 검색 이동 타이머
 */
let searchTimer: number | undefined;
/**
 * 한글 등 입력 조합 진행 여부
 */
let searchComposing = false;

/**
 * 검색 화면에서는 주소·카드를 갱신하고, 다른 화면에서는 검색 결과로 이동
 *
 * 1. 빈 검색어는 검색 화면에서 홈으로 이동
 * 2. 검색 화면의 명시 제출은 기록 추가, 자동 검색은 기록 교체
 * 3. 다른 화면에서는 검색 결과 페이지로 이동
 */
function navigateSearch(submitted: boolean): void {
  // 빈 검색어는 홈 이동 또는 현재 화면 유지
  const value = search?.value.trim() ?? "";
  if (!value) {
    if (route === "search") location.assign(homePath);
    return;
  }
  // 검색 화면은 기록·카드 갱신, 다른 화면은 URL 이동
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

/**
 * 입력이 잠시 멈추면 이동하되 한글 조합 중에는 대기함
 */
function scheduleSearch(): void {
  window.clearTimeout(searchTimer);
  if (!searchComposing) searchTimer = window.setTimeout(() => navigateSearch(false), 180);
}

/**
 * 검색창을 접을 때 예약된 이동을 취소하고 검색 결과에서는 홈으로 돌아감
 */
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
// 검색 열기·닫기 버튼 연결
searchToggle?.addEventListener("click", () => openSearch(!searchUnit?.classList.contains("is-open")));
searchClose?.addEventListener("click", () => { openSearch(false); searchToggle?.focus(); });
// Escape로 닫기, 입력 조합 중 Enter 제출 차단
searchForm?.addEventListener("keydown", (event) => {
  if (event.key === "Escape") { event.preventDefault(); openSearch(false); searchToggle?.focus(); }
  if (event.key === "Enter" && event.isComposing) event.preventDefault();
});
// 예약 검색을 취소하고 명시 제출 처리
searchForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  if (searchComposing) return;
  window.clearTimeout(searchTimer);
  navigateSearch(true);
});

// 제목 링크를 유지하며 프로젝트 카드의 빈 영역 클릭도 엶
document.addEventListener("click", (event) => {
  if (event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  if (!(event.target instanceof Element) || event.target.closest("a,button,input,textarea,select")) return;
  const card = event.target.closest<HTMLElement>(".project-card,.course-card");
  if (!card || !window.getSelection()?.isCollapsed) return;
  const link = card.querySelector<HTMLAnchorElement>("h2 a,h3 a");
  if (link) location.assign(link.href);
});

/**
 * 기존 slug 쿼리 주소를 생성된 정적 경로로 옮김
 */
const slug = query.get("slug");
/**
 * 공개 주소 식별자 형식 검사
 */
const validSlug = (value: string | null): value is string => !!value && value.length <= 160 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
// 이전 쿼리 주소를 검증된 정적 경로로 이동
if (validSlug(slug)) {
  let target = "";
  if (route === "post") target = `post/${slug}/`;
  if (route === "project") target = `project/${slug}/${validSlug(query.get("doc")) ? `docs/${query.get("doc")}/` : ""}`;
  if (route === "course") target = `course/${slug}/${validSlug(query.get("chapter")) ? `chapters/${query.get("chapter")}/` : ""}`;
  if (target) {
    // 배포된 경로 목록에 없는 slug로 이동해 사라진 문서를 추측하지 않음
    void fetch("/ken-blog/routes.json", { credentials: "omit" }).then(async (response) => {
      if (!response.ok) return;
      const routes: unknown = await response.json();
      if (Array.isArray(routes) && routes.includes(target)) location.replace(`/ken-blog/${target}`);
    }).catch(() => undefined);
  }
}

// 현재 목록의 카테고리·태그·검색 조건만 DOM에서 좁힘
if (search && route === "search") search.value = query.get("q") ?? "";
/**
 * 검색·분류·태그 필터 대상 카드
 */
const cards = Array.from(document.querySelectorAll<HTMLElement>("[data-search-card]"));
/**
 * 카테고리·태그·검색어에 맞는 카드와 결과 수 갱신
 *
 * 1. 검색어·태그·분류 필터 정규화
 * 2. 모든 필터가 맞는 카드만 표시
 * 3. 표시 건수·활성 검색어·빈 결과 갱신
 */
function filterCards(): void {
  // 검색어·태그·분류 필터 정규화
  const term = (search?.value ?? "").trim().toLocaleLowerCase();
  const tag = new URLSearchParams(location.search).get("tag")?.toLocaleLowerCase();
  const category = new URLSearchParams(location.search).get("category")?.toLocaleLowerCase();
  let visible = 0;
  // 모든 필터가 맞는 카드만 표시
  for (const card of cards) {
    const match = (!term || (card.dataset.searchText ?? "").toLocaleLowerCase().includes(term)) &&
      (!tag || (card.dataset.tags ?? "").toLocaleLowerCase().split("|").includes(tag)) &&
      (!category || (card.dataset.category ?? "").toLocaleLowerCase().startsWith(category));
    card.hidden = !match; if (match) visible++;
  }
  // 표시 건수·활성 검색어·빈 결과 갱신
  const count = document.querySelector<HTMLElement>("#filter-count");
  if (count) count.textContent = `${visible}편`;
  const active = document.querySelector<HTMLElement>("#search-filter");
  if (active) active.innerHTML = term ? `<span class="search-filter"></span><span class="mono feed-total">${visible}편</span><a href="/ken-blog/">필터 해제</a>` : "";
  if (active && term) active.querySelector<HTMLElement>(".search-filter")!.textContent = `검색: ${search?.value.trim() ?? ""}`;
  const empty = document.querySelector<HTMLElement>("#filter-empty");
  if (empty) empty.hidden = !term || visible > 0 || cards.length === 0;
}
// 입력 시 현재 카드 필터 갱신과 지연 검색 예약
search?.addEventListener("input", () => {
  if (route === "search") filterCards();
  scheduleSearch();
});
// 한글 조합 중 이동을 보류하고 조합 종료 후 재예약
search?.addEventListener("compositionstart", () => { searchComposing = true; window.clearTimeout(searchTimer); });
search?.addEventListener("compositionend", () => { searchComposing = false; scheduleSearch(); });
// 뒤로·앞으로 이동한 URL의 검색어로 카드 복원
window.addEventListener("popstate", () => {
  if (route !== "search" || !search) return;
  window.clearTimeout(searchTimer);
  search.value = new URLSearchParams(location.search).get("q") ?? "";
  filterCards();
});
// 초기 카드 필터 적용, 검색어 없으면 홈으로 이동
filterCards();
if (route === "search") {
  if (!search?.value.trim()) location.replace(homePath);
  else requestAnimationFrame(() => search.focus({ preventScroll: true }));
}

// 정적 본문에 이미지·주석·도식 상호작용 연결
for (const root of document.querySelectorAll<HTMLElement>(".markdown-body")) void enhanceMarkdown(root, { theme: document.documentElement.dataset.theme === "dark" ? "dark" : "light" });
