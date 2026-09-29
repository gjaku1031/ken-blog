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
const searchUnit = document.querySelector<HTMLElement>(".header-search-unit");
const searchToggle = document.querySelector<HTMLButtonElement>("#header-search-toggle");
const searchClose = document.querySelector<HTMLButtonElement>("#header-search-close");
const searchForm = document.querySelector<HTMLFormElement>(".header-search");
const search = document.querySelector<HTMLInputElement>("#site-search");
function openSearch(open: boolean): void {
  searchUnit?.classList.toggle("is-open", open);
  searchToggle?.setAttribute("aria-expanded", String(open));
  searchToggle?.setAttribute("aria-label", open ? "검색 닫기" : "검색 열기");
  searchForm?.setAttribute("aria-hidden", String(!open));
  if (searchForm) searchForm.inert = !open;
  if (open) search?.focus({ preventScroll: true });
}
searchToggle?.addEventListener("click", () => openSearch(!searchUnit?.classList.contains("is-open")));
searchClose?.addEventListener("click", () => { openSearch(false); searchToggle?.focus(); });
searchForm?.addEventListener("keydown", (event) => { if (event.key === "Escape") { event.preventDefault(); openSearch(false); searchToggle?.focus(); } });
searchForm?.addEventListener("submit", (event) => {
  if (!(search?.value.trim())) event.preventDefault();
});

/** 제목 링크를 유지하며 원본 Projects·Notes 카드의 빈 영역 클릭도 연다. */
document.addEventListener("click", (event) => {
  if (event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  if (!(event.target instanceof Element) || event.target.closest("a,button,input,textarea,select")) return;
  const card = event.target.closest<HTMLElement>(".project-card,.course-card");
  if (!card || !window.getSelection()?.isCollapsed) return;
  const link = card.querySelector<HTMLAnchorElement>("h2 a,h3 a");
  if (link) location.assign(link.href);
});

/** 기존 slug 쿼리 주소를 생성된 정적 경로로 옮긴다. */
const query = new URLSearchParams(location.search);
const route = document.body.dataset.route;
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
if (search && query.get("q")) search.value = query.get("q")!;
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
search?.addEventListener("input", filterCards);
filterCards();

for (const root of document.querySelectorAll<HTMLElement>(".markdown-body")) void enhanceMarkdown(root, { theme: document.documentElement.dataset.theme === "dark" ? "dark" : "light" });
