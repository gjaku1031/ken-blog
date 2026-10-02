import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import nunjucks from "nunjucks";

interface Navigation { id: number; slug: string; title: string; order: number }
interface SeriesRef { id: number; slug: string; name: string; kind: "TECH" | "PROJECT" }
interface Post {
  id: number; slug: string; title: string; summary: string; section: "TECH" | "PROJECT";
  publishedAt: string; publishedDate: string; tags: string[]; legacyPath: string | null;
  category: { path: string } | null;
  series: (SeriesRef & { items: Navigation[]; position: number }) | null;
  relatedSeries: SeriesRef | null;
  rendered: { html: string; headings: { id: string; label: string; depth: number }[]; wikiTargets: string[] };
  searchBody?: string;
}
interface Series extends SeriesRef {
  sortOrder: number; cover: Navigation; description: string; postCount: number;
  projectStatus: string | null; startPeriod: string | null; endPeriod: string | null;
  stackBadges: { id: number; name: string; imageUrl: string }[];
}
interface Input {
  snapshot: { version: number; posts: Post[]; series: Series[] };
  assets: { css: string; js: string }; adminHref: string;
  admin: { apiBase: string; css: string; js: string };
}
const BASE = "/ken-blog/";
const ORIGIN = "https://gjaku1031.github.io";
const route = (path = "") => BASE + path;
function slug(value: string): string {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) throw new Error("공개 slug 형식 오류");
  return value;
}
const postPath = (post: { slug: string }) => route(`post/${slug(post.slug)}/`);
const date = (value: string) => value.slice(0, 10).replaceAll("-", ".");
const label = (section: string) => section === "PROJECT" ? "Projects" : "Posts";
const unique = (values: string[]) => [...new Set(values.filter(Boolean))].sort();
const chronological = (a: Post, b: Post) => a.publishedAt.localeCompare(b.publishedAt) || a.id - b.id;
const wikiKey = (title: string) => title.toLocaleLowerCase("und");

function searchText(html: string): string {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return html.replace(/<[^>]*>/g, " ").replace(/&(#(?:x[0-9a-f]+|[0-9]+)|[a-z]+);/gi, (entity, code: string) => {
    code = code.toLowerCase();
    if (!code.startsWith("#")) return named[code] ?? entity;
    const number = code.startsWith("#x") ? Number.parseInt(code.slice(2), 16) : Number.parseInt(code.slice(1), 10);
    return number >= 32 && number <= 0x10ffff && !(number >= 0xd800 && number <= 0xdfff) ? String.fromCodePoint(number) : " ";
  }).replace(/\s+/g, " ").trim();
}
function period(project: Series): string {
  const start = project.startPeriod ?? "", end = project.endPeriod ?? "";
  if (!start) return end;
  if (!end) return project.projectStatus === "DONE" ? start : `${start} – 현재`;
  return start === end ? start : `${start} – ${end}`;
}
function card(post: Post) {
  const categoryPath = post.category?.path ?? "", context = post.series?.name ?? "";
  return { ...post, href: postPath(post), categoryPath, context, tagText: post.tags.join("|"), label: label(post.section),
    searchText: `${post.title} ${post.summary} ${categoryPath} ${post.tags.join(" ")} ${context} ${post.searchBody ?? ""}`,
    displayDate: date(post.publishedDate) };
}

