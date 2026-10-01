import { build as bundle } from "esbuild";
import { capture, confirmRevision } from "./capture.mjs";
import { buildWebAssets } from "../../src/main/resources/web/build.mjs";
import { readFile, writeFile, mkdir, rm, cp, readdir, stat, rename, open } from "node:fs/promises";
import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "../..");
const staging = join(root, "build/site-staging");
const output = join(root, "build/site");
const input = join(root, "build/site-input/rendered.json");
const basePath = "/ken-blog/";
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const route = (path = "") => `${basePath}${path}`;
const checkedSlug = (value) => { if (typeof value !== "string" || value.length > 160 || !slugPattern.test(value)) throw new Error("공개 slug 형식 오류"); return value; };
const postPath = (post) => post.section === "PROJECT_HOME" ? route(`project/${checkedSlug(post.projectSlug)}/`) :
  post.section === "PROJECT_DOC" ? route(`project/${checkedSlug(post.projectSlug)}/docs/${checkedSlug(post.slug)}/`) :
  post.section === "NOTE_CHAPTER" ? route(`course/${checkedSlug(post.courseSlug)}/chapters/${checkedSlug(post.slug)}/`) : route(`post/${checkedSlug(post.slug)}/`);
const wikiKey = (title) => title.toLocaleLowerCase("und");

/** 공개 API의 같은 출처만 이미지 다운로드 원본으로 허용한다. */
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

/** API의 명시된 공개 이미지 주소만 받아 외부 리다이렉션과 경로 변경을 막는다. */
function imagePath(value, base, expected) {
  if (!base) throw new Error("공개 이미지를 받으려면 PUBLIC_API_BASE_URL이 필요합니다.");
  const url = new URL(value, base);
  const version = url.search ? /^\?v=[0-9TZ:.-]+$/.test(url.search) : true;
  if (url.origin !== base.origin || url.pathname !== expected || !version || url.hash || value.includes("%") || value.includes("..") || value.includes("\\"))
    throw new Error(`공개 이미지 주소 오류: ${expected}`);
  return url;
}

/** 이미지 크기·MIME·매직 바이트를 검사한 뒤 내용 해시 이름으로 저장한다. */
async function download(url, name) {
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
  if (bytes.length < 8 || bytes.length > limit) throw new Error("공개 이미지 크기 오류");
  const png = type === "image/png" && [137, 80, 78, 71, 13, 10, 26, 10].every((part, index) => bytes[index] === part);
  const jpg = type === "image/jpeg" && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (!png && !jpg) throw new Error("공개 이미지 형식 오류");
  const digest = createHash("sha256").update(bytes).digest("hex");
  const filename = `${name}-${digest}.${png ? "png" : "jpg"}`;
  await writeFile(join(staging, "assets", filename), bytes);
  return route(`assets/${filename}`);
}

