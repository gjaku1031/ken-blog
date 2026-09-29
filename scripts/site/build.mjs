import { build as bundle } from "esbuild";
import { capture, assertCaptureOwner } from "./capture.mjs";
import { buildFrontend } from "../build-frontend.mjs";
import { readFile, writeFile, mkdir, rm, cp, readdir, stat, rename } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, join, dirname } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "../..");
const out = join(root, "target/site-staging");
const publishedOut = join(root, "target/site");
const basePath = "/ken-blog/";
const footerGithub = "https://github.com/gjaku1031/ken-blog";
let adminHref = "";
let publicAssets;
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const route = (path = "") => `${basePath}${path}`;
const checkedSlug = (value) => { if (!slugPattern.test(value ?? "")) throw new Error("공개 slug 형식 오류"); return value; };
const postPath = (post) => post.section === "PROJECT_HOME" ? route(`project/${checkedSlug(post.projectSlug)}/`) :
  post.section === "PROJECT_DOC" ? route(`project/${checkedSlug(post.projectSlug)}/docs/${checkedSlug(post.slug)}/`) :
  post.section === "NOTE_CHAPTER" ? route(`course/${checkedSlug(post.courseSlug)}/chapters/${checkedSlug(post.slug)}/`) : route(`post/${checkedSlug(post.slug)}/`);
