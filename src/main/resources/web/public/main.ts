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

const query = new URLSearchParams(location.search);
const route = document.body.dataset.route;
const search = document.querySelector<HTMLInputElement>("#site-search");

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
    const path = (card.dataset.category ?? "").toLocaleLowerCase();
    const match = (!term || (card.dataset.searchText ?? "").toLocaleLowerCase().includes(term)) &&
      (!tag || (card.dataset.tags ?? "").toLocaleLowerCase().split("|").includes(tag)) &&
      (!category || (path === category || path.startsWith(category + "/")));
    card.hidden = !match; if (match) visible++;
  }
  const active = document.querySelector<HTMLElement>("#search-filter");
  if (active) active.innerHTML = term ? `<span class="search-filter"></span><span class="mono feed-total">${visible}편</span><a href="/ken-blog/posts/">필터 해제</a>` : "";
  if (active && term) active.querySelector<HTMLElement>(".search-filter")!.textContent = `검색: ${search?.value.trim() ?? ""}`;
  const empty = document.querySelector<HTMLElement>("#filter-empty");
  if (empty) empty.hidden = visible > 0 || cards.length === 0;
}
connectHeader({
  onSearch: filterCards,
  onThemeChange: theme => document.querySelectorAll<HTMLElement>('.markdown-body').forEach(root => { void enhanceMarkdown(root, { theme }); }),
  onLogout: () => document.querySelectorAll<HTMLDialogElement>('dialog.edit-dialog').forEach(dialog => dialog.close()),
  onError: error => window.alert(error.message),
});
filterCards();

void request<{ role: string }>('/auth/me').then(user => updateHeaderSession(user.role === 'ADMIN')).catch(() => updateHeaderSession(false));

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-category-toggle]')) {
  button.addEventListener('click', () => {
    const children = document.getElementById(button.getAttribute('aria-controls') ?? '');
    if (!children) return;
    children.hidden = !children.hidden;
    button.setAttribute('aria-expanded', String(!children.hidden));
  });
}
const category = query.get('category');
for (const link of document.querySelectorAll<HTMLAnchorElement>('[data-category-link]')) {
  if (link.dataset.categoryLink === category) link.setAttribute('aria-current', 'page');
}
connectTableOfContents();

if (document.querySelector('[data-post-create]')) {
  void import('./post-create').then(({ connectPostCreator }) => connectPostCreator());
}
