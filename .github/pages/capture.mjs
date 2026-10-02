const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const revisionPattern = /^[a-f0-9]{64}$/;
const snapshotPath = "/api/v1/pages/snapshot";

/** 공개 스냅샷 계약이 깨지면 부분 사이트를 생성하지 않도록 실패. */
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
const signedInteger = (value, context) => {
  requireValue(Number.isSafeInteger(value), context);
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

/** 인증 없이 단일 읽기 전용 JSON을 수집하고 MIME·크기·리다이렉션을 검증. */
async function readSnapshot(base) {
  const url = new URL(snapshotPath, base);
  requireValue(url.origin === base.origin, "snapshot origin");
  const response = await fetch(url, {
    method: "GET", headers: { Accept: "application/json" }, credentials: "omit", redirect: "error",
    signal: AbortSignal.timeout(30_000), cache: "no-store",
  });
  if (!response.ok) throw new Error(`Public snapshot failed: HTTP ${response.status}`);
  requireValue(response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() === "application/json", "snapshot MIME");
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
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, length)));
  } catch { throw new Error("Public snapshot returned invalid JSON"); }
}

/** 공통 글·시리즈 필드만 선별해 정적 생성기에 전달한다. */
export function normalizeSnapshot(raw, fixture = false) {
  object(raw, "snapshot");
  requireValue(raw.version === 2 && (fixture || revisionPattern.test(raw.revision ?? "")), "snapshot version/revision");
  const navigation = row => ({ id: integer(row.id, "navigation id", 1), slug: slug(row.slug, "navigation slug"),
    title: string(row.title, "navigation title"), order: integer(row.order, "navigation order", 1) });
  const ref = row => row == null ? null : { id: integer(row.id, "series id", 1), slug: string(row.slug, "series slug"),
    name: string(row.name, "series name"), kind: row.kind };
  const posts = array(raw.posts, "posts").map(row => {
    requireValue(["TECH", "PROJECT"].includes(row.section) && (!row.visibility || row.visibility === "PUBLIC") && !row.locked,
      "public post");
    const category = row.category == null ? null : { id: integer(row.category.id, "category id", 1),
      path: string(row.category.path, "category path"), name: string(row.category.name, "category name"),
      depth: integer(row.category.depth, "category depth", 1) };
    const group = row.series == null ? null : { ...ref(row.series), items: array(row.series.items, "series items").map(navigation),
      position: integer(row.series.position, "position", 1) };
    return { id: integer(row.id, "post id", 1), slug: slug(row.slug, "post slug"), title: string(row.title, "post title"),
      publishedAt: string(row.publishedAt, "publication time"), summary: string(row.summary, "summary", true), publishedDate: string(row.publishedDate, "date"), section: row.section,
      category, tags: array(row.tags, "tags").map(tag => string(tag, "tag")), series: group,
      relatedSeries: ref(row.relatedSeries), legacyPath: nullableString(row.legacyPath, "legacy path"),
      body: fixture ? string(row.body ?? "", "fixture body", true) : "" };
  });
  const series = array(raw.series, "series").map(row => {
    requireValue(row.visibility === "PUBLIC" && ["TECH", "PROJECT"].includes(row.kind), "public series");
    return { ...ref(row), slug: slug(row.slug, "series slug"), visibility: "PUBLIC",
      description: string(row.description, "description", true), projectStatus: nullableString(row.projectStatus, "project status"),
      startPeriod: nullableString(row.startPeriod, "start period"), endPeriod: nullableString(row.endPeriod, "end period"),
      sortOrder: signedInteger(row.sortOrder, "series order"), cover: navigation(object(row.cover, "cover")),
      postCount: integer(row.postCount, "post count", 1), stackBadges: array(row.stackBadges, "stack badges").map(b => ({
        id: integer(b.id, "badge id", 1), name: string(b.name, "badge name"), imageUrl: string(b.imageUrl, "badge image") })) };
  });
  return { version: 2, revision: raw.revision, posts, series };
}

export async function capture(base) { return normalizeSnapshot(await readSnapshot(base)); }

/** 생성 중 변경된 스냅샷이 섞인 사이트의 공개를 막는다. */
export async function confirmRevision(base, expected) {
  requireValue(revisionPattern.test(expected ?? ""), "expected revision");
  const current = object(await readSnapshot(base), "final snapshot");
  requireValue(current.version === 2 && revisionPattern.test(current.revision ?? ""), "final revision");
  if (current.revision !== expected) throw new Error("공개 메타데이터 또는 이미지가 생성 중 변경되었습니다. Pages 빌드를 다시 실행하세요.");
}
