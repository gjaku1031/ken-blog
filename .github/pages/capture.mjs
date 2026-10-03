import { expandPublicSnapshot } from '../../src/main/resources/web/shared/deployment-status.ts';
import { isSlug } from '../../src/main/resources/web/shared/site-path.ts';

/**
 * 스냅샷 SHA-256 형식
 */
const revisionPattern = /^[a-f0-9]{64}$/;

/**
 * 공개 스냅샷 API 경로
 */
const snapshotPath = "/api/v1/pages/snapshot";

/**
 * 공개 스냅샷 계약이 깨지면 부분 사이트를 생성하지 않도록 실패
 */
function requireValue(condition, context) {
  if (!condition) throw new Error(`Invalid public API response: ${context}`);
}

/**
 * 입력이 객체인지 검사
 */
const object = (value, context) => {
  requireValue(value !== null && typeof value === "object" && !Array.isArray(value), context);
  return value;
};

/**
 * 문자열 타입과 빈 값 허용 여부 검사
 */
const string = (value, context, allowEmpty = false) => {
  requireValue(typeof value === "string" && (allowEmpty || value.length > 0), context);
  return value;
};

/**
 * null을 허용하는 문자열 검사
 */
const nullableString = (value, context) => value == null ? null : string(value, context, true);

/**
 * 안전 정수와 최솟값 검사
 */
const integer = (value, context, minimum = 0) => {
  requireValue(Number.isSafeInteger(value) && value >= minimum, context);
  return value;
};

/**
 * 부호 있는 안전 정수 검사
 */
const signedInteger = (value, context) => {
  requireValue(Number.isSafeInteger(value), context);
  return value;
};

/**
 * 공개 주소 식별자 형식 검사
 */
const slug = (value, context) => {
  string(value, context);
  requireValue(isSlug(value), context);
  return value;
};

/**
 * 배열 입력 검사
 */
const array = (value, context) => {
  requireValue(Array.isArray(value), context);
  return value;
};

/**
 * 인증 없이 단일 읽기 전용 JSON을 수집하고 MIME·크기·리다이렉션을 검증
 *
 * 1. 동일 origin의 공개 스냅샷을 쿠키 없이 요청
 * 2. MIME·예고 크기·실제 수신량 검사
 * 3. 완성된 바이트를 엄격한 UTF-8과 JSON으로 해석
 */
async function readSnapshot(base) {
  // 동일 origin의 공개 스냅샷을 쿠키 없이 요청
  const url = new URL(snapshotPath, base);
  requireValue(url.origin === base.origin, "snapshot origin");
  const response = await fetch(url, {
    method: "GET", headers: { Accept: "application/json" }, credentials: "omit", redirect: "error",
    signal: AbortSignal.timeout(30_000), cache: "no-store",
  });
  if (!response.ok) throw new Error(`Public snapshot failed: HTTP ${response.status}`);
  requireValue(response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() === "application/json", "snapshot MIME");
  // MIME·예고 크기·실제 수신량 검사
  const limit = 8_000_000;
  const announced = Number(response.headers.get("content-length"));
  requireValue(Number.isFinite(announced) && announced <= limit && response.body, "snapshot size");
  const chunks = [];
  let length = 0;
  for await (const chunk of response.body) {
    length += chunk.byteLength;
    requireValue(length <= limit, "snapshot size");
    chunks.push(chunk);
  }
  try {
    // 완성된 바이트를 엄격한 UTF-8과 JSON으로 해석
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, length)));
  } catch { throw new Error("Public snapshot returned invalid JSON"); }
}

/**
 * 공통 글·시리즈 필드만 선별해 정적 생성기에 전달함
 *
 * 1. 스냅샷 형태·버전·revision 검사
 * 2. 공개 글의 필드·분류·탐색 정보를 검증해 선별
 * 3. 공개 시리즈와 대문·기술 이미지 필드 검증
 */