/** 캡처의 공개 목록·상세와 라우트 관계를 검사한다. */
function validate(snapshot) {
  if (!snapshot || snapshot.version !== 1 || !Array.isArray(snapshot.posts) || !Array.isArray(snapshot.projects) || !Array.isArray(snapshot.notes) ||
    !Array.isArray(snapshot.feed) || !snapshot.projectDetails || !snapshot.projectDocuments || !snapshot.courseDetails || !snapshot.chapters)
    throw new Error("공개 스냅샷 형식 오류");
  const ids = new Set(); const paths = new Set(); const routeToId = new Map();
  const post = (item, section) => {
    if (!item || !Number.isSafeInteger(item.id) || item.id <= 0 || typeof item.body !== "string" || item.locked !== false ||
      item.section !== section || typeof item.publishedDate !== "string" || (item.visibility && item.visibility !== "PUBLIC"))
      throw new Error("공개 글 상세 형식 오류");
    checkedSlug(item.slug);
    const path = postPath(item);
    if (ids.has(item.id) || paths.has(path)) throw new Error("공개 글 ID/경로 중복");
    ids.add(item.id); paths.add(path); routeToId.set(path, item.id);
  };
  snapshot.posts.forEach((item) => post(item, "TECH"));
  const projectSlugs = new Set();
  for (const item of snapshot.projects) {
    checkedSlug(item.slug);
    if (projectSlugs.has(item.slug) || item.visibility !== "PUBLIC" || (item.sortOrder != null && !Number.isSafeInteger(item.sortOrder)))
      throw new Error("프로젝트 경로 또는 공개 범위 오류");
    projectSlugs.add(item.slug);
    const detail = snapshot.projectDetails[item.slug];
    if (!detail || detail.locked !== false || !detail.home || typeof detail.home.body !== "string" ||
      !Number.isSafeInteger(detail.home.id) || detail.home.id <= 0 || typeof detail.home.publishedDate !== "string" ||
      detail.project?.id !== item.id || ids.has(detail.home.id))
      throw new Error("프로젝트 대문 형식 오류");
    ids.add(detail.home.id); paths.add(route(`project/${item.slug}/`)); routeToId.set(route(`project/${item.slug}/`), detail.home.id);
    if (!snapshot.projectDocuments[item.slug]) throw new Error("프로젝트 문서 누락");
    for (const [slug, doc] of Object.entries(snapshot.projectDocuments[item.slug])) {
      if (doc.slug !== slug || doc.projectSlug !== item.slug) throw new Error("프로젝트 문서 경로 오류");
      post(doc, "PROJECT_DOC");
    }
  }
  if (Object.keys(snapshot.projectDetails).some((slug) => !projectSlugs.has(slug)) || Object.keys(snapshot.projectDocuments).some((slug) => !projectSlugs.has(slug)))
    throw new Error("미공개 프로젝트 상세 혼입");
  const courseSlugs = new Set();
  for (const item of snapshot.notes) {
    checkedSlug(item.slug);
    if (courseSlugs.has(item.slug)) throw new Error("과목 경로 중복");
    courseSlugs.add(item.slug);
    const detail = snapshot.courseDetails[item.slug];
    if (!detail || detail.course?.id !== item.id || !snapshot.chapters[item.slug]) throw new Error("과목 상세 누락");
    for (const [slug, chapter] of Object.entries(snapshot.chapters[item.slug])) {
      if (chapter.slug !== slug || chapter.courseSlug !== item.slug) throw new Error("회차 경로 오류");
      post(chapter, "NOTE_CHAPTER");
    }
  }
  if (Object.keys(snapshot.courseDetails).some((slug) => !courseSlugs.has(slug)) || Object.keys(snapshot.chapters).some((slug) => !courseSlugs.has(slug)))
    throw new Error("미공개 과목 상세 혼입");
  if (snapshot.feed.some((item) => item.visibility !== "PUBLIC" || routeToId.get(postPath(item)) !== item.id))
    throw new Error("공개 목록과 상세 불일치");
  return snapshot;
}

/** 생성된 Pages 트리에서 의도하지 않은 파일과 크기 초과를 거부한다. */
async function checkArtifact() {
  const allowed = new Set(["assets", "licenses", "index.html", "404.html", "robots.txt", "sitemap.xml", "routes.json",
    "tech", "post", "projects", "project", "notes", "course", "search"]);
  for (const name of await readdir(staging)) if (!allowed.has(name)) throw new Error(`허용되지 않은 Pages 산출물: ${name}`);
  let bytes = 0; let files = 0;
  const visit = async (folder) => {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const filename = join(folder, entry.name);
      if (entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory())) throw new Error("Pages 산출물 링크/특수 파일 오류");
      if (entry.isDirectory()) { await visit(filename); continue; }
      if (++files > 20_000) throw new Error("Pages 파일 수 초과");
      bytes += (await stat(filename)).size;
      if (bytes > 900 * 1024 * 1024) throw new Error("Pages 산출물 크기 초과");
      if (entry.name.startsWith(".env") || /^(AGENTS\.md|pom\.xml|build\.gradle\.kts|settings\.gradle\.kts|gradlew(?:\.bat)?|gradle\.properties|package(?:-lock)?\.json)$/i.test(entry.name))
        throw new Error(`내부 파일이 Pages 산출물에 포함됨: ${entry.name}`);
      if (folder === join(staging, "assets") && /^admin(?:\.|-)/i.test(entry.name)) throw new Error("관리자 자산이 Pages에 포함됨");
    }
  };
  await visit(staging);
}