/** 검증·렌더링된 공개 데이터만 받아 완성 문서를 생성. DB·Spring 실행 의존성 없음. */
export async function generateSite(payload: Input, output: string) {
  const { snapshot, assets, admin } = payload;
  if (snapshot.version !== 2) throw new Error("공개 스냅샷 버전 오류");
  const engine = new nunjucks.Environment(new nunjucks.FileSystemLoader(join(import.meta.dirname, "templates")), {
    autoescape: true, throwOnUndefined: true,
  });
  engine.addFilter("query", (value: string) => encodeURIComponent(value));
  const pages: string[] = [];
  const write = async (path: string, content: string) => {
    const file = join(output, path);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, content, "utf8");
  };
  // 관리자 데이터는 포함하지 않고 로그인 화면과 API·자산 주소만 전달.
  await write("manage/index.html", engine.render("manage.njk", { apiBase: admin.apiBase, adminCss: admin.css, adminJs: admin.js }));
  async function page(path: string, view: string, section: string, title: string, description: string,
    data: Record<string, unknown> = {}, sitemap = true) {
    const canonical = ORIGIN + route(path === "404.html" ? path : path ? `${path}/` : "");
    const documentTitle = section === "Home" ? "ken.blog | Posts·Projects" : section === "Search" ? "ken.blog" : `${title} | ken.blog`;
    const summary = section === "Home" ? "기술 글과 프로젝트, 학습 기록을 모아 둔 ken.blog" :
      section === "Search" ? "일반 글과 프로젝트 기록을 읽는 ken.blog" : description;
    const article = ["Post", "Project"].includes(section) && !!path;
    const active = ({ Post: "Posts", Project: "Projects", Search: "Home" } as Record<string, string>)[section] ?? section;
    const nav = [["", "Home"], ["posts/", "Posts"], ["projects/", "Projects"]].map(([href, label]) =>
      ({ href: route(href), label, active: label === active }));
    await write(path === "404.html" ? path : join(path, "index.html"), engine.render("page.njk", {
      view, section, documentTitle, socialTitle: article ? title : documentTitle, summary, canonical,
      ogType: article ? "article" : "website", base: BASE, assetsCss: route(`assets/${assets.css}`), assetsJs: route(`assets/${assets.js}`),
      adminHref: payload.adminHref, nav, year: new Date().getUTCFullYear(), github: "https://github.com/gjaku1031/ken-blog", ...data,
    }));
    if (sitemap) pages.push(path);
  }
  async function listing(path: string, section: string, title: string, rows: Post[]) {
    const cards = rows.map(card);
    const groups = new Map<string, { name: string; href: string }>();
    if (section === "Posts") for (const post of rows) if (post.series)
      groups.set(post.series.slug, { name: post.series.name, href: postPath(post.series.items[0]) });
    await page(path, "listing", section, title, `${title} 공개 글 목록`, {
      heading: section === "Search" ? "최근 글" : title, cards,
      categories: unique(cards.map(c => c.categoryPath)), tags: unique(cards.flatMap(c => c.tags)),
      searching: section === "Search", groups: [...groups.values()],
    });
  }
  const allPosts = snapshot.posts;
  const targets = new Map<string, Post>();
  for (const post of [...allPosts].sort(chronological)) if (!targets.has(wikiKey(post.title))) targets.set(wikiKey(post.title), post);
  const backlinks = new Map<string, { href: string; title: string; section: string }[]>();
  for (const source of allPosts) for (const title of source.rendered.wikiTargets) {
    const target = targets.get(wikiKey(title));
    if (!target || target.id === source.id) continue;
    const refs = backlinks.get(postPath(target)) ?? [];
    refs.push({ href: postPath(source), title: source.title, section: label(source.section) });
    backlinks.set(postPath(target), refs);
  }
  const feed = [...allPosts].sort((a, b) => chronological(b, a)), home = feed.slice(0, 12);
  await page("", "home", "Home", "Home", "Ken Blog", {
    cards: home.map(card),
    categories: unique(home.map(p => p.category?.path ?? "")), tags: unique(home.flatMap(p => p.tags)),
  });
  await listing("posts", "Posts", "Posts", feed.filter(p => p.section === "TECH"));
  const status: Record<string, string> = { PLAN: "기획 중", DEV: "개발 중", MAINT: "유지보수 중", DONE: "완료" };
  const projects = snapshot.series.filter(s => s.kind === "PROJECT").sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)
    .map(p => ({ ...p, href: postPath(p.cover), statusLabel: status[p.projectStatus ?? ""] ?? p.projectStatus ?? "",
      statusClass: (p.projectStatus ?? "").toLowerCase(), period: period(p) }));
  await page("projects", "projects", "Projects", "Projects", "공개 프로젝트 목록", { projects });
  await listing("search", "Search", "Search", feed.map(p => ({ ...p, searchBody: searchText(p.rendered.html) })));
  for (const post of allPosts) {
    const navigation = post.series;
    const series = (navigation?.items ?? []).map(item => ({ ...item, href: postPath(item), current: item.id === post.id }));
    const project = projects.find(p => p.id === navigation?.id && p.slug === navigation?.slug) ?? null;
    const relatedProject = projects.find(p => p.id === post.relatedSeries?.id) ?? null;
    await page(`post/${slug(post.slug)}`, "post", post.section === "PROJECT" ? "Project" : "Post", post.title, post.summary, {
      post: { ...post, displayDate: date(post.publishedDate), relatedProject }, project, html: post.rendered.html,
      toc: post.rendered.headings.filter(h => h.depth === 2 || h.depth === 3), backlinks: backlinks.get(postPath(post)) ?? [],
      series, seriesName: navigation?.name ?? "", seriesPosition: navigation?.position ?? 0,
    });
  }
  // 공개 대상에 한해 옛 주소를 생성하고 프로젝트 루트는 현재 첫 글로 연결.
  const aliases = new Map([["tech", route("posts/")], ["post", route("posts/")], ["project", route("projects/")],
    ["notes", route("posts/")], ["course", route("posts/")]]);
  for (const group of snapshot.series) {
    const target = postPath(group.cover);
    aliases.set(`series/${slug(group.slug)}`, target);
    aliases.set(`${group.kind === "PROJECT" ? "project" : "course"}/${slug(group.slug)}`, target);
  }
  for (const post of allPosts) {
    const old = post.legacyPath?.replace(/^\/+|\/+$/g, "");
    if (!old) continue;
    if (!/^(?:project\/[a-z0-9-]+(?:\/docs\/[a-z0-9-]+)?|course\/[a-z0-9-]+\/chapters\/[a-z0-9-]+)$/.test(old))
      throw new Error("이전 공개 경로 형식 오류");
    if (!aliases.has(old)) aliases.set(old, postPath(post));
  }
  for (const [path, target] of aliases) {
    if (!/^\/ken-blog\/(?:posts|projects|post\/[a-z0-9-]+)\/$/.test(target)) throw new Error("이동 대상 경로 오류");
    await write(`${path}/index.html`, engine.render("redirect.njk", { target, canonical: ORIGIN + target }));
  }
  await page("404.html", "missing", "", "페이지 없음", "페이지를 찾을 수 없습니다.", {}, false);
  await write("robots.txt", `User-agent: *\nAllow: /ken-blog/\nSitemap: ${ORIGIN}${route("sitemap.xml")}\n`);
  await write("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${
    pages.map(path => `<url><loc>${ORIGIN}${route(path ? `${path}/` : "")}</loc></url>`).join("")}</urlset>`);
  await write("routes.json", JSON.stringify(pages.map(path => path ? `${path}/` : "")));
}
