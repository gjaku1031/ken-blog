import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const root = new URL("../", import.meta.url);
const snapshotPath = join(root.pathname, ".generated/public-content.json");
const routesPath = join(root.pathname, ".generated/public-routes.json");
const versionPath = join(root.pathname, "public/content-version.json");
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const empty = () => ({ version: 1, profile: null, feed: [], projects: [], notes: [], posts: [],
  projectDetails: {}, projectDocuments: {}, courseDetails: {}, chapters: {} });

/** 출간 대상의 최소 주소 목록만 클라이언트 라우팅 파일로 분리. */
function routesOf(snapshot) {
  const keys = (value) => Object.keys(value).sort();
  return { version: 1, posts: snapshot.posts.map((post) => post.slug).sort(),
    projects: keys(snapshot.projectDetails),
    projectDocuments: Object.fromEntries(keys(snapshot.projectDocuments).map((slug) =>
      [slug, keys(snapshot.projectDocuments[slug])])),
    courses: keys(snapshot.courseDetails),
    chapters: Object.fromEntries(keys(snapshot.chapters).map((slug) => [slug, keys(snapshot.chapters[slug])])) };
}

/** 조회수·생성 시각이 없는 공개 원문만 SHA-256 지문으로 비교. */
function fingerprint(snapshot) {
  return `sha256-${createHash("sha256").update(JSON.stringify(snapshot)).digest("hex")}`;
}

