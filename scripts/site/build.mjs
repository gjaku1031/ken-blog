import { build as bundle } from "esbuild";
import { capture, assertCaptureOwner } from "./capture.mjs";
import { buildFrontend } from "../build-frontend.mjs";
import { readFile, writeFile, mkdir, rm, cp, readdir, stat, rename } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "../..");
const out = join(root, "target/site-staging");
const publishedOut = join(root, "target/site");
const basePath = "/ken-blog/";
let footerGithub = "";
let adminHref = "";
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const route = (path = "") => `${basePath}${path}`;
const checkedSlug = (value) => { if (!slugPattern.test(value ?? "")) throw new Error("공개 slug 형식 오류"); return value; };
const postPath = (post) => post.section === "PROJECT_HOME" ? route(`project/${checkedSlug(post.projectSlug)}/`) :
  post.section === "PROJECT_DOC" ? route(`project/${checkedSlug(post.projectSlug)}/docs/${checkedSlug(post.slug)}/`) :
  post.section === "NOTE_CHAPTER" ? route(`course/${checkedSlug(post.courseSlug)}/chapters/${checkedSlug(post.slug)}/`) : route(`post/${checkedSlug(post.slug)}/`);
const date = (value) => value ? `<time>${esc(value)}</time>` : "";
const unique = (items) => [...new Set(items)];
const wikiKey = (title) => title.toLocaleLowerCase("und");
const statusLabels = { PLAN: "기획", DEV: "개발", MAINT: "유지보수", DONE: "완료" };
const safeEmail = (value) => typeof value === "string" && /^[^\s@<>"'/?#]+@[^\s@<>"'/?#]+\.[A-Za-z]{2,}$/.test(value);
const projectPeriod = (project) => project.startPeriod ? `${project.startPeriod}${project.endPeriod ? ` – ${project.endPeriod}` : ""}` : "";
const badgeList = (badges) => badges?.length ? `<div class="static-project-badges" aria-label="기술 배지">${badges.map((badge) => `<span class="stack-badge"><img src="${esc(badge.imageUrl)}" alt="" width="24" height="24">${esc(badge.name)}</span>`).join("")}</div>` : "";

/** 공개 API 루트만 받아 상대 경로를 같은 호스트로 묶는다. */
function apiBase() {
  const raw = process.env.PUBLIC_API_BASE_URL?.trim();
  if (!raw) return null;
  const base = new URL(raw);
  if (!["http:", "https:"].includes(base.protocol) || base.username || base.password || base.pathname !== "/" || base.search || base.hash)
    throw new Error("PUBLIC_API_BASE_URL 형식 오류");
  if (base.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(base.hostname))
    throw new Error("운영 공개 API는 HTTPS가 필요합니다.");
  return base;
}

/** API와 같은 출처의 명시된 공개 이미지 경로만 허용한다. */
function imagePath(value, base, expected) {
  if (!base) throw new Error("공개 이미지를 받으려면 PUBLIC_API_BASE_URL이 필요합니다.");
  const url = new URL(value, base);
  const version = url.search ? /^\?v=[0-9TZ:.-]+$/.test(url.search) : true;
  if (url.origin !== base.origin || url.pathname !== expected || !version || url.hash || value.includes("%") || value.includes("..") || value.includes("\\"))
    throw new Error(`공개 이미지 주소 오류: ${expected}`);
  return url;
}

/** 압축되지 않은 이미지 본문의 크기·MIME·매직 바이트를 확인한다. */
async function download(url, name, verifyOwner) {
  if (verifyOwner) await assertCaptureOwner(url.origin);
  const response = await fetch(url, { headers: { Accept: "image/png,image/jpeg" }, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(25_000) });
  if (!response.ok) throw new Error(`공개 이미지 HTTP ${response.status}: ${url.pathname}`);
  const type = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  const limit = 10 * 1024 * 1024;
  if (Number(response.headers.get("content-length")) > limit || !response.body) throw new Error("공개 이미지 크기 오류");
  const chunks = [];
  let length = 0;
  for await (const chunk of response.body) {
    length += chunk.byteLength;
    if (length > limit) { await response.body.cancel().catch(() => undefined); throw new Error("공개 이미지 크기 오류"); }
    chunks.push(chunk);
  }
  const bytes = new Uint8Array(Buffer.concat(chunks, length));
  if (bytes.length < 8 || bytes.length > 10 * 1024 * 1024) throw new Error("공개 이미지 크기 오류");
  const png = type === "image/png" && [137, 80, 78, 71, 13, 10, 26, 10].every((part, index) => bytes[index] === part);
  const jpg = type === "image/jpeg" && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (!png && !jpg) throw new Error("공개 이미지 형식 오류");
  const filename = `${name}.${png ? "png" : "jpg"}`;
  await writeFile(join(out, "assets", filename), bytes);
  if (verifyOwner) await assertCaptureOwner(url.origin);
  return route(`assets/${filename}`);
}

/** 옛 공개 스냅샷 구조를 확인하고 출간된 상세만 라우트에 반영한다. */
function validate(snapshot, fixture, capturedUnderGate) {
  if (!snapshot || snapshot.version !== 1 || !Array.isArray(snapshot.posts) || !Array.isArray(snapshot.projects) || !Array.isArray(snapshot.notes) ||
    !Array.isArray(snapshot.feed) || !snapshot.projectDetails || !snapshot.projectDocuments || !snapshot.courseDetails || !snapshot.chapters)
    throw new Error("SITE_INPUT 공개 스냅샷 형식 오류");
  if (!fixture && !capturedUnderGate && !snapshot.feed.length && !snapshot.posts.length && !snapshot.projects.length && !snapshot.notes.length)
    throw new Error("빈 공개 스냅샷은 배포 잠금 아래의 API 캡처에서만 허용됩니다.");
  const postIds = new Set();
  const routeToId = new Map();
  const assertPost = (post, section) => {
    if (!post || !Number.isSafeInteger(post.id) || post.id <= 0 || typeof post.body !== "string" || post.locked !== false || post.section !== section || typeof post.publishedDate !== "string" || (post.visibility && post.visibility !== "PUBLIC"))
      throw new Error("공개 글 상세 형식 오류");
    checkedSlug(post.slug);
    if (postIds.has(post.id) || routeToId.has(postPath(post))) throw new Error("공개 글 ID/경로 중복");
    postIds.add(post.id); routeToId.set(postPath(post), post.id);
  };
  snapshot.posts.forEach((post) => assertPost(post, "TECH"));
  const projectSlugs = new Set();
  for (const project of snapshot.projects) {
    checkedSlug(project.slug);
    if (projectSlugs.has(project.slug)) throw new Error("프로젝트 slug 중복");
    projectSlugs.add(project.slug);
    if (project.sortOrder != null && !Number.isSafeInteger(project.sortOrder)) throw new Error("프로젝트 순서 형식 오류");
    if (project.visibility !== "PUBLIC") throw new Error("비공개 프로젝트는 정적 사이트에 포함할 수 없습니다.");
    const detail = snapshot.projectDetails[project.slug];
    if (!detail || detail.locked !== false || !detail.home || typeof detail.home.body !== "string" || !Number.isSafeInteger(detail.home.id) || typeof detail.home.publishedDate !== "string") throw new Error("프로젝트 대문 형식 오류");
    if (detail.project?.id !== project.id || detail.home.id <= 0 || postIds.has(detail.home.id)) throw new Error("프로젝트 대문 ID 불일치");
    postIds.add(detail.home.id);
    routeToId.set(route(`project/${project.slug}/`), detail.home.id);
    if (!snapshot.projectDocuments[project.slug]) throw new Error("프로젝트 문서 목록 누락");
    for (const [slug, post] of Object.entries(snapshot.projectDocuments[project.slug])) {
      if (post.slug !== slug || post.projectSlug !== project.slug) throw new Error("프로젝트 문서 경로 불일치");
      assertPost(post, "PROJECT_DOC");
    }
  }
  if (Object.keys(snapshot.projectDetails).some((slug) => !projectSlugs.has(slug)) ||
    Object.keys(snapshot.projectDocuments).some((slug) => !projectSlugs.has(slug))) throw new Error("미공개 프로젝트 상세 혼입");
  const courseSlugs = new Set();
  for (const course of snapshot.notes) {
    checkedSlug(course.slug);
    if (courseSlugs.has(course.slug)) throw new Error("과목 slug 중복");
    courseSlugs.add(course.slug);
    if (!snapshot.courseDetails[course.slug]) throw new Error("과목 상세 누락");
    if (snapshot.courseDetails[course.slug].course?.id !== course.id || !snapshot.chapters[course.slug]) throw new Error("과목 ID/회차 누락");
    for (const [slug, post] of Object.entries(snapshot.chapters[course.slug])) {
      if (post.slug !== slug || post.courseSlug !== course.slug) throw new Error("회차 경로 불일치");
      assertPost(post, "NOTE_CHAPTER");
    }
  }
  if (Object.keys(snapshot.courseDetails).some((slug) => !courseSlugs.has(slug)) ||
    Object.keys(snapshot.chapters).some((slug) => !courseSlugs.has(slug))) throw new Error("미공개 과목 상세 혼입");
  if (snapshot.feed.some((item) => item.visibility !== "PUBLIC" || routeToId.get(postPath(item)) !== item.id))
    throw new Error("공개 목록과 상세 불일치");
  return snapshot;
}

/** 헤더·푸터·정적 경로를 모든 공개 페이지에 함께 넣는다. */
function page(title, body, section = "", description = "Ken Blog", canonical = locationOf(section)) {
  const nav = [["", "Home"], ["tech/", "Tech"], ["projects/", "Projects"], ["notes/", "Notes"], ["search/", "Search"]]
    .map(([path, label]) => `<a href="${route(path)}"${section === label ? ' aria-current="page"' : ""}>${label}</a>`).join("");
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} | ken.blog</title><meta name="description" content="${esc(description)}"><link rel="canonical" href="https://gjaku1031.github.io${route(canonical)}"><link rel="stylesheet" href="${route("assets/public.css")}"></head><body data-route="${esc(section.toLowerCase())}"><a class="skip-link" href="#main">본문으로 이동</a><div class="site-root"><header class="site-header"><div class="header-inner"><a class="brand" href="${route()}">ken<span class="brand-dot">.</span>blog</a><nav class="main-nav" aria-label="주 메뉴">${nav}</nav>${adminHref ? `<a class="site-admin-link" href="${esc(adminHref)}">관리</a>` : ""}<button id="theme-toggle" class="icon-button" type="button" aria-label="테마 전환">◐</button></div></header><main id="main" class="site-content">${body}</main><footer class="site-footer"><div class="footer-inner"><span>© ken.blog</span><div><a href="${route("tech/")}">Tech</a><a href="${route("projects/")}">Projects</a><a href="${route("notes/")}">Notes</a>${footerGithub ? `<a href="${esc(footerGithub)}" rel="noopener noreferrer">GitHub</a>` : ""}</div></div></footer></div><script type="module" src="${route("assets/public.js")}"></script></body></html>`;
}
/** 기본 목록의 정적 canonical 경로를 반환한다. */
function locationOf(section) { return section === "Tech" || section === "Post" ? "tech/" : section === "Projects" || section === "Project" ? "projects/" : section === "Notes" || section === "Course" ? "notes/" : section === "Search" ? "search/" : ""; }
/** 원문 경로가 아닌 정적 HTML 파일만 생성한다. */
async function writePage(path, html) { const filename = join(out, path, "index.html"); await mkdir(dirname(filename), { recursive: true }); await writeFile(filename, html); }
/** 목록의 제목과 현재 필터 개수 영역을 생성한다. */
const listTitle = (title) => `<div class="section-heading"><h1>${esc(title)}</h1><span id="filter-count" class="feed-total"></span></div>`;
/** 현재 목록에 실제로 나타나는 카테고리·태그만 탐색에 노출한다. */
const sidebar = (items) => {
  const categories = unique(items.map((item) => item.category?.path).filter(Boolean)).sort();
  const tags = unique(items.flatMap((item) => item.tags ?? [])).sort();
  return `<aside class="static-sidebar card side-card"><label for="site-search">목록 검색</label><input id="site-search" type="search" placeholder="제목·요약 검색">${categories.length ? `<h2>카테고리</h2><nav class="category-tree">${categories.map((category) => `<a class="category-line" href="?category=${encodeURIComponent(category)}">${esc(category)}</a>`).join("")}</nav>` : ""}${tags.length ? `<h2>태그</h2><div class="tag-cloud">${tags.map((tag) => `<a href="?tag=${encodeURIComponent(tag)}">#${esc(tag)}</a>`).join(" ")}</div>` : ""}</aside>`;
};
/** 공개 요약 한 개를 검색 가능한 카드 HTML로 만든다. */
function card(item, href) {
  const title = item.title ?? item.name ?? "제목 없음";
  const summary = item.summary ?? item.overview ?? item.description ?? "";
  const category = item.category?.path ?? "";
  const tags = Array.isArray(item.tags) ? item.tags : [];
  const status = statusLabels[item.status] ?? item.section ?? item.status ?? "";
  const period = projectPeriod(item);
  return `<article class="card static-card" data-search-card data-search-text="${esc(`${title} ${summary} ${category} ${tags.join(" ")} ${status} ${period}`)}" data-category="${esc(category)}" data-tags="${esc(tags.join("|"))}"><div class="card-meta">${esc(status)} ${period ? `<span>${esc(period)}</span>` : ""} ${date(item.publishedDate ?? item.latestPublishedDate)}</div><h2><a href="${href}">${esc(title)}</a></h2><p>${esc(summary)}</p>${badgeList(item.stackBadges)}</article>`;
}
/** 목록과 사이드바를 읽기 HTML로 묶는다. */
function listing(title, items, pathOf, section) { return page(title, `<div class="page-container tech-page static-grid"><div>${listTitle(title)}<div class="static-list">${items.map((item) => card(item, pathOf(item))).join("") || '<p class="card static-empty">아직 공개된 글이 없습니다.</p>'}</div></div>${sidebar(items)}</div>`, section, `${title} 공개 글 목록`); }
/** 같은 프로젝트·과목의 공개 문서 순서를 안내한다. */
const navList = (title, items) => items?.length ? `<nav class="static-related"><h2>${esc(title)}</h2><ol>${items.map((item) => `<li><a href="${esc(item.href)}">${esc(item.title)}</a></li>`).join("")}</ol></nav>` : "";
/** 서버에서 준비한 본문·목차를 API 재조회 없는 문서 HTML로 감싼다. */
function article(post, rendered, breadcrumbs = "", extra = "", description = post.summary ?? post.title, beforeBody = "") {
  const toc = rendered.headings.filter((item) => item.depth === 2 || item.depth === 3);
  return page(post.title, `<div class="page-container post-page"><div class="static-breadcrumb">${breadcrumbs}</div><div class="static-grid"><article><header class="static-post-header"><div class="card-meta">${esc(post.section ?? "")} ${date(post.publishedDate)}</div><h1>${esc(post.title)}</h1>${post.summary ? `<p class="summary">${esc(post.summary)}</p>` : ""}</header>${beforeBody}<div class="markdown-body">${rendered.html}</div>${extra}</article>${toc.length ? `<aside class="static-toc"><strong>목차</strong>${toc.map((item) => `<a href="#${esc(item.id)}">${esc(item.label)}</a>`).join("")}</aside>` : ""}</div></div>`, "", description, postPath(post).slice(basePath.length));
}

/** 명시한 fixture 또는 배포 잠금 안의 공개 소스에서만 정적 산출물을 만든다. */
async function main() {
  if (process.env.SITE_BASE_PATH && process.env.SITE_BASE_PATH !== "/ken-blog") throw new Error("SITE_BASE_PATH는 /ken-blog여야 합니다.");
  const fixtureArg = process.argv.find((arg) => arg.startsWith("--fixture") || arg === "--empty");
  const fixture = !!fixtureArg;
  const base = apiBase();
  if (!fixture && !process.env.SITE_DEPLOYMENT_ID) throw new Error("운영 빌드에는 SITE_DEPLOYMENT_ID 배포 잠금 ID가 필요합니다.");
  if (!fixture && !base) throw new Error("운영 빌드에는 PUBLIC_API_BASE_URL이 필요합니다.");
  if (!fixture && process.env.SITE_INPUT) throw new Error("운영 SITE_INPUT은 허용하지 않습니다. claim된 API에서 직접 수집해야 합니다.");
  let snapshot;
  if (fixtureArg === "--fixture=empty" || fixtureArg === "--fixture" || fixtureArg === "--empty") {
    snapshot = { version: 1, profile: null, feed: [], projects: [], notes: [], posts: [], projectDetails: {}, projectDocuments: {}, courseDetails: {}, chapters: {} };
  } else if (fixtureArg?.startsWith("--fixture=")) snapshot = JSON.parse(await readFile(resolve(fixtureArg.slice(10)), "utf8"));
  else if (base) {
    snapshot = await capture(base);
    await mkdir(join(root, "target/site-input"), { recursive: true });
    await writeFile(join(root, "target/site-input/public.json"), JSON.stringify(snapshot));
  }
  else throw new Error("SITE_INPUT 또는 PUBLIC_API_BASE_URL이 필요합니다.");
  // 빈 공개 사이트는 잠금 ID를 받은 실제 API 캡처가 모든 응답을 검증한 경우에만 가능하다.
  snapshot = validate(snapshot, fixture, !fixture && !!base && !!process.env.SITE_DEPLOYMENT_ID);
  await rm(out, { recursive: true, force: true });
  adminHref = base ? `${base.origin}/manage/` : "";
  footerGithub = /^https:\/\/[^\s<>"'\\]+$/.test(snapshot.profile?.github ?? "") ? snapshot.profile.github : "";
  await buildFrontend({ adminAssets: false });
  await mkdir(join(out, "assets"), { recursive: true });
  await cp(join(root, "target/public-assets"), join(out, "assets"), { recursive: true });
  await cp(join(root, "src/main/frontend/public/licenses"), join(out, "licenses"), { recursive: true });
  const rendererFile = join(root, "target/.site-markdown.mjs");
  await bundle({ entryPoints: [join(root, "src/main/frontend/shared/markdown.ts")], outfile: rendererFile,
    bundle: true, packages: "external", platform: "node", format: "esm", target: "node24", logLevel: "silent" });
  const { renderMarkdown } = await import(pathToFileURL(rendererFile).href);
  const allPosts = [...snapshot.posts, ...snapshot.projects.map((project) => ({ ...snapshot.projectDetails[project.slug].home, section: "PROJECT_HOME", projectSlug: project.slug })),
    ...Object.values(snapshot.projectDocuments).flatMap((docs) => Object.values(docs)), ...Object.values(snapshot.chapters).flatMap((docs) => Object.values(docs))];
  const parsedPosts = new Map();
  const imageOwners = new Map();
  const imageIds = new Set();
  for (const post of allPosts) {
    const parsed = await renderMarkdown(post.body);
    parsedPosts.set(post.id, parsed);
    for (const id of parsed.attachmentIds) { imageIds.add(id); imageOwners.set(id, post.id); }
  }
  const attachmentUrls = new Map();
  for (const id of [...imageIds].sort((a, b) => a - b)) {
    const postId = imageOwners.get(id);
    const path = `/api/v1/posts/${postId}/attachments/${id}/content`;
    attachmentUrls.set(id, await download(imagePath(path, base, path), `attachment-${id}`, !fixture));
  }
  if (snapshot.profile?.photoUrl) snapshot.profile.photoUrl = await download(imagePath(snapshot.profile.photoUrl, base, "/api/v1/profile/photo"), "profile", !fixture);
  const badges = new Map();
  for (const project of snapshot.projects) for (const badge of project.stackBadges ?? []) {
    if (!badges.has(badge.id)) badges.set(badge.id, badge);
  }
  for (const badge of badges.values()) badge.imageUrl = await download(imagePath(badge.imageUrl, base, `/api/v1/stack-badges/${badge.id}/image`), `stack-${badge.id}`, !fixture);
  for (const project of snapshot.projects) for (const badge of project.stackBadges ?? []) badge.imageUrl = badges.get(badge.id).imageUrl;
  const linkByTitle = new Map();
  const duplicateTitles = new Set();
  for (const post of allPosts) {
    const key = wikiKey(post.title);
    if (linkByTitle.has(key)) duplicateTitles.add(key);
    else linkByTitle.set(key, postPath(post));
  }
  for (const key of duplicateTitles) linkByTitle.delete(key);
  const backlinksByPath = new Map();
  for (const post of allPosts) {
    const sourcePath = postPath(post);
    for (const title of parsedPosts.get(post.id)?.wikiTargets ?? []) {
      const target = linkByTitle.get(wikiKey(title));
      if (!target || target === sourcePath) continue;
      const links = backlinksByPath.get(target) ?? new Map();
      links.set(sourcePath, { href: sourcePath, title: post.title });
      backlinksByPath.set(target, links);
    }
  }
  const backlinks = (post) => navList("이 글을 참조한 글", [...(backlinksByPath.get(postPath(post))?.values() ?? [])]);
  const render = (body) => renderMarkdown(body, { attachmentUrl: (id) => attachmentUrls.get(id) ?? null, wikiUrl: (title) => linkByTitle.get(wikiKey(title)) ?? null, sourceMap: true });
  const profile = snapshot.profile;
  const hasProfile = profile && (profile.name || profile.tagline || profile.intro || profile.photoUrl || profile.github || profile.email);
  const hero = hasProfile ? `<section class="card static-hero">${profile.photoUrl ? `<img src="${esc(profile.photoUrl)}" alt="${esc(profile.name || "프로필 사진")}">` : ""}<div><p class="eyebrow">HELLO</p><h1>${esc(profile.name || "소개")}</h1><p>${esc(profile.tagline)}</p><p>${esc(profile.intro)}</p><div class="static-profile-links">${/^https:\/\//.test(profile.github ?? "") ? `<a href="${esc(profile.github)}" rel="noopener noreferrer">GitHub</a>` : ""}${safeEmail(profile.email) ? `<a href="mailto:${esc(profile.email)}">${esc(profile.email)}</a>` : ""}</div></div></section>` : "";
  const homeItems = snapshot.feed.slice().sort((a, b) => String(b.publishedDate).localeCompare(String(a.publishedDate))).slice(0, 12);
  await writePage("", page("Home", `<div class="page-container home-page">${hero}${listTitle("최근 글")}<div class="static-list">${homeItems.map((item) => card(item, postPath(item))).join("") || '<p class="card static-empty">아직 공개된 글이 없습니다.</p>'}</div></div>`, "Home"));
  const techItems = snapshot.feed.filter((item) => item.section === "TECH").sort((a, b) => String(b.publishedDate).localeCompare(String(a.publishedDate)));
  await writePage("tech", listing("Tech", techItems, postPath, "Tech"));
  await writePage("post", listing("Tech", techItems, postPath, "Post"));
  const sortedProjects = snapshot.projects.slice().sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || b.id - a.id);
  await writePage("projects", listing("Projects", sortedProjects, (item) => route(`project/${item.slug}/`), "Projects"));
  await writePage("project", listing("Projects", sortedProjects, (item) => route(`project/${item.slug}/`), "Project"));
  await writePage("notes", listing("Notes", snapshot.notes, (item) => route(`course/${item.slug}/`), "Notes"));
  await writePage("course", listing("Notes", snapshot.notes, (item) => route(`course/${item.slug}/`), "Course"));
  await writePage("search", listing("Search", snapshot.feed, postPath, "Search"));
  for (const post of snapshot.posts) {
    const series = post.series?.items?.slice().sort((a, b) => a.order - b.order).map((item) => ({ href: route(`post/${checkedSlug(item.slug)}/`), title: `${item.order}. ${item.title}` })) ?? [];
    const related = post.relatedProject ? navList("관련 프로젝트", [{ href: route(`project/${checkedSlug(post.relatedProject.slug)}/`), title: post.relatedProject.name }]) : "";
    await writePage(`post/${post.slug}`, article(post, await render(post.body), `<a href="${route("tech/")}">Tech</a> / ${esc(post.title)}`, related + navList("시리즈", series) + backlinks(post)));
  }
  for (const project of snapshot.projects) {
    const detail = snapshot.projectDetails[project.slug];
    const docs = detail.documents?.filter((item) => snapshot.projectDocuments[project.slug]?.[item.slug]?.id === item.id && item.visibility !== "PRIVATE" && item.locked !== true)
      .map((item) => ({ href: route(`project/${project.slug}/docs/${checkedSlug(item.slug)}/`), title: item.title, order: item.order }))?.sort((a, b) => a.order - b.order) ?? [];
    const home = { ...detail.home, section: "PROJECT_HOME", projectSlug: project.slug, title: project.name };
    const relatedTech = unique([...snapshot.posts.filter((tech) => tech.relatedProject?.slug === project.slug), ...detail.relatedTech]
      .map((tech) => tech.slug)).map((slug) => {
        const tech = snapshot.posts.find((post) => post.slug === slug);
        return tech ? { href: route(`post/${checkedSlug(tech.slug)}/`), title: tech.title } : null;
      }).filter(Boolean);
    const facts = `<div class="static-project-facts"><span>${esc(statusLabels[project.status] ?? project.status)}</span>${projectPeriod(project) ? `<span>${esc(projectPeriod(project))}</span>` : ""}</div>${project.overview ? `<p class="static-project-overview">${esc(project.overview)}</p>` : ""}${badgeList(project.stackBadges)}`;
    await writePage(`project/${project.slug}`, article(home, await render(home.body), `<a href="${route("projects/")}">Projects</a> / ${esc(project.name)}`, navList("문서", docs) + navList("관련 Tech", relatedTech) + backlinks(home), project.overview || project.name, facts));
    for (const post of Object.values(snapshot.projectDocuments[project.slug] ?? {})) await writePage(`project/${project.slug}/docs/${post.slug}`, article(post, await render(post.body), `<a href="${route("projects/")}">Projects</a> / <a href="${route(`project/${project.slug}/`)}">${esc(project.name)}</a> / ${esc(post.title)}`, navList("문서", docs) + backlinks(post)));
  }
  for (const course of snapshot.notes) {
    const detail = snapshot.courseDetails[course.slug];
    const chapters = (detail.chapters ?? []).filter((item) => snapshot.chapters[course.slug]?.[item.slug]?.id === item.id && item.visibility !== "PRIVATE" && item.locked !== true)
      .slice().sort((a, b) => a.position - b.position).map((item) => ({ href: route(`course/${course.slug}/chapters/${checkedSlug(item.slug)}/`), title: item.title }));
    await writePage(`course/${course.slug}`, page(course.name, `<div class="page-container post-page"><div class="static-breadcrumb"><a href="${route("notes/")}">Notes</a> / ${esc(course.name)}</div><header class="static-post-header"><p class="eyebrow">${esc(course.field)}</p><h1>${esc(course.name)}</h1><p>${esc(course.description)}</p></header>${navList("회차", chapters)}</div>`, "", course.description, `course/${course.slug}/`));
    for (const post of Object.values(snapshot.chapters[course.slug] ?? {})) await writePage(`course/${course.slug}/chapters/${post.slug}`, article(post, await render(post.body), `<a href="${route("notes/")}">Notes</a> / <a href="${route(`course/${course.slug}/`)}">${esc(course.name)}</a> / ${esc(post.title)}`, navList("회차", chapters) + backlinks(post)));
  }
  await writeFile(join(out, "robots.txt"), "User-agent: *\nAllow: /ken-blog/\nSitemap: https://gjaku1031.github.io/ken-blog/sitemap.xml\n");
  const pages = ["", "tech/", "projects/", "notes/", "search/", ...snapshot.posts.map((post) => `post/${post.slug}/`), ...snapshot.projects.map((project) => `project/${project.slug}/`), ...snapshot.notes.map((course) => `course/${course.slug}/`),
    ...snapshot.projects.flatMap((project) => Object.keys(snapshot.projectDocuments[project.slug] ?? {}).map((slug) => `project/${project.slug}/docs/${slug}/`)),
    ...snapshot.notes.flatMap((course) => Object.keys(snapshot.chapters[course.slug] ?? {}).map((slug) => `course/${course.slug}/chapters/${slug}/`))];
  await writeFile(join(out, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${pages.map((path) => `<url><loc>https://gjaku1031.github.io${route(path)}</loc></url>`).join("")}</urlset>`);
  await writeFile(join(out, "routes.json"), JSON.stringify(pages));
  await writeFile(join(out, "404.html"), page("페이지 없음", `<div class="page-container not-found-page"><div class="not-found-content"><span class="not-found-code">404</span><h1>페이지를 찾을 수 없습니다.</h1><p><a href="${route()}">홈으로 이동</a></p></div></div>`));
  if (!fixture && base) await assertCaptureOwner(base);
  await checkArtifact();
  await rm(publishedOut, { recursive: true, force: true });
  await rename(out, publishedOut);
  console.log(`정적 페이지 ${pages.length}개, 첨부 ${attachmentUrls.size}개 생성`);
}

/** Pages 산출물의 전체 크기와 허용된 최상위 파일만 검사한다. */
async function checkArtifact() {
  const allowed = new Set(["assets", "licenses", "index.html", "404.html", "robots.txt", "sitemap.xml", "routes.json",
    "tech", "post", "projects", "project", "notes", "course", "search"]);
  for (const name of await readdir(out)) if (!allowed.has(name)) throw new Error(`허용되지 않은 Pages 산출물: ${name}`);
  let bytes = 0;
  let files = 0;
  const visit = async (folder) => {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const filename = join(folder, entry.name);
      if (entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory())) throw new Error("Pages 산출물 링크/특수 파일 오류");
      if (entry.isDirectory()) { await visit(filename); continue; }
      if (++files > 20_000) throw new Error("Pages 파일 수 초과");
      bytes += (await stat(filename)).size;
      if (bytes > 900 * 1024 * 1024) throw new Error("Pages 산출물 크기 초과");
      if (entry.name.startsWith(".env") || /^(AGENTS\.md|pom\.xml|package(?:-lock)?\.json)$/i.test(entry.name))
        throw new Error(`내부 파일이 Pages 산출물에 포함됨: ${entry.name}`);
      if (folder === join(out, "assets") && /^admin(?:\.|-)/i.test(entry.name)) throw new Error("관리자 자산이 Pages에 포함됨");
    }
  };
  await visit(out);
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