/** 실행 중인 JVM과 결과 코드를 그대로 전달한다. */
async function runGenerator(args) {
  const classpathFile = join(root, "build/site-runtime-classpath.txt");
  const classpath = process.env.SITE_JAVA_CLASSPATH || await readFile(classpathFile, "utf8").then((value) => value.trim()).catch(() => {
    throw new Error("Pages 생성기 클래스패스가 없습니다. ./gradlew -PskipWeb=true writeSiteClasspath를 먼저 실행하세요.");
  });
  if (!classpath) throw new Error("Pages 생성기 클래스패스가 비어 있습니다.");
  const child = spawn(process.env.JAVA_BINARY || "java", ["-cp", classpath, "io.github.gjaku1031.kenblog.site.SiteGeneratorKt", ...args], { cwd: root, stdio: "inherit" });
  const code = await new Promise((accept, reject) => { child.once("error", reject); child.once("close", accept); });
  if (code !== 0) throw new Error(`Kotlin Pages 생성 실패: ${code}`);
}

/** checkout 원본만 읽고 링크·과도한 파일·잘못된 UTF-8을 거부한다. */
async function markdownSource(file, fixture) {
  let handle;
  try { handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch (error) {
    if (error.code === "ENOENT" && fixture) return null;
    if (error.code === "ENOENT") throw new Error(`공개 Markdown 원본 누락: ${file}`);
    throw error;
  }
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > 1_048_576) throw new Error(`공개 Markdown 파일 형식·크기 오류: ${file}`);
    const bytes = await handle.readFile();
    if (bytes.length > 1_048_576) throw new Error(`공개 Markdown 파일 크기 오류: ${file}`);
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } finally { await handle.close(); }
}

