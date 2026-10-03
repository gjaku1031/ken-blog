import { build as bundle } from "esbuild";
import { capture, confirmRevision, normalizeSnapshot } from "./capture.mjs";
import { buildWebAssets } from "../../src/main/resources/web/build.mjs";
import { readFile, writeFile, mkdir, rm, cp, readdir, stat, rename, open } from "node:fs/promises";
import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { generateSite } from "../../src/main/resources/web/site/generate.ts";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * 저장소 루트
 */
const root = resolve(import.meta.dirname, "../..");

/**
 * 배포 전 임시 사이트 디렉터리
 */
const staging = join(root, "build/site-staging");

/**
 * 완성 사이트 출력 디렉터리
 */
const output = join(root, "build/site");

/**
 * 사이트 기준 경로
 */
const basePath = "/ken-blog/";

/**
 * 공개 주소 식별자 패턴
 */
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * 사이트 기준 경로 결합
 */
const route = (path = "") => `${basePath}${path}`;

/**
 * 공개 주소 식별자의 타입·길이·형식 검사
 */
const checkedSlug = (value) => { if (typeof value !== "string" || value.length > 160 || !slugPattern.test(value)) throw new Error("공개 slug 형식 오류"); return value; };

/**
 * 검증된 글 주소 생성
 */
const postPath = post => route(`post/${checkedSlug(post.slug)}/`);

/**
 * 위키 제목의 대소문자 비교 키 생성
 */
const wikiKey = (title) => title.toLocaleLowerCase("und");

/**
 * 공개 API의 같은 출처만 이미지 다운로드 원본으로 허용함
 */
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

/**
 * API의 명시된 공개 이미지 주소만 받아 외부 리다이렉션과 경로 변경을 막음
 */
function imagePath(value, base, expected) {
  if (!base) throw new Error("공개 이미지를 받으려면 PUBLIC_API_BASE_URL이 필요합니다.");
  const url = new URL(value, base);
  const version = url.search ? /^\?v=[0-9TZ:.-]+$/.test(url.search) : true;
  if (url.origin !== base.origin || url.pathname !== expected || !version || url.hash || value.includes("%") || value.includes("..") || value.includes("\\"))
    throw new Error(`공개 이미지 주소 오류: ${expected}`);
  return url;
}

/**
 * 이미지 크기·MIME·매직 바이트를 검사한 뒤 내용 해시 이름으로 저장함
 *
 * 1. 쿠키 없이 공개 이미지 요청
 * 2. 실제 수신 바이트 상한 검사
 * 3. MIME과 파일 시그니처 대조
 * 4. 내용 해시를 포함한 파일명으로 저장
 */
async function download(url, name) {
  // 쿠키 없이 공개 이미지 요청
  const response = await fetch(url, { headers: { Accept: "image/png,image/jpeg" }, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(25_000) });
  if (!response.ok) throw new Error(`공개 이미지 HTTP ${response.status}: ${url.pathname}`);
  const type = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  const limit = 10 * 1024 * 1024;
  if (Number(response.headers.get("content-length")) > limit || !response.body) throw new Error("공개 이미지 크기 오류");
  // 실제 수신 바이트 상한 검사
  const chunks = [];
  let length = 0;
  for await (const chunk of response.body) {
    length += chunk.byteLength;
    if (length > limit) { await response.body.cancel().catch(() => undefined); throw new Error("공개 이미지 크기 오류"); }
    chunks.push(chunk);
  }
  const bytes = new Uint8Array(Buffer.concat(chunks, length));
  if (bytes.length < 8 || bytes.length > limit) throw new Error("공개 이미지 크기 오류");
  // MIME과 파일 시그니처 대조
  const png = type === "image/png" && [137, 80, 78, 71, 13, 10, 26, 10].every((part, index) => bytes[index] === part);
  const jpg = type === "image/jpeg" && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (!png && !jpg) throw new Error("공개 이미지 형식 오류");
  // 내용 해시를 포함한 파일명으로 저장
  const digest = createHash("sha256").update(bytes).digest("hex");
  const filename = `${name}-${digest}.${png ? "png" : "jpg"}`;
  await writeFile(join(staging, "assets", filename), bytes);
  return route(`assets/${filename}`);
}

/**
 * 캡처의 공개 목록·상세와 라우트 관계를 검사함
 *
 * 1. 글 ID·주소 중복 검사
 * 2. 시리즈 중복·대문·글 수·종류별 속성 검사
 * 3. 글별 시리즈 위치·순서·프로젝트 소속 대조
 */