const unique = (items) => [...new Set(items)];
const wikiKey = (title) => title.toLocaleLowerCase("und");
/** 이미 정화해 렌더한 공개 HTML에서 검색용 표시 텍스트만 꺼낸다. */
function searchText(html) {
  const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return html.replace(/<[^>]*>/g, " ").replace(/&(#(?:x[0-9a-f]+|[0-9]+)|[a-z]+);/gi, (entity, code) => {
    if (code[0] !== "#") return named[code.toLowerCase()] ?? entity;
    const value = code[1]?.toLowerCase() === "x" ? Number.parseInt(code.slice(2), 16) : Number.parseInt(code.slice(1), 10);
    return Number.isSafeInteger(value) && value >= 32 && value <= 0x10ffff && !(value >= 0xd800 && value <= 0xdfff)
      ? String.fromCodePoint(value) : " ";
  }).replace(/\s+/gu, " ").trim();
}
const statusLabels = { PLAN: "기획 중", DEV: "개발 중", MAINT: "유지보수 중", DONE: "완료" };
const safeEmail = (value) => typeof value === "string" && /^[^\s@<>"'/?#]+@[^\s@<>"'/?#]+\.[A-Za-z]{2,}$/.test(value);
const projectPeriod = (project) => !project.startPeriod ? project.endPeriod ?? "" : !project.endPeriod ? project.status === "DONE" ? project.startPeriod : `${project.startPeriod} – 현재` : project.startPeriod === project.endPeriod ? project.startPeriod : `${project.startPeriod} – ${project.endPeriod}`;
const badgeList = (badges) => badges?.length ? `<div class="stack-badges" aria-label="기술 배지">${badges.map((badge) => `<span><img src="${esc(badge.imageUrl)}" alt="" width="22" height="22">${esc(badge.name)}</span>`).join("")}</div>` : "";
const dated = (value) => value ? esc(String(value).slice(0, 10).replaceAll("-", ".")) : "";
const icon = (name) => name === "search" ? '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 5 5"/></svg>' : name === "sun" ? '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/></svg>' : '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.6 14.1A8.6 8.6 0 0 1 9.9 3.4 8.6 8.6 0 1 0 20.6 14.1Z"/></svg>';
const drillLogo = '<svg width="32" height="32" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><g transform="rotate(-45 24 24)"><path d="M8 12.5 L45 24 L8 35.5 Z"/><path d="M14 14.4 Q17.5 24 14 33.6 M22 16.9 Q24.8 24 22 31.1 M30 19.4 Q32 24 30 28.6 M37 21.6 Q38.2 24 37 26.4"/></g></svg>';
const githubIcon = '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .9a11.1 11.1 0 0 0-3.51 21.63c.55.1.76-.24.76-.54v-2.14c-3.09.67-3.74-1.31-3.74-1.31-.5-1.28-1.23-1.62-1.23-1.62-1.01-.69.08-.68.08-.68 1.12.08 1.71 1.15 1.71 1.15.99 1.7 2.59 1.21 3.22.92.1-.72.39-1.21.71-1.49-2.47-.28-5.07-1.23-5.07-5.49 0-1.21.43-2.2 1.14-2.98-.11-.28-.49-1.41.11-2.94 0 0 .93-.3 3.05 1.14a10.6 10.6 0 0 1 5.55 0c2.12-1.44 3.04-1.14 3.04-1.14.61 1.53.23 2.66.12 2.94.71.78 1.14 1.77 1.14 2.98 0 4.27-2.61 5.21-5.09 5.48.4.35.76 1.03.76 2.08v3.09c0 .3.2.65.77.54A11.1 11.1 0 0 0 12 .9Z"/></svg>';
const emailIcon = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="m3.5 6 8.5 7 8.5-7"/></svg>';

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
  const digest = createHash("sha256").update(bytes).digest("hex");
  const filename = `${name}-${digest}.${png ? "png" : "jpg"}`;
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
  const active = section === "Post" ? "Tech" : section === "Project" ? "Projects" : section === "Course" ? "Notes" : section === "Search" ? "Home" : section;
  const nav = [["", "Home"], ["tech/", "Tech"], ["projects/", "Projects"], ["notes/", "Notes"]]
    .map(([path, label]) => `<a href="${route(path)}"${active === label ? ' aria-current="page"' : ""}>${label}</a>`).join("");
  const searching = section === "Search";
  const documentTitle = section === "Home" ? "ken.blog | Tech·Projects·Notes" : searching ? "ken.blog" : `${title} | ken.blog`;
  const socialTitle = ["Post", "Project", "Course"].includes(section) && canonical !== locationOf(section) ? title : documentTitle;
  const summary = section === "Home" ? "기술 글과 프로젝트, 학습 기록을 모아 둔 ken.blog" : searching ? "Tech 글과 프로젝트 기록을 읽는 ken.blog" :
    section === "Projects" || section === "Project" && canonical === "projects/" ? "ken.blog의 프로젝트 기록과 문서" : description;
  const seo = `<meta property="og:title" content="${esc(socialTitle)}"><meta property="og:description" content="${esc(summary)}"><meta property="og:url" content="https://gjaku1031.github.io${route(canonical)}"><meta property="og:site_name" content="ken.blog"><meta property="og:locale" content="ko_KR"><meta property="og:type" content="${["Post", "Project", "Course"].includes(section) && canonical !== locationOf(section) ? "article" : "website"}"><meta name="twitter:card" content="summary"><meta name="twitter:title" content="${esc(socialTitle)}"><meta name="twitter:description" content="${esc(summary)}">`;
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(documentTitle)}</title><meta name="description" content="${esc(summary)}">${seo}<link rel="canonical" href="https://gjaku1031.github.io${route(canonical)}"><link rel="stylesheet" href="${route(`assets/${publicAssets.css}`)}"></head><body data-route="${esc(section.toLowerCase())}"><div class="site-root"><a class="skip-link" href="#main-content">본문으로 건너뛰기</a><header class="site-header"><div class="header-inner"><a class="brand" href="${route()}" aria-label="ken.blog 홈">${drillLogo}<span>ken<span class="brand-dot">.</span>blog</span></a><nav class="main-nav" aria-label="주 메뉴">${nav}</nav><div class="header-actions"><div class="header-search-unit${searching ? " is-open" : ""}"><button id="header-search-toggle" type="button" class="header-search-toggle" aria-label="검색 ${searching ? "닫기" : "열기"}" aria-expanded="${searching}" aria-controls="site-search">${icon("search")}</button><form class="header-search" role="search" action="${route("search/")}" aria-hidden="${!searching}"${searching ? "" : " inert"}><label class="sr-only" for="site-search">글 검색</label><input id="site-search" name="q" type="search" placeholder="제목 · 본문 · 태그 검색"><button id="header-search-close" type="button" class="header-search-close" aria-label="검색 닫기">×</button></form></div><button id="theme-toggle" type="button" class="theme-switch" role="switch" aria-checked="false" aria-label="다크 모드" title="다크 모드 꺼짐"><span class="theme-switch-track"><span class="theme-switch-thumb"><span class="theme-icon-sun">${icon("sun")}</span><span class="theme-icon-moon">${icon("moon")}</span></span></span></button>${adminHref ? `<a class="header-text-button" href="${esc(adminHref)}">관리자</a>` : ""}</div></div></header><div class="site-content">${body}</div><footer class="site-footer"><span>© ${new Date().getUTCFullYear()} ken.blog</span><div>${footerGithub ? `<a href="${esc(footerGithub)}" rel="noopener noreferrer">GitHub</a>` : ""}${adminHref ? `<a href="${esc(adminHref)}">관리자</a>` : ""}</div></footer></div><script type="module" src="${route(`assets/${publicAssets.js}`)}"></script></body></html>`;
}
/** 기본 목록의 정적 canonical 경로를 반환한다. */
function locationOf(section) { return section === "Tech" || section === "Post" ? "tech/" : section === "Projects" || section === "Project" ? "projects/" : section === "Notes" || section === "Course" ? "notes/" : section === "Search" ? "search/" : ""; }
/** 원문 경로가 아닌 정적 HTML 파일만 생성한다. */
async function writePage(path, html) { const filename = join(out, path, "index.html"); await mkdir(dirname(filename), { recursive: true }); await writeFile(filename, html); }
/** 현재 목록에 실제로 나타나는 카테고리·태그만 탐색에 노출한다. */
const sidebar = (items) => {
  const categories = unique(items.map((item) => item.category?.path).filter(Boolean)).sort();
  const tags = unique(items.flatMap((item) => item.tags ?? [])).sort();
  return `<aside class="feed-sidebar" aria-label="Tech 탐색"><section class="side-card card"><h2>분류</h2><ul class="category-tree">${categories.map((category) => `<li><div class="category-line"><a href="?category=${encodeURIComponent(category)}"><span>${esc(category)}</span></a></div></li>`).join("")}</ul></section><section class="side-card card"><h2>태그</h2><div class="tag-cloud">${tags.map((tag) => `<a href="?tag=${encodeURIComponent(tag)}">#${esc(tag)}</a>`).join(" ")}</div></section></aside>`;
};
/** 공개 요약 한 개를 검색 가능한 카드 HTML로 만든다. */
function card(item, href) {
  const title = item.title ?? item.name ?? "제목 없음";
  const summary = item.summary ?? item.overview ?? item.description ?? "";
  const category = item.category?.path ?? "";
  const tags = Array.isArray(item.tags) ? item.tags : [];
  const label = item.section === "TECH" ? "Tech" : item.section === "NOTE_CHAPTER" ? "Notes" : "Projects";
  const context = item.section === "NOTE_CHAPTER" ? [item.courseField, item.courseName].filter(Boolean).join(" › ") : item.projectName ?? "";
  return `<article class="post-card card" data-search-card data-search-text="${esc(`${title} ${summary} ${category} ${tags.join(" ")} ${context} ${item.searchBody ?? ""}`)}" data-category="${esc(category)}" data-tags="${esc(tags.join("|"))}"><div class="card-meta"><strong>${label}</strong>${category ? `<span>· ${esc(category)}</span>` : ""}${context ? `<span>· ${esc(context)}</span>` : ""}</div>${item.section === "TECH" && item.relatedProject?.name ? `<div class="card-related-project"><span>[연관 프로젝트]</span> ${esc(item.relatedProject.name)}</div>` : ""}<div class="card-title-row"><h2><a href="${esc(href)}">${esc(title)}</a></h2></div>${summary ? `<p class="post-summary">${esc(summary)}</p>` : ""}<div class="card-bottom"><div class="tag-list">${tags.map((tag) => `<a href="?tag=${encodeURIComponent(tag)}">#${esc(tag)}</a>`).join("")}</div><time class="mono" datetime="${esc(item.publishedDate ?? item.latestPublishedDate ?? "")}">${dated(item.publishedDate ?? item.latestPublishedDate)}</time></div></article>`;
}
/** 목록과 사이드바를 읽기 HTML로 묶는다. */
function listing(title, items, pathOf, section) { const searching = section === "Search"; return page(title, `<main id="main-content" class="page-container ${searching ? "search-page" : "tech-page"}"><div class="content-grid"><section class="feed-column"><div class="section-heading"><h1>${searching ? "최근 글" : esc(title)}</h1><span id="filter-count" class="mono feed-total"></span></div>${searching ? '<p id="search-filter" class="active-filters"></p>' : ""}<div class="post-list">${items.map((item) => card(item, pathOf(item))).join("") || '<p class="message-card card">아직 공개된 글이 없습니다.</p>'}</div><p id="filter-empty" class="message-card card" hidden>검색 결과가 없습니다.</p></section>${sidebar(items)}</div></main>`, section, `${title} 공개 글 목록`); }
/** 원본 프로젝트 카드의 상태·배지·문서 수를 정적 공개 목록에 재현한다. */
function projectsPage(items, section) { return page("Projects", `<main id="main-content" class="page-container projects-page"><div class="projects-heading"><h1>Projects</h1></div><div class="projects-grid">${items.map((item) => `<article class="project-card card hv"><div class="project-card-top"><span class="project-status project-status-${esc(String(item.status ?? "plan").toLowerCase())}"><span aria-hidden="true"></span>${esc(statusLabels[item.status] ?? item.status)}</span>${projectPeriod(item) ? `<span class="mono project-period">${esc(projectPeriod(item))}</span>` : ""}</div><h2><a href="${route(`project/${checkedSlug(item.slug)}/`)}">${esc(item.name)}</a></h2><p>${esc(item.overview)}</p>${badgeList(item.stackBadges)}<div class="project-card-counts">문서 ${esc(item.documentCount ?? 0)}개${item.relatedTechCount ? ` · 관련 글 ${esc(item.relatedTechCount)}개` : ""}</div></article>`).join("")}</div>${items.length ? "" : '<p class="projects-empty">아직 출간된 프로젝트가 없습니다.</p>'}</main>`, section, "Projects 공개 프로젝트 목록"); }
/** 원본 Notes의 분야별 3열 카드 구조를 공개 과목에 적용한다. */
function notesPage(items, section) { const groups = Map.groupBy(items, (item) => item.field || "기타"); return page("Notes", `<main id="main-content" class="page-container notes-page"><div class="section-heading"><h1>Notes</h1></div>${[...groups].map(([field, courses]) => `<section class="notes-group"><h2>${esc(field)}</h2><div class="notes-grid">${courses.map((course) => `<article class="course-card card hv"><h3><a href="${route(`course/${checkedSlug(course.slug)}/`)}">${esc(course.name)}</a></h3>${course.description ? `<p>${esc(course.description)}</p>` : ""}<div class="course-card-meta">${esc(course.chapterCount ?? 0)}회차 · ${course.status === "COMPLETED" ? "완결" : "진행 중"}${course.latestPublishedDate ? ` · <time datetime="${esc(course.latestPublishedDate)}">${dated(course.latestPublishedDate)}</time>` : ""}</div></article>`).join("")}</div></section>`).join("")}${items.length ? "" : '<div class="message-card card">아직 등록된 과목이 없습니다.</div>'}</main>`, section, "Notes 공개 과목 목록"); }
const tocList = (rendered) => { const headings = rendered.headings.filter((item) => item.depth === 2 || item.depth === 3); return headings.length ? `<nav class="post-toc" aria-label="목차"><h2>목차</h2><ol>${headings.map((item) => `<li class="${item.depth === 3 ? "toc-depth-three" : ""}"><a href="#${esc(item.id)}">${esc(item.label)}</a></li>`).join("")}</ol></nav>` : ""; };
/** 서버에서 준비한 본문·목차를 API 재조회 없는 문서 HTML로 감싼다. */
function article(post, rendered, breadcrumbs = "", extra = "", description = post.summary ?? post.title, beforeBody = "", sideExtra = "") {
  const toc = tocList(rendered);
  return page(post.title, `<main id="main-content" class="post-page page-container"><a href="${route("tech/")}" class="back-link">← Tech</a><article><div class="post-overline">${breadcrumbs}</div><h1>${esc(post.title)}</h1>${post.relatedProject?.name ? `<p class="post-related-project"><span>[연관 프로젝트]</span> <a href="${route(`project/${checkedSlug(post.relatedProject.slug)}/`)}">${esc(post.relatedProject.name)}</a></p>` : ""}<div class="detail-meta"><time class="mono" datetime="${esc(post.publishedDate)}">${dated(post.publishedDate)}</time></div>${post.tags?.length ? `<div class="tag-list detail-tags">${post.tags.map((tag) => `<a href="${route(`tech/?tag=${encodeURIComponent(tag)}`)}">#${esc(tag)}</a>`).join("")}</div>` : ""}${beforeBody}<div class="post-reading-layout${toc || sideExtra ? " has-toc" : ""}"><div class="post-main-content"><div class="markdown-body">${rendered.html}</div>${extra}</div>${toc || sideExtra ? `<aside class="post-side-rail can-stick">${toc}${sideExtra}</aside>` : ""}</div></article></main>`, "Post", description, postPath(post).slice(basePath.length));
}
/** 원본 프로젝트 대문·문서의 좌측 목차와 우측 본문 카드. */
function projectArticle(project, post, rendered, docs, relatedTech, backlinksHtml, isHome) {
  const current = isHome ? "" : post.slug;
  const selected = docs.findIndex((item) => item.slug === current);
  const toc = !isHome ? tocList(rendered) : "";
  const sidebarHtml = `<aside class="project-sidebar" aria-label="프로젝트 탐색"><a href="${route("projects/")}" class="back-link">← Projects</a><h2>${esc(project.name)}</h2><nav aria-label="프로젝트 문서"><a href="${route(`project/${checkedSlug(project.slug)}/`)}"${isHome ? ' aria-current="page"' : ""}>대문</a><ol>${docs.map((item, index) => `<li><a href="${esc(item.href)}"${item.slug === current ? ' aria-current="page"' : ""}>${index + 1}. ${esc(item.title)}</a></li>`).join("")}</ol></nav>${relatedTech.length ? `<section class="project-related"><h3>관련 글 · Tech ${relatedTech.length}</h3><ul>${relatedTech.map((item) => `<li><a href="${esc(item.href)}">${esc(item.title)}</a></li>`).join("")}</ul></section>` : ""}${toc}</aside>`;
  const homeHeader = `<div class="project-overline">Projects</div><h1>${esc(project.name)}</h1><div class="project-meta"><span class="project-status project-status-${esc(String(project.status ?? "plan").toLowerCase())}"><span aria-hidden="true"></span>${esc(statusLabels[project.status] ?? project.status)}</span>${projectPeriod(project) ? `<span class="mono">${esc(projectPeriod(project))}</span>` : ""}</div>${project.overview ? `<p class="project-overview">${esc(project.overview)}</p>` : ""}${badgeList(project.stackBadges)}`;
  const docHeader = `<div class="project-overline">Projects · <a href="${route(`project/${checkedSlug(project.slug)}/`)}">${esc(project.name)}</a> · ${dated(post.publishedDate)}</div><h1>${esc(post.title)}</h1>${post.tags?.length ? `<div class="tag-list detail-tags">${post.tags.map((tag) => `<a href="${route(`tech/?tag=${encodeURIComponent(tag)}`)}">#${esc(tag)}</a>`).join("")}</div>` : ""}`;
  const before = docs[selected - 1]; const after = docs[selected + 1];
  const neighbors = !isHome && (before || after) ? `<nav class="project-document-neighbors" aria-label="이전·다음 문서">${before ? `<a href="${esc(before.href)}"><span>← 이전 문서</span><strong>${selected}. ${esc(before.title)}</strong></a>` : ""}${after ? `<a href="${esc(after.href)}"><span>다음 문서 →</span><strong>${selected + 2}. ${esc(after.title)}</strong></a>` : ""}</nav>` : "";
  return page(post.title, `<main id="main-content" class="page-container project-page project-layout">${sidebarHtml}<article class="project-main card">${isHome ? homeHeader : docHeader}<div class="markdown-body">${rendered.html}</div>${backlinksHtml}</article>${neighbors}</main>`, "Project", isHome ? project.overview || project.name : post.summary || post.title, postPath(post).slice(basePath.length));
}
/** 원본 Notes 과목 소개와 회차 읽기 카드의 공개 구조. */
function courseArticle(course, post, rendered, chapters, backlinksHtml) {
  const current = post?.slug ?? "";
  const selected = chapters.findIndex((item) => item.slug === current);
  const sidebarHtml = `<aside class="project-sidebar course-sidebar" aria-label="과목 탐색"><a href="${route("notes/")}" class="back-link">← Notes</a><h2>${esc(course.field)} › ${esc(course.name)}</h2><nav aria-label="과목 회차"><a href="${route(`course/${checkedSlug(course.slug)}/`)}"${post ? "" : ' aria-current="page"'}>과목 소개</a><ol>${chapters.map((item, index) => `<li><a href="${esc(item.href)}"${item.slug === current ? ' aria-current="page"' : ""}>${index + 1}강 · ${esc(item.title)}</a></li>`).join("")}</ol></nav>${post ? tocList(rendered) : ""}</aside>`;
  const intro = `<article class="course-main course-intro-layout"><div class="course-intro-card card"><div class="project-overline">${esc(course.field)} · ${course.status === "COMPLETED" ? "완결" : "진행 중"} · ${chapters.length}회차</div><h1>${esc(course.name)}</h1>${course.description ? `<p class="project-overview">${esc(course.description)}</p>` : ""}</div><div class="course-list-card card">${chapters.length ? `<ol class="course-chapters">${chapters.map((item, index) => `<li><a href="${esc(item.href)}"><span class="course-chapter-number">${String(index + 1).padStart(2, "0")}</span><span class="course-chapter-text"><strong>${esc(item.title)}</strong>${item.summary ? `<small>${esc(item.summary)}</small>` : ""}</span><time datetime="${esc(item.publishedDate ?? "")}">${dated(item.publishedDate)}</time></a></li>`).join("")}</ol>` : '<p>아직 출간된 회차가 없습니다.</p>'}</div></article>`;
  const chapter = post ? `<article class="project-main card course-main"><div class="project-overline">Notes · <a href="${route(`course/${checkedSlug(course.slug)}/`)}">${esc(course.name)}</a> · ${selected + 1}강 / ${chapters.length} · ${dated(post.publishedDate)}</div><h1>${esc(post.title)}</h1><div class="markdown-body">${rendered.html}</div>${backlinksHtml}</article>` : "";
  const before = chapters[selected - 1]; const after = chapters[selected + 1];
  const neighbors = post && (before || after) ? `<nav class="project-document-neighbors course-neighbors" aria-label="이전·다음 회차">${before ? `<a href="${esc(before.href)}"><span>← 이전 ${selected}강</span><strong>${esc(before.title)}</strong></a>` : ""}${after ? `<a href="${esc(after.href)}"><span>다음 ${selected + 2}강 →</span><strong>${esc(after.title)}</strong></a>` : ""}</nav>` : "";
  return page(post?.title ?? course.name, `<main id="main-content" class="page-container course-page project-layout">${sidebarHtml}${post ? chapter : intro}${neighbors}</main>`, "Course", post?.summary ?? course.description ?? course.name, post ? postPath(post).slice(basePath.length) : `course/${course.slug}/`);
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
  ({ public: publicAssets } = await buildFrontend({ adminAssets: false }));
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
      links.set(sourcePath, { href: sourcePath, title: post.title, section: post.section });
      backlinksByPath.set(target, links);
    }
  }
  const backlinks = (post) => { const items = [...(backlinksByPath.get(postPath(post))?.values() ?? [])]; return items.length ? `<section class="post-backlinks" aria-label="이 글을 가리키는 글"><h2>이 글을 가리키는 글</h2><ul>${items.map((item) => `<li><a href="${esc(item.href)}">${esc(item.title)}</a><span>${item.section === "TECH" ? "Tech" : item.section === "NOTE_CHAPTER" ? "Notes" : "Projects"}</span></li>`).join("")}</ul></section>` : ""; };
  const render = (body) => renderMarkdown(body, { attachmentUrl: (id) => attachmentUrls.get(id) ?? null, wikiUrl: (title) => linkByTitle.get(wikiKey(title)) ?? null, sourceMap: true });
  const profile = snapshot.profile;
  const hasProfile = profile && (profile.name || profile.tagline || profile.intro || profile.photoUrl || profile.github || profile.email);
  const hero = hasProfile ? `<div class="home-summary"><section class="profile-card card" aria-label="블로그 소개"><div class="profile-head"><div class="profile-avatar">${profile.photoUrl ? `<img src="${esc(profile.photoUrl)}" alt="" width="64" height="64">` : `<span aria-hidden="true">${esc(profile.name?.trim().slice(0, 1) || "K")}</span>`}</div><div><h2>${esc(profile.name || "ken.blog")}</h2>${profile.tagline ? `<p>${esc(profile.tagline)}</p>` : ""}</div></div>${profile.intro ? `<p class="profile-intro">${esc(profile.intro)}</p>` : ""}${profile.github || safeEmail(profile.email) ? `<div class="profile-links">${profile.github?.startsWith("https://github.com/") ? `<a href="${esc(profile.github)}" target="_blank" rel="noreferrer noopener">${githubIcon}GitHub</a>` : ""}${safeEmail(profile.email) ? `<a class="profile-email-link" href="mailto:${esc(profile.email)}">${emailIcon}<span>${esc(profile.email)}</span></a>` : ""}</div>` : ""}</section></div>` : "";
  const homeItems = snapshot.feed.slice().sort((a, b) => String(b.publishedDate).localeCompare(String(a.publishedDate))).slice(0, 12);
  await writePage("", page("Home", `<main id="main-content" class="page-container home-page">${hero}<div class="content-grid"><section class="feed-column"><div class="section-heading"><h2>최근 글</h2></div><div class="post-list">${homeItems.map((item) => card(item, postPath(item))).join("") || '<p class="message-card card">아직 공개된 글이 없습니다.</p>'}</div></section>${sidebar(homeItems)}</div></main>`, "Home"));
  const techItems = snapshot.feed.filter((item) => item.section === "TECH").sort((a, b) => String(b.publishedDate).localeCompare(String(a.publishedDate)));
  await writePage("tech", listing("Tech", techItems, postPath, "Tech"));
  await writePage("post", listing("Tech", techItems, postPath, "Post"));
  const sortedProjects = snapshot.projects.slice().sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || b.id - a.id);
  await writePage("projects", projectsPage(sortedProjects, "Projects"));
  await writePage("project", projectsPage(sortedProjects, "Project"));
  await writePage("notes", notesPage(snapshot.notes, "Notes"));
  await writePage("course", notesPage(snapshot.notes, "Course"));
  const feedById = new Map(snapshot.feed.map((item) => [item.id, item]));
  const projectBySlug = new Map(snapshot.projects.map((item) => [item.slug, item]));
  const courseBySlug = new Map(snapshot.notes.map((item) => [item.slug, item]));
  const searchItems = allPosts.map((post) => {
    const feed = feedById.get(post.id);
    const project = projectBySlug.get(post.projectSlug);
    const course = courseBySlug.get(post.courseSlug);
    return { ...feed, ...post, title: post.section === "PROJECT_HOME" ? project.name : post.title,
      summary: post.section === "PROJECT_HOME" ? project.overview : feed?.summary ?? post.summary ?? "",
      category: post.category ?? feed?.category ?? null, tags: post.tags ?? feed?.tags ?? [],
      projectName: post.section === "PROJECT_DOC" ? project?.name : feed?.projectName,
      courseName: post.section === "NOTE_CHAPTER" ? course?.name : feed?.courseName,
      courseField: post.section === "NOTE_CHAPTER" ? course?.field : feed?.courseField,
      ...(post.section === "PROJECT_HOME" ? { status: project.status, startPeriod: project.startPeriod,
        endPeriod: project.endPeriod, stackBadges: project.stackBadges } : {}),
      searchBody: `${post.title} ${project?.name ?? ""} ${course?.name ?? ""} ${course?.field ?? ""} ${searchText(parsedPosts.get(post.id).html)}` };
  }).sort((a, b) => String(b.publishedDate).localeCompare(String(a.publishedDate)) || b.id - a.id);
  await writePage("search", listing("Search", searchItems, postPath, "Search"));
  for (const post of snapshot.posts) {
    const series = post.series?.items?.slice().sort((a, b) => a.order - b.order) ?? [];
    const seriesNav = series.length ? `<nav class="series-nav" aria-label="시리즈 글 목록"><h2>시리즈 · ${esc(post.category?.name ?? "Tech")}<span>${series.findIndex((item) => item.id === post.id) + 1}/${series.length}</span></h2><ol>${series.map((item) => `<li><a href="${route(`post/${checkedSlug(item.slug)}/`)}"${item.id === post.id ? ' aria-current="page"' : ""}><span class="series-number">${esc(item.order)}</span><span>${esc(item.title)}</span></a></li>`).join("")}</ol></nav>` : "";
    await writePage(`post/${post.slug}`, article(post, await render(post.body), `<a href="${route("tech/")}">Tech</a>${post.category ? `<span>·</span><span>${esc(post.category.path ?? post.category.name)}</span>` : ""}`, backlinks(post), post.summary ?? post.title, "", seriesNav));
  }
  for (const project of snapshot.projects) {
    const detail = snapshot.projectDetails[project.slug];
    const docs = detail.documents?.filter((item) => snapshot.projectDocuments[project.slug]?.[item.slug]?.id === item.id && item.visibility !== "PRIVATE" && item.locked !== true)
      .map((item) => ({ href: route(`project/${project.slug}/docs/${checkedSlug(item.slug)}/`), slug: item.slug, title: item.title, order: item.order }))?.sort((a, b) => a.order - b.order) ?? [];
    const home = { ...detail.home, section: "PROJECT_HOME", projectSlug: project.slug, title: project.name };
    const relatedTech = unique([...snapshot.posts.filter((tech) => tech.relatedProject?.slug === project.slug), ...detail.relatedTech]
      .map((tech) => tech.slug)).map((slug) => {
        const tech = snapshot.posts.find((post) => post.slug === slug);
        return tech ? { href: route(`post/${checkedSlug(tech.slug)}/`), title: tech.title } : null;
      }).filter(Boolean);
    await writePage(`project/${project.slug}`, projectArticle(project, home, await render(home.body), docs, relatedTech, backlinks(home), true));
    for (const post of Object.values(snapshot.projectDocuments[project.slug] ?? {})) await writePage(`project/${project.slug}/docs/${post.slug}`, projectArticle(project, post, await render(post.body), docs, relatedTech, backlinks(post), false));
  }
  for (const course of snapshot.notes) {
    const detail = snapshot.courseDetails[course.slug];
    const chapters = (detail.chapters ?? []).filter((item) => snapshot.chapters[course.slug]?.[item.slug]?.id === item.id && item.visibility !== "PRIVATE" && item.locked !== true)
      .slice().sort((a, b) => a.position - b.position).map((item) => ({ href: route(`course/${course.slug}/chapters/${checkedSlug(item.slug)}/`), slug: item.slug, title: item.title, summary: item.summary, publishedDate: item.publishedDate }));
    await writePage(`course/${course.slug}`, courseArticle(course, null, null, chapters, ""));
    for (const post of Object.values(snapshot.chapters[course.slug] ?? {})) await writePage(`course/${course.slug}/chapters/${post.slug}`, courseArticle(course, post, await render(post.body), chapters, backlinks(post)));
  }
  await writeFile(join(out, "robots.txt"), "User-agent: *\nAllow: /ken-blog/\nSitemap: https://gjaku1031.github.io/ken-blog/sitemap.xml\n");
  const pages = ["", "tech/", "projects/", "notes/", "search/", ...snapshot.posts.map((post) => `post/${post.slug}/`), ...snapshot.projects.map((project) => `project/${project.slug}/`), ...snapshot.notes.map((course) => `course/${course.slug}/`),
    ...snapshot.projects.flatMap((project) => Object.keys(snapshot.projectDocuments[project.slug] ?? {}).map((slug) => `project/${project.slug}/docs/${slug}/`)),
    ...snapshot.notes.flatMap((course) => Object.keys(snapshot.chapters[course.slug] ?? {}).map((slug) => `course/${course.slug}/chapters/${slug}/`))];
  await writeFile(join(out, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${pages.map((path) => `<url><loc>https://gjaku1031.github.io${route(path)}</loc></url>`).join("")}</urlset>`);
  await writeFile(join(out, "routes.json"), JSON.stringify(pages));
  await writeFile(join(out, "404.html"), page("페이지 없음", `<main id="main-content" class="page-container not-found-page"><div class="not-found-content"><span class="not-found-code mono">404</span><h1>페이지를 찾을 수 없습니다.</h1><p>요청한 페이지가 없거나 주소가 변경되었습니다.</p><div class="not-found-actions"><a class="primary-button" href="${route()}">홈으로</a><a class="not-found-secondary" href="${route("projects/")}">프로젝트 목록</a></div></div></main>`));
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