/** 캡처·저장소 Markdown·첨부를 검증하고 Kotlin 템플릿 생성기에 넘긴다. */
async function main() {
  if (process.env.SITE_BASE_PATH && process.env.SITE_BASE_PATH !== "/ken-blog") throw new Error("SITE_BASE_PATH는 /ken-blog여야 합니다.");
  const fixtureArg = process.argv.find((arg) => arg === "--fixture" || arg.startsWith("--fixture=") || arg === "--empty");
  const fixture = !!fixtureArg;
  const base = apiBase();
  if (!fixture && !base) throw new Error("운영 빌드에는 PUBLIC_API_BASE_URL이 필요합니다.");
  let snapshot;
  if (["--fixture=empty", "--fixture", "--empty"].includes(fixtureArg))
    snapshot = { version: 1, profile: null, feed: [], projects: [], notes: [], posts: [], projectDetails: {}, projectDocuments: {}, courseDetails: {}, chapters: {} };
  else if (fixtureArg?.startsWith("--fixture=")) snapshot = JSON.parse(await readFile(resolve(fixtureArg.slice(10)), "utf8"));
  else snapshot = await capture(base);
  snapshot = validate(snapshot);
  await rm(staging, { recursive: true, force: true });
  const { public: assets } = await buildWebAssets({ adminAssets: false });
  await mkdir(join(staging, "assets"), { recursive: true });
  await cp(join(root, "build/public-assets"), join(staging, "assets"), { recursive: true });
  await cp(join(root, "src/main/resources/web/public/licenses"), join(staging, "licenses"), { recursive: true });
  const rendererFile = join(root, "build/.site-markdown.mjs");
  await bundle({ entryPoints: [join(root, "src/main/resources/web/shared/markdown.ts")], outfile: rendererFile,
    bundle: true, packages: "external", platform: "node", format: "esm", target: "node24", logLevel: "silent" });
  const { renderMarkdown } = await import(pathToFileURL(rendererFile).href);
  const allPosts = [...snapshot.posts, ...snapshot.projects.map((project) => {
    const home = snapshot.projectDetails[project.slug].home;
    home.section = "PROJECT_HOME"; home.projectSlug = project.slug; home.slug = checkedSlug(home.slug ?? project.slug);
    return home;
  }), ...Object.values(snapshot.projectDocuments).flatMap((docs) => Object.values(docs)),
  ...Object.values(snapshot.chapters).flatMap((docs) => Object.values(docs))];
  const contentArg = process.argv.find((arg) => arg.startsWith("--content-dir="));
  const contentDir = resolve(contentArg ? contentArg.slice("--content-dir=".length) : join(root, "content/posts"));
  const usedSlugs = new Set();
  for (const post of allPosts) {
    const postSlug = checkedSlug(post.slug);
    if (usedSlugs.has(postSlug)) throw new Error(`공개 Markdown slug 중복: ${postSlug}`);
    usedSlugs.add(postSlug);
    const file = join(contentDir, `${postSlug}.md`);
    post.body = await markdownSource(file, fixture) ?? post.body;
  }
  const owners = new Map();
  for (const post of allPosts) {
    const parsed = await renderMarkdown(post.body);
    for (const id of parsed.attachmentIds) owners.set(id, post.id);
  }
  const attachmentUrls = new Map();
  for (const id of [...owners.keys()].sort((a, b) => a - b)) {
    const postId = owners.get(id); const path = `/api/v1/posts/${postId}/attachments/${id}/content`;
    attachmentUrls.set(id, await download(imagePath(path, base, path), `attachment-${id}`));
  }
  if (snapshot.profile?.photoUrl) snapshot.profile.photoUrl = await download(imagePath(snapshot.profile.photoUrl, base, "/api/v1/profile/photo"), "profile");
  const badges = new Map();
  for (const project of snapshot.projects) for (const badge of project.stackBadges ?? []) if (!badges.has(badge.id)) badges.set(badge.id, badge);
  for (const badge of badges.values()) badge.imageUrl = await download(imagePath(badge.imageUrl, base, `/api/v1/stack-badges/${badge.id}/image`), `stack-${badge.id}`);
  for (const project of snapshot.projects) for (const badge of project.stackBadges ?? []) badge.imageUrl = badges.get(badge.id).imageUrl;
  const links = new Map(); const duplicateTitles = new Set();
  for (const post of allPosts) { const key = wikiKey(post.title); if (links.has(key)) duplicateTitles.add(key); else links.set(key, postPath(post)); }
  for (const key of duplicateTitles) links.delete(key);
  for (const post of allPosts) {
    const rendered = await renderMarkdown(post.body, { attachmentUrl: (id) => attachmentUrls.get(id) ?? null,
      wikiUrl: (title) => links.get(wikiKey(title)) ?? null, sourceMap: true });
    post.rendered = { html: rendered.html, headings: rendered.headings, wikiTargets: rendered.wikiTargets };
  }
  await mkdir(join(root, "build/site-input"), { recursive: true });
  await writeFile(input, JSON.stringify({ snapshot, assets, adminHref: base ? `${base.origin}/manage/` : "" }));
  await runGenerator([`--input=${input}`, `--output=${staging}`, ...(fixture ? ["--fixture"] : [])]);
  await checkArtifact();
  if (!fixture) await confirmRevision(base, snapshot.revision);
  await rm(output, { recursive: true, force: true });
  await rename(staging, output);
  console.log(`정적 Pages 생성 완료: ${output}`);
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
