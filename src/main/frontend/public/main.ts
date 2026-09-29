import "@fontsource-variable/noto-sans-kr/index.css";
import "@fontsource/ibm-plex-mono/400.css";
import "katex/dist/katex.min.css";
import "./style.css";
import { enhanceMarkdown } from "../shared/enhance";

/** 공개 HTML의 테마를 로컬 상태에 맞춰 적용한다. */
function setTheme(theme: "light" | "dark"): void {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("ken-blog-theme", theme);
  document.querySelectorAll<HTMLElement>(".markdown-body").forEach((root) => { void enhanceMarkdown(root, { theme }); });
}

const saved = localStorage.getItem("ken-blog-theme");
setTheme(saved === "dark" || (saved !== "light" && matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light");
document.querySelector<HTMLButtonElement>("#theme-toggle")?.addEventListener("click", () => setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));

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
const search = document.querySelector<HTMLInputElement>("#site-search");
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
  if (count) count.textContent = `${visible}개`;
}
search?.addEventListener("input", filterCards);
filterCards();

for (const root of document.querySelectorAll<HTMLElement>(".markdown-body")) void enhanceMarkdown(root, { theme: document.documentElement.dataset.theme === "dark" ? "dark" : "light" });