function validate(snapshot, fixture) {
  snapshot = normalizeSnapshot(snapshot, fixture);
  // 글 ID·주소 중복 검사
  const ids = new Map(), slugs = new Set();
  for (const post of snapshot.posts) {
    if (ids.has(post.id) || slugs.has(post.slug)) throw new Error("공개 글 ID/slug 중복");
    ids.set(post.id, post); slugs.add(post.slug);
  }
  // 시리즈 중복·대문·글 수·종류별 속성 검사
  const seriesIds = new Set(), seriesSlugs = new Set();
  for (const group of snapshot.series) {
    if (seriesIds.has(group.id) || seriesSlugs.has(group.slug)) throw new Error("시리즈 중복");
    seriesIds.add(group.id); seriesSlugs.add(group.slug);
    const cover = ids.get(group.cover.id);
    if (!cover || cover.slug !== group.cover.slug || cover.series?.id !== group.id || cover.series?.slug !== group.slug ||
        cover.series?.items[0]?.id !== cover.id || cover.series.kind !== group.kind || cover.series.items.length !== group.postCount)
      throw new Error("시리즈 대문 불일치");
    if (group.kind !== "PROJECT" && (group.stackBadges.length || group.projectStatus || group.startPeriod || group.endPeriod))
      throw new Error("일반 시리즈에 프로젝트 속성 혼입");
  }
  for (const post of snapshot.posts) {
    // 글별 시리즈 위치·순서·프로젝트 소속 대조
    if (post.series) {
      const items = post.series.items;
      if (new Set(items.map(i => i.id)).size !== items.length || items[post.series.position - 1]?.id !== post.id ||
          items.some((item, index) => ids.get(item.id)?.slug !== item.slug || item.order !== index + 1))
        throw new Error("공개 시리즈 문서 불일치");
    }
    if (post.section === "PROJECT" && !snapshot.series.some(s => s.kind === "PROJECT" && s.id === post.series?.id && s.slug === post.series?.slug))
      throw new Error("프로젝트 시리즈 누락");
  }
  return snapshot;
}

/**
 * 생성된 Pages 트리에서 의도하지 않은 파일과 크기 초과를 거부함
 *
 * 1. 산출물 최상위 경로 허용 목록 검사
 * 2. 하위 파일의 개수·크기·링크·내부 파일 유출 검사
 */
async function checkArtifact() {
  // 산출물 최상위 경로 허용 목록 검사
  const allowed = new Set(["assets", "licenses", "index.html", "404.html", "robots.txt", "sitemap.xml", "routes.json", "deployment.json",
    "posts", "tech", "post", "projects", "project", "notes", "course", "series", "search", "manage"]);
  for (const name of await readdir(staging)) if (!allowed.has(name)) throw new Error(`허용되지 않은 Pages 산출물: ${name}`);
  let bytes = 0; let files = 0;
  // 하위 파일의 개수·크기·링크·내부 파일 유출 검사

  /**
   * 디렉터리를 순회하며 파일 내용과 경로 검사
   */
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
    }
  };
  await visit(staging);
}

/**
 * checkout 원본만 읽고 링크·과도한 파일·잘못된 UTF-8을 거부함
 *
 * 1. 링크를 따르지 않고 원고 열기, fixture만 누락 허용
 * 2. 일반 파일·크기 확인 후 읽기
 * 3. 실패 시에도 파일 핸들 해제
 */