/** JSON을 생성 중간 파일에 쓴 뒤 교체해 동시 읽기의 부분 파일을 막음. */
async function saveJson(path, value, ifMissing = false) {
  await mkdir(dirname(path), { recursive: true });
  if (ifMissing) {
    try { await readFile(path); return; } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

/** 공개 API 응답 계약이 깨지면 부분 스냅샷으로 조용히 배포하지 않도록 실패. */
function requireValue(condition, context) {
  if (!condition) throw new Error(`Invalid public API response: ${context}`);
}
const object = (value, context) => {
  requireValue(value !== null && typeof value === "object" && !Array.isArray(value), context);
  return value;
};
const string = (value, context, allowEmpty = false) => {
  requireValue(typeof value === "string" && (allowEmpty || value.length > 0), context);
  return value;
};
const nullableString = (value, context) => value == null ? null : string(value, context, true);
const integer = (value, context, minimum = 0) => {
  requireValue(Number.isSafeInteger(value) && value >= minimum, context);
  return value;
};
const slug = (value, context) => {
  string(value, context);
  requireValue(value.length <= 160 && slugPattern.test(value), context);
  return value;
};
const array = (value, context) => {
  requireValue(Array.isArray(value), context);
  return value;
};

/** 쿠키·인증 헤더 없이 정해진 공개 GET만 호출하고 오류·과도한 본문을 거부. */
async function apiGet(base, path) {
  requireValue(path.startsWith("/api/v1/") && !path.includes("/admin/"), "public endpoint");
  const response = await fetch(new URL(path, base), {
    method: "GET", headers: { Accept: "application/json" }, credentials: "omit", redirect: "error",
    signal: AbortSignal.timeout(20_000), cache: "no-store",
  });
  if (!response.ok) throw new Error(`Public API GET ${path.split("?")[0]} failed: HTTP ${response.status}`);
  const text = await response.text();
  requireValue(text.length <= 8_000_000, "response size");
  try { return JSON.parse(text); } catch { throw new Error(`Public API returned invalid JSON: ${path.split("?")[0]}`); }
}

/** 페이지 번호·합계·중복을 검증해 공개 목록의 모든 페이지를 수집. */
async function pages(base, prefix, size) {
  const items = [];
  const seen = new Set();
  let totalPages = 1;
  let totalElements = 0;
  for (let page = 0; page < totalPages; page += 1) {
    requireValue(page < 10_000, `${prefix} page limit`);
    const separator = prefix.includes("?") ? "&" : "?";
    const response = object(await apiGet(base, `${prefix}${separator}page=${page}&size=${size}`), prefix);
    requireValue(response.page === page && response.size === size, `${prefix} page`);
    integer(response.totalPages, `${prefix} totalPages`);
    integer(response.totalElements, `${prefix} totalElements`);
    if (page === 0) { totalPages = response.totalPages; totalElements = response.totalElements; }
    requireValue(response.totalPages === totalPages && response.totalElements === totalElements,
      `${prefix} changed during capture`);
    for (const item of array(response.items, `${prefix} items`)) {
      const id = integer(object(item, `${prefix} item`).id, `${prefix} item id`, 1);
      requireValue(!seen.has(id), `${prefix} duplicate item`);
      seen.add(id); items.push(item);
    }
  }
  requireValue(items.length === totalElements, `${prefix} incomplete pages`);
  return items;
}

/** 공개 목록 필드만 저장하며 열람 집계는 스냅샷 변화에서 제외. */
function feedItem(raw) {
  const item = object(raw, "feed item");
  const section = string(item.section, "feed section");
  requireValue(["TECH", "PROJECT_HOME", "PROJECT_DOC", "NOTE_CHAPTER"].includes(section), "feed section");
  requireValue(item.visibility === "PUBLIC", "feed visibility");
  const category = item.category == null ? null : object(item.category, "feed category");
  return { id: integer(item.id, "feed id", 1), title: string(item.title, "feed title"),
    slug: slug(item.slug, "feed slug"), section,
    projectSlug: item.projectSlug == null ? null : slug(item.projectSlug, "feed project slug"),
    courseSlug: item.courseSlug == null ? null : slug(item.courseSlug, "feed course slug"),
    summary: nullableString(item.summary, "feed summary"), publishedDate: string(item.publishedDate, "feed date"),
    visibility: "PUBLIC", category: category && { id: integer(category.id, "category id", 1),
      path: string(category.path, "category path"), name: string(category.name, "category name"),
      depth: integer(category.depth, "category depth", 1) },
    tags: array(item.tags, "feed tags").map((tag) => string(tag, "feed tag")),
    projectName: nullableString(item.projectName, "feed project name"),
    courseName: nullableString(item.courseName, "feed course name"),
    courseField: nullableString(item.courseField, "feed course field"),
    chapterPosition: item.chapterPosition == null ? null : integer(item.chapterPosition, "chapter position"),
    chapterTotal: item.chapterTotal == null ? null : integer(item.chapterTotal, "chapter total"),
    seriesPosition: item.seriesPosition == null ? null : integer(item.seriesPosition, "series position"),
    seriesTotal: item.seriesTotal == null ? null : integer(item.seriesTotal, "series total"),
    pinOrder: item.pinOrder == null ? null : integer(item.pinOrder, "pin order"), viewCount: null };
}

/** 공개 상세의 본문과 표시 필드만 저장하고 잠금·내부 해시는 배제. */
function postDetail(raw, section, parentSlug = null) {
  const item = object(raw, "post detail");
  requireValue(item.locked === false && typeof item.body === "string", "post must be readable");
  requireValue(item.section === section, "post section");
  const postSlug = slug(item.slug, "post slug");
  const projectSlug = section.startsWith("PROJECT") ? slug(item.projectSlug, "post project slug") : null;
  const courseSlug = section === "NOTE_CHAPTER" ? slug(item.courseSlug, "post course slug") : null;
  if (parentSlug) requireValue((projectSlug ?? courseSlug) === parentSlug, "post parent");
  const category = item.category == null ? null : object(item.category, "post category");
  const related = item.relatedProject == null ? null : object(item.relatedProject, "related project");
  const series = item.series == null ? null : object(item.series, "series");
  return { id: integer(item.id, "post id", 1), title: string(item.title, "post title"), slug: postSlug,
    publishedDate: string(item.publishedDate, "post date"), section, projectSlug, courseSlug,
    category: category && { id: integer(category.id, "category id", 1), path: string(category.path, "category path"),
      name: string(category.name, "category name"), depth: integer(category.depth, "category depth", 1) },
    tags: array(item.tags, "post tags").map((tag) => string(tag, "post tag")),
    summary: nullableString(item.summary, "post summary"), chapterOrder: item.chapterOrder == null ? null : integer(item.chapterOrder, "chapter order"),
    pinned: item.pinOrder != null, locked: false, body: item.body,
    documentOrder: item.documentOrder == null ? null : integer(item.documentOrder, "document order", 1),
    relatedProject: related && { id: integer(related.id, "related project id", 1),
      slug: slug(related.slug, "related project slug"), name: string(related.name, "related project name") },
    series: series && { items: array(series.items, "series items").map((entry) => {
      const row = object(entry, "series item");
      return { id: integer(row.id, "series id", 1), slug: slug(row.slug, "series slug"),
        title: string(row.title, "series title"), order: integer(row.order, "series order", 1) };
    }), position: integer(series.position, "series position", 1) },
    viewCount: null, pinOrder: item.pinOrder == null ? null : integer(item.pinOrder, "post pin order") };
}

/** 공개 프로젝트 카드의 사용자 표시 필드만 남김. */
function projectSummary(raw, fallbackCounts = null) {
  const item = object(raw, "project");
  requireValue(item.visibility === "PUBLIC", "project visibility");
  requireValue(["PLAN", "DEV", "MAINT", "DONE"].includes(item.status), "project status");
  return { id: integer(item.id, "project id", 1), slug: slug(item.slug, "project slug"),
    name: string(item.name, "project name"), status: item.status,
    startPeriod: nullableString(item.startPeriod, "start period"), endPeriod: nullableString(item.endPeriod, "end period"),
    overview: string(item.overview, "overview", true), visibility: "PUBLIC",
    documentCount: integer(item.documentCount ?? fallbackCounts?.documentCount, "document count"),
    relatedTechCount: integer(item.relatedTechCount ?? fallbackCounts?.relatedTechCount, "related count"),
    stackBadges: array(item.stackBadges, "stack badges").map((badge) => {
      const row = object(badge, "stack badge");
      return { id: integer(row.id, "badge id", 1), name: string(row.name, "badge name"),
        imageUrl: string(row.imageUrl, "badge image"),
        projectCount: row.projectCount == null ? null : integer(row.projectCount, "badge project count") };
    }) };
}

/** 공개 과목·회차의 목록 계약을 별도로 검사. */
function courseSummary(raw) {
  const item = object(raw, "course");
  requireValue(["IN_PROGRESS", "COMPLETED"].includes(item.status), "course status");
  return { id: integer(item.id, "course id", 1), slug: slug(item.slug, "course slug"),
    field: string(item.field, "course field"), name: string(item.name, "course name"),
    description: string(item.description, "course description", true), status: item.status,
    chapterCount: integer(item.chapterCount, "chapter count"),
    latestPublishedDate: nullableString(item.latestPublishedDate, "latest date") };
}

/** 공개 회차 탐색 필드를 검사하고 잠금 참조를 저장하지 않음. */
function chapterSummary(raw) {
  const item = object(raw, "chapter");
  requireValue(item.visibility === "PUBLIC" && item.locked === false, "chapter visibility");
  return { id: integer(item.id, "chapter id", 1), slug: slug(item.slug, "chapter slug"),
    title: string(item.title, "chapter title"), position: integer(item.position, "chapter position", 1),
    publishedDate: string(item.publishedDate, "chapter date"), visibility: "PUBLIC", locked: false,
    summary: nullableString(item.summary, "chapter summary") };
}

/** 익명 공개 상세를 모두 캡처하고 부모·목록·본문의 공개 범위를 교차 확인. */
async function capture(base) {
  const snapshot = empty();
  const profile = object(await apiGet(base, "/api/v1/profile"), "profile");
  snapshot.profile = { name: string(profile.name, "profile name"), tagline: string(profile.tagline, "profile tagline", true),
    intro: string(profile.intro, "profile intro", true), github: string(profile.github, "profile github", true),
    email: string(profile.email ?? "", "profile email", true), photoUrl: nullableString(profile.photoUrl, "profile photo") };

  const feedRows = (await pages(base, "/api/v1/feed?section=all&sort=new", 100))
    .filter((row) => object(row, "feed row").visibility === "PUBLIC").map(feedItem);
  const postRows = (await pages(base, "/api/v1/posts", 100))
    .filter((row) => object(row, "post row").section === "TECH");
  for (const row of postRows) {
    const postSlug = slug(row.slug, "TECH slug");
    const detail = postDetail(await apiGet(base, `/api/v1/posts/${postSlug}`), "TECH");
    requireValue(detail.id === row.id && detail.slug === postSlug, "TECH detail identity");
    snapshot.posts.push(detail);
  }

  const projectRows = (await pages(base, "/api/v1/projects", 100))
    .filter((row) => object(row, "project row").visibility === "PUBLIC");
  for (const row of projectRows) {
    const summary = projectSummary(row);
    const raw = object(await apiGet(base, `/api/v1/projects/${summary.slug}`), "project detail");
    requireValue(raw.locked === false, "project must be public");
    const info = projectSummary(raw.project, summary);
    requireValue(info.id === summary.id && info.slug === summary.slug, "project detail identity");
    const home = object(raw.home, "project home");
    const documents = [];
    const documentBodies = {};
    for (const entry of array(raw.documents, "project documents")) {
      const doc = object(entry, "project document");
      if (doc.visibility !== "PUBLIC" || doc.locked !== false) continue;
      const docSlug = slug(doc.slug, "document slug");
      const detail = postDetail(await apiGet(base, `/api/v1/posts/${docSlug}`), "PROJECT_DOC", summary.slug);
      requireValue(detail.id === doc.id, "document identity");
      documents.push({ id: detail.id, title: string(doc.title, "document title"), slug: docSlug,
        order: integer(doc.order, "document order", 1), publishedDate: string(doc.publishedDate, "document date"),
        visibility: "PUBLIC", locked: false });
      documentBodies[docSlug] = detail;
    }
    snapshot.projects.push(summary);
    snapshot.projectDocuments[summary.slug] = documentBodies;
    snapshot.projectDetails[summary.slug] = { locked: false,
      project: { ...info, homePostId: integer(home.id, "home id", 1) },
      home: { id: integer(home.id, "home id", 1), title: string(home.title, "home title"),
        slug: slug(home.slug, "home slug"), body: string(home.body, "home body", true),
        publishedDate: string(home.publishedDate, "home date") },
      documents, relatedTech: array(raw.relatedTech, "related Tech").map((tech) => ({
        id: integer(tech.id, "related Tech id", 1), title: string(tech.title, "related Tech title"),
        slug: slug(tech.slug, "related Tech slug"), publishedDate: string(tech.publishedDate, "related Tech date") })),
      relatedTechCount: integer(raw.relatedTechCount, "related Tech count") };
  }

  const noteList = object(await apiGet(base, "/api/v1/notes"), "notes list");
  for (const entry of array(noteList.items, "notes items")) {
    const summary = courseSummary(entry);
    const raw = object(await apiGet(base, `/api/v1/notes/${summary.slug}`), "course detail");
    const course = courseSummary(raw.course);
    requireValue(course.id === summary.id && course.slug === summary.slug, "course detail identity");
    const chapters = [];
    const chapterBodies = {};
    for (const entry of array(raw.chapters, "course chapters")) {
      const item = object(entry, "course chapter");
      if (item.visibility !== "PUBLIC" || item.locked !== false) continue;
      const chapter = chapterSummary(item);
      const response = object(await apiGet(base,
        `/api/v1/notes/${summary.slug}/chapters/${chapter.slug}`), "chapter detail");
      const detail = postDetail(response.chapter, "NOTE_CHAPTER", summary.slug);
      requireValue(detail.id === chapter.id, "chapter identity");
      chapters.push(chapter); chapterBodies[chapter.slug] = detail;
    }
    snapshot.notes.push(summary);
    snapshot.courseDetails[summary.slug] = { course, chapters };
    snapshot.chapters[summary.slug] = chapterBodies;
  }

  const publicIds = new Set([...snapshot.posts.map((post) => post.id),
    ...Object.values(snapshot.projectDocuments).flatMap((docs) => Object.values(docs).map((post) => post.id)),
    ...Object.values(snapshot.chapters).flatMap((docs) => Object.values(docs).map((post) => post.id))]);
  const publicProjects = new Set(snapshot.projects.map((project) => project.slug));
  const publicCourses = new Set(snapshot.notes.map((course) => course.slug));
  const projectsBySlug = new Map(snapshot.projects.map((project) => [project.slug, project]));
  const techById = new Map(snapshot.posts.map((post) => [post.id, post]));
  const postsById = new Map([...snapshot.posts,
    ...Object.values(snapshot.projectDocuments).flatMap((docs) => Object.values(docs)),
    ...Object.values(snapshot.chapters).flatMap((docs) => Object.values(docs))].map((post) => [post.id, post]));
  const cleanPost = (post) => {
    if (post.relatedProject) {
      const project = projectsBySlug.get(post.relatedProject.slug);
      post.relatedProject = project?.id === post.relatedProject.id ?
        { id: project.id, slug: project.slug, name: project.name } : null;
    }
    if (post.series) {
      const items = post.series.items.flatMap((item) => {
        const published = postsById.get(item.id);
        return published?.slug === item.slug ? [{ id: published.id, slug: published.slug,
          title: published.title, order: item.order }] : [];
      });
      const position = items.findIndex((item) => item.id === post.id) + 1;
      post.series = items.length > 1 && position > 0 ? { items, position } : null;
    }
  };
  snapshot.posts.forEach(cleanPost);
  for (const documents of Object.values(snapshot.projectDocuments)) Object.values(documents).forEach(cleanPost);
  for (const chapters of Object.values(snapshot.chapters)) Object.values(chapters).forEach(cleanPost);
  for (const detail of Object.values(snapshot.projectDetails)) {
    detail.relatedTech = detail.relatedTech.flatMap((post) => {
      const tech = techById.get(post.id);
      return tech?.slug === post.slug ? [{ id: tech.id, title: tech.title, slug: tech.slug,
        publishedDate: tech.publishedDate }] : [];
    });
  }
  snapshot.feed = feedRows.filter((item) => item.section === "TECH" ? publicIds.has(item.id) :
    item.section === "NOTE_CHAPTER" ? publicCourses.has(item.courseSlug) && publicIds.has(item.id) :
    item.section === "PROJECT_DOC" ? publicProjects.has(item.projectSlug) && publicIds.has(item.id) :
    publicProjects.has(item.projectSlug));
  for (const item of snapshot.feed) {
    if (item.section === "TECH" && item.projectSlug && !publicProjects.has(item.projectSlug)) {
      item.projectSlug = null; item.projectName = null;
    } else if (item.section === "TECH" && item.projectSlug) {
      item.projectName = projectsBySlug.get(item.projectSlug).name;
    }
  }
  return snapshot;
}

/** 공개 API 주소는 루트 기반 HTTP(S)만 허용하고 인증 정보·경로를 거부. */
function apiBase() {
  const raw = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();
  if (!raw) return null;
  const url = new URL(raw);
  requireValue(["http:", "https:"].includes(url.protocol) && !url.username && !url.password &&
    url.pathname === "/" && !url.search && !url.hash, "API base URL");
  return url;
}

/** Pages에 이미 출간한 지문만 조회해 내용이 같으면 재빌드를 건너뛸 수 있게 함. */
async function remoteFingerprint() {
  const source = process.env.PUBLIC_CONTENT_VERSION_URL?.trim() ||
    "https://gjaku1031.github.io/ken-blog/content-version.json";
  const url = new URL(source);
  requireValue(url.protocol === "https:" && !url.username && !url.password, "version URL");
  const response = await fetch(url, { method: "GET", redirect: "error", credentials: "omit",
    cache: "no-store", signal: AbortSignal.timeout(15_000) });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Published content version failed: HTTP ${response.status}`);
  const value = object(await response.json(), "published version");
  requireValue(value.version === 1 && /^sha256-[a-f0-9]{64}$/.test(value.fingerprint), "published version");
  return value.fingerprint;
}

/** 명령별로 생성 파일·검증 지문을 관리하고 출력은 자동화용 JSON 한 줄로 제한. */
async function main() {
  const mode = process.argv[2] ?? "--capture";
  requireValue(["--init", "--capture", "--check", "--verify", "--clean"].includes(mode), "script option");
  if (mode === "--clean") {
    let cleanedReservedRoutes = 0;
    for (const route of ["post", "project", "course"]) {
      const directory = join(root.pathname, "out", route, "_empty");
      try {
        await readdir(directory);
        await rm(directory, { recursive: true, force: true });
        cleanedReservedRoutes += 1;
      } catch (error) { if (error.code !== "ENOENT") throw error; }
    }
    process.stdout.write(`${JSON.stringify({ cleanedReservedRoutes })}\n`);
    return;
  }
  if (mode === "--init") {
    const snapshot = empty();
    await saveJson(snapshotPath, snapshot, true);
    await saveJson(routesPath, routesOf(snapshot), true);
    await saveJson(versionPath, { version: 1, fingerprint: fingerprint(snapshot) }, true);
    return;
  }
  if (mode === "--capture" && process.env.PUBLIC_CONTENT_REUSE_SNAPSHOT === "1") {
    const snapshot = object(JSON.parse(await readFile(snapshotPath, "utf8")), "saved snapshot");
    requireValue(snapshot.version === 1, "saved snapshot version");
    await saveJson(routesPath, routesOf(snapshot));
    await saveJson(versionPath, { version: 1, fingerprint: fingerprint(snapshot) });
    process.stdout.write(`${JSON.stringify({ changed: true, fingerprint: fingerprint(snapshot),
      routeCount: Object.keys(snapshot.projectDetails).length + snapshot.posts.length +
        Object.values(snapshot.projectDocuments).reduce((count, docs) => count + Object.keys(docs).length, 0) +
        Object.keys(snapshot.courseDetails).length +
        Object.values(snapshot.chapters).reduce((count, docs) => count + Object.keys(docs).length, 0) })}\n`);
    return;
  }
  const base = apiBase();
  const snapshot = base ? await capture(base) : empty();
  const digest = fingerprint(snapshot);
  if (mode === "--verify") {
    const previous = object(JSON.parse(await readFile(snapshotPath, "utf8")), "saved snapshot");
    if (fingerprint(previous) !== digest) throw new Error("Public content changed after capture");
  } else {
    await saveJson(snapshotPath, snapshot);
    const routes = routesOf(snapshot);
    await saveJson(routesPath, routes);
    await saveJson(versionPath, { version: 1, fingerprint: digest });
    const published = mode === "--check" ? await remoteFingerprint() : null;
    const routeCount = routes.posts.length + routes.projects.length + routes.courses.length +
      Object.values(routes.projectDocuments).reduce((count, docs) => count + docs.length, 0) +
      Object.values(routes.chapters).reduce((count, docs) => count + docs.length, 0);
    process.stdout.write(`${JSON.stringify({ changed: mode === "--check" ? published !== digest : true,
      fingerprint: digest, routeCount })}\n`);
  }
}

main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
