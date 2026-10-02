import "../shared/theme.css";
import "../shared/stack-icons.css";
import "@fontsource-variable/noto-sans-kr/index.css";
import "@fontsource/ibm-plex-mono/400.css";
import "katex/dist/katex.min.css";
import "./style.css";
import "../shared/header.css";
import "../shared/category-tree.css";
import { connectHeader, updateHeaderSession } from "../shared/header";
import { request } from "../shared/admin-api";
import { enhanceMarkdown } from "../shared/enhance";
import { connectTableOfContents } from "./toc";
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
 */
function filterCards(): void {
  // 검색어·태그·분류 조건 정규화
  const term = (search?.value ?? "").trim().toLocaleLowerCase();
  const tag = new URLSearchParams(location.search).get("tag")?.toLocaleLowerCase();
  const category = new URLSearchParams(location.search).get("category")?.toLocaleLowerCase();
  let visible = 0;
  // 전체 조건에 맞는 카드만 표시, 분류 경로는 경계까지 비교
  for (const card of cards) {
    const path = (card.dataset.category ?? "").toLocaleLowerCase();
    const match = (!term || (card.dataset.searchText ?? "").toLocaleLowerCase().includes(term)) &&
      (!tag || (card.dataset.tags ?? "").toLocaleLowerCase().split("|").includes(tag)) &&
      (!category || (path === category || path.startsWith(category + "/")));
    card.hidden = !match; if (match) visible++;
  }
  // 검색 결과 건수와 빈 목록 안내 갱신
  const active = document.querySelector<HTMLElement>("#search-filter");
  if (active) active.innerHTML = term ? `<span class="search-filter"></span><span class="mono feed-total">${visible}편</span><a href="/ken-blog/posts/">필터 해제</a>` : "";
  if (active && term) active.querySelector<HTMLElement>(".search-filter")!.textContent = `검색: ${search?.value.trim() ?? ""}`;
  const empty = document.querySelector<HTMLElement>("#filter-empty");
  if (empty) empty.hidden = visible > 0 || cards.length === 0;
}
// 공통 헤더를 현재 화면의 검색·테마·로그아웃 동작에 연결
connectHeader({
  onSearch: filterCards,
  onThemeChange: theme => document.querySelectorAll<HTMLElement>('.markdown-body').forEach(root => { void enhanceMarkdown(root, { theme }); }),
  onLogout: () => document.querySelectorAll<HTMLDialogElement>('dialog.edit-dialog').forEach(dialog => dialog.close()),
  onError: error => window.alert(error.message),
});
filterCards();

// 세션 조회 결과로 관리자 전용 동작 표시 여부 결정
void request<{
/**
 * 계정 권한
 */
role: string
}>('/auth/me').then(user => updateHeaderSession(user.role === 'ADMIN')).catch(() => updateHeaderSession(false));

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
// 스크롤·레이아웃 변화에 맞춰 목차 활성 항목 갱신
connectTableOfContents();

// 작성 버튼이 있는 화면에서만 글 작성 모듈 로딩
if (document.querySelector('[data-post-create]')) {
  void import('./post-create').then(({ connectPostCreator }) => connectPostCreator());
}