async function markdownSource(file, fixture) {
  // 링크를 따르지 않고 원고 열기, fixture만 누락 허용
  let handle;
  try { handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch (error) {
    if (error.code === "ENOENT" && fixture) return null;
    if (error.code === "ENOENT") throw new Error(`공개 Markdown 원본 누락: ${file}`);
    throw error;
  }
  try {
    // 일반 파일·크기 확인 후 읽기
    const info = await handle.stat();
    if (!info.isFile() || info.size > 1_048_576) throw new Error(`공개 Markdown 파일 형식·크기 오류: ${file}`);
    const bytes = await handle.readFile();
    if (bytes.length > 1_048_576) throw new Error(`공개 Markdown 파일 크기 오류: ${file}`);
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  // 실패 시에도 파일 핸들 해제
  } finally { await handle.close(); }
}

/**
 * 캡처·저장소 Markdown·첨부를 검증하고 Node 템플릿으로 완성 페이지를 생성함
 *
 * 1. 빌드 입력을 fixture 또는 공개 API 스냅샷으로 선택
 * 2. 본문 첨부를 글 권한 경로로 내려받아 정적 주소 구성
 * 3. 프로젝트 기술 이미지는 ID별로 한 번만 수집
 * 4. 최초 출간 글을 위키 제목의 대표 주소로 선택
 * 5. 정적 문서를 생성하고 산출물 검사
 * 6. API 데이터 revision이 빌드 중 바뀌지 않았는지 재확인
 * 7. 검증 완료한 임시 산출물로 출력 디렉터리 교체
 */
async function main() {
  if (process.env.SITE_BASE_PATH && process.env.SITE_BASE_PATH !== "/ken-blog") throw new Error("SITE_BASE_PATH는 /ken-blog여야 합니다.");
  // 빌드 입력을 fixture 또는 공개 API 스냅샷으로 선택
  const fixtureArg = process.argv.find((arg) => arg === "--fixture" || arg.startsWith("--fixture=") || arg === "--empty");
  const fixture = !!fixtureArg;
  const base = apiBase();
  if (!fixture && !base) throw new Error("운영 빌드에는 PUBLIC_API_BASE_URL이 필요합니다.");
  let snapshot;
  if (["--fixture=empty", "--fixture", "--empty"].includes(fixtureArg))
    snapshot = { version: 2, posts: [], series: [] };
  else if (fixtureArg?.startsWith("--fixture=")) snapshot = JSON.parse(await readFile(resolve(fixtureArg.slice(10)), "utf8"));
  else snapshot = await capture(base);
  snapshot = validate(snapshot, fixture);
  await rm(staging, { recursive: true, force: true });
  const { public: assets, admin } = await buildWebAssets();
  await mkdir(join(staging, "assets"), { recursive: true });
  await cp(join(root, "build/public-assets"), join(staging, "assets"), { recursive: true });
  await cp(join(root, "build/admin-assets"), join(staging, "assets"), { recursive: true });
  await cp(join(root, "src/main/resources/web/public/licenses"), join(staging, "licenses"), { recursive: true });
  const rendererFile = join(root, "build/.site-markdown.mjs");
  await bundle({ entryPoints: [join(root, "src/main/resources/web/shared/markdown.ts")], outfile: rendererFile,
    bundle: true, packages: "external", platform: "node", format: "esm", target: "node24", logLevel: "silent" });
  const { renderMarkdown } = await import(pathToFileURL(rendererFile).href);
  const allPosts = snapshot.posts;
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
  // 본문 첨부를 글 권한 경로로 내려받아 정적 주소 구성
  const attachmentUrls = new Map();
  for (const id of [...owners.keys()].sort((a, b) => a - b)) {
    const postId = owners.get(id); const path = `/api/v1/posts/${postId}/attachments/${id}/content`;
    attachmentUrls.set(id, await download(imagePath(path, base, path), `attachment-${id}`));
  }
  // 프로젝트 기술 이미지는 ID별로 한 번만 수집
  const badges = new Map();
  for (const project of snapshot.series) for (const badge of project.stackBadges ?? []) if (!badges.has(badge.id)) badges.set(badge.id, badge);
  for (const badge of badges.values()) badge.imageUrl = await download(imagePath(badge.imageUrl, base, `/api/v1/stack-badges/${badge.id}/image`), `stack-${badge.id}`);
  for (const project of snapshot.series) for (const badge of project.stackBadges ?? []) badge.imageUrl = badges.get(badge.id).imageUrl;
  // 최초 출간 글을 위키 제목의 대표 주소로 선택
  const links = new Map();
  for (const post of [...allPosts].sort((a, b) => a.publishedAt.localeCompare(b.publishedAt) || a.id - b.id)) {
    const key = wikiKey(post.title); if (!links.has(key)) links.set(key, postPath(post));
  }
  for (const post of allPosts) {
    const rendered = await renderMarkdown(post.body, { attachmentUrl: (id) => attachmentUrls.get(id) ?? null,
      wikiUrl: (title) => links.get(wikiKey(title)) ?? null });
    post.rendered = { html: rendered.html, headings: rendered.headings, wikiTargets: rendered.wikiTargets };
  }
  // 정적 문서를 생성하고 산출물 검사
  await generateSite({ snapshot, assets, adminHref: route("manage/"),
    admin: { apiBase: base?.origin ?? "", css: route(`assets/${admin.css}`), js: route(`assets/${admin.js}`) } }, staging);
  await checkArtifact();
  // API 데이터 revision이 빌드 중 바뀌지 않았는지 재확인
  if (!fixture) {
    await confirmRevision(base, snapshot.revision);
    console.log(`공개 데이터 revision: ${snapshot.revision}`);
    if (process.env.GITHUB_STEP_SUMMARY) await writeFile(process.env.GITHUB_STEP_SUMMARY, `revision=${snapshot.revision}\n`, { flag: "a" });
  }
  // 검증 완료한 임시 산출물로 출력 디렉터리 교체
  await rm(output, { recursive: true, force: true });
  await rename(staging, output);
  console.log(`정적 Pages 생성 완료: ${output}`);
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