export function normalizeSnapshot(raw, fixture = false) {
  raw = expandPublicSnapshot(raw);
  // 스냅샷 형태·버전·revision 검사
  object(raw, "snapshot");
  requireValue(raw.version === 2 && (fixture || revisionPattern.test(raw.revision ?? "")), "snapshot version/revision");

  /**
   * 검증한 문서 이동 정보 생성
   */
  const navigation = row => ({ id: integer(row.id, "navigation id", 1), slug: slug(row.slug, "navigation slug"),
    title: string(row.title, "navigation title"), order: integer(row.order, "navigation order", 1) });

  /**
   * 선택 시리즈 참조의 필드 검사
   */
  const ref = row => row == null ? null : { id: integer(row.id, "series id", 1), slug: string(row.slug, "series slug"),
    name: string(row.name, "series name"), kind: row.kind };
  // 공개 글의 필드·분류·탐색 정보를 검증해 선별
  const posts = array(raw.posts, "posts").map(row => {
    requireValue(["TECH", "PROJECT"].includes(row.section) && (!row.visibility || row.visibility === "PUBLIC") && !row.locked,
      "public post");
    const category = row.category == null ? null : { id: integer(row.category.id, "category id", 1),
      path: string(row.category.path, "category path"), name: string(row.category.name, "category name"),
      depth: integer(row.category.depth, "category depth", 1), sortOrder: signedInteger(row.category.sortOrder ?? 0, "category order") };
    const group = row.series == null ? null : { ...ref(row.series), items: array(row.series.items, "series items").map(navigation),
      position: integer(row.series.position, "position", 1) };
    return { id: integer(row.id, "post id", 1), slug: slug(row.slug, "post slug"), title: string(row.title, "post title"),
      publishedAt: string(row.publishedAt, "publication time"), summary: string(row.summary, "summary", true), publishedDate: string(row.publishedDate, "date"), section: row.section,
      category, tags: array(row.tags, "tags").map(tag => string(tag, "tag")), series: group,
      relatedSeries: ref(row.relatedSeries), legacyPath: nullableString(row.legacyPath, "legacy path"),
      body: fixture ? string(row.body ?? "", "fixture body", true) : "" };
  });
  // 공개 시리즈와 대문·기술 이미지 필드 검증
  const series = array(raw.series, "series").map(row => {
    requireValue(row.visibility === "PUBLIC" && ["TECH", "PROJECT"].includes(row.kind), "public series");
    return { ...ref(row), slug: slug(row.slug, "series slug"), visibility: "PUBLIC",
      description: string(row.description, "description", true), projectStatus: nullableString(row.projectStatus, "project status"),
      startPeriod: nullableString(row.startPeriod, "start period"), endPeriod: nullableString(row.endPeriod, "end period"),
      sortOrder: signedInteger(row.sortOrder, "series order"), cover: navigation(object(row.cover, "cover")),
      postCount: integer(row.postCount, "post count", 1), stackBadges: array(row.stackBadges, "stack badges").map(b => ({
        id: integer(b.id, "badge id", 1), name: string(b.name, "badge name"), imageUrl: string(b.imageUrl, "badge image") })) };
  });
  // 구 API의 v2 응답은 기존 경로 표시로 호환, 새 응답은 공개 글의 부모까지 보존
  const publicPaths = new Set(posts.flatMap(post => post.category ? [post.category.path, post.category.path.split('/')[0]] : []));
  const categories = array(raw.categories ?? [], "categories").map(row => {
    requireValue(publicPaths.has(row.path), "public category");
    return { id: integer(row.id, "category id", 1), path: string(row.path, "category path"),
      name: string(row.name, "category name"), depth: integer(row.depth, "category depth", 1),
      sortOrder: signedInteger(row.sortOrder, "category order") };
  });
  return { version: 2, revision: raw.revision, posts, series, categories };
}

/**
 * 공개 스냅샷 수집 후 정적 생성 입력으로 정규화
 */
export async function capture(base) { return normalizeSnapshot(await readSnapshot(base)); }

/**
 * 생성 중 변경된 스냅샷이 섞인 사이트의 공개를 막음
 */
export async function confirmRevision(base, expected) {
  requireValue(revisionPattern.test(expected ?? ""), "expected revision");
  const current = object(await readSnapshot(base), "final snapshot");
  requireValue([2, 3].includes(current.version) && revisionPattern.test(current.revision ?? ""), "final revision");
  if (current.revision !== expected) throw new Error("공개 메타데이터 또는 이미지가 생성 중 변경되었습니다. Pages 빌드를 다시 실행하세요.");
}
