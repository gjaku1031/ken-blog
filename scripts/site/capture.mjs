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
    seriesTotal: item.seriesTotal == null ? null : integer(item.seriesTotal, "series total") };
}

/** 공개 상세의 본문과 표시 필드만 저장하고 잠금·내부 해시는 배제. */
function postDetail(raw, section, parentSlug = null) {
  const item = object(raw, "post detail");
  requireValue(item.locked === false && item.body === "", "post must be readable");
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
    locked: false, body: item.body,
    documentOrder: item.documentOrder == null ? null : integer(item.documentOrder, "document order"),
    relatedProject: related && { id: integer(related.id, "related project id", 1),
      slug: slug(related.slug, "related project slug"), name: string(related.name, "related project name") },
    series: series && { items: array(series.items, "series items").map((entry) => {
      const row = object(entry, "series item");
      return { id: integer(row.id, "series id", 1), slug: slug(row.slug, "series slug"),
        title: string(row.title, "series title"), order: integer(row.order, "series order", 1) };
    }), position: integer(series.position, "series position", 1) } };
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
    sortOrder: item.sortOrder == null ? 0 : signedInteger(item.sortOrder, "project sort order"),
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

/** 단일 응답의 모든 공개 데이터와 부모·상세 계약을 검증한다. */
export async function capture(base) {
  const raw = object(await readSnapshot(base), "snapshot");
  requireValue(raw.version === 1 && revisionPattern.test(raw.revision ?? ""), "snapshot version/revision");
  const sourceProfile = object(raw.profile, "profile");
  const profile = { name: string(sourceProfile.name, "profile name", true),
    tagline: string(sourceProfile.tagline, "profile tagline", true),
    intro: string(sourceProfile.intro, "profile intro", true),
    github: string(sourceProfile.github, "profile github", true),
    email: string(sourceProfile.email ?? "", "profile email", true),
    photoUrl: nullableString(sourceProfile.photoUrl, "profile photo") };
  const feed = array(raw.feed, "feed").map(feedItem);
  const posts = array(raw.posts, "posts").map((row) => postDetail(row, "TECH"));
  const projects = array(raw.projects, "projects").map((row) => projectSummary(row));
  const notes = array(raw.notes, "notes").map(courseSummary);
  const sourceProjectDetails = object(raw.projectDetails, "project details");
  const sourceProjectDocuments = object(raw.projectDocuments, "project documents");
  const sourceCourseDetails = object(raw.courseDetails, "course details");
  const sourceChapters = object(raw.chapters, "chapters");
  const projectDetails = Object.create(null);
  const projectDocuments = Object.create(null);
  const courseDetails = Object.create(null);
  const chapters = Object.create(null);
  for (const project of projects) {
    const name = project.slug;
    const detail = object(sourceProjectDetails[name], `project detail ${name}`);
    requireValue(detail.locked === false, `project visibility ${name}`);
    const info = projectSummary(detail.project, project);
    requireValue(info.id === project.id && info.slug === name, `project identity ${name}`);
    const home = object(detail.home, `project home ${name}`);
    requireValue(home.body === "", `project home body ${name}`);
    const homeId = integer(home.id, `project home id ${name}`, 1);
    requireValue(integer(detail.project.homePostId, `project home reference ${name}`, 1) === homeId,
      `project home reference ${name}`);
    const documents = array(detail.documents, `project document list ${name}`).map((entry) => {
      const row = object(entry, `project document ${name}`);
      requireValue(row.visibility === "PUBLIC" && row.locked === false, `project document visibility ${name}`);
      return { id: integer(row.id, "document id", 1), title: string(row.title, "document title"),
        slug: slug(row.slug, "document slug"), order: integer(row.order, "document order"),
        publishedDate: string(row.publishedDate, "document date"), visibility: "PUBLIC", locked: false };
    });
    const rawDocuments = object(sourceProjectDocuments[name], `project documents ${name}`);
    const normalizedDocuments = Object.create(null);
    for (const [docSlug, row] of Object.entries(rawDocuments)) {
      slug(docSlug, "document key");
      const doc = postDetail(row, "PROJECT_DOC", name);
      requireValue(doc.slug === docSlug, `document key ${docSlug}`);
      normalizedDocuments[docSlug] = doc;
    }
    requireValue(documents.length === Object.keys(normalizedDocuments).length && documents.every((doc) =>
      normalizedDocuments[doc.slug]?.id === doc.id), `project document identities ${name}`);
    projectDetails[name] = { locked: false, project: { ...info, homePostId: homeId },
      home: { id: homeId, title: string(home.title, "home title"), slug: slug(home.slug, "home slug"),
        body: "", publishedDate: string(home.publishedDate, "home date") }, documents,
      relatedTech: array(detail.relatedTech, `related Tech ${name}`).map((row) => {
        const item = object(row, "related Tech");
        return { id: integer(item.id, "related Tech id", 1), title: string(item.title, "related Tech title"),
          slug: slug(item.slug, "related Tech slug"), publishedDate: string(item.publishedDate, "related Tech date") };
      }), relatedTechCount: integer(detail.relatedTechCount, `related Tech count ${name}`) };
    projectDocuments[name] = normalizedDocuments;
  }
  for (const course of notes) {
    const name = course.slug;
    const detail = object(sourceCourseDetails[name], `course detail ${name}`);
    const info = courseSummary(detail.course);
    requireValue(info.id === course.id && info.slug === name, `course identity ${name}`);
    const summaries = array(detail.chapters, `chapter list ${name}`).map(chapterSummary);
    const rawChapters = object(sourceChapters[name], `chapters ${name}`);
    const normalizedChapters = Object.create(null);
    for (const [chapterSlug, row] of Object.entries(rawChapters)) {
      slug(chapterSlug, "chapter key");
      const chapter = postDetail(row, "NOTE_CHAPTER", name);
      requireValue(chapter.slug === chapterSlug, `chapter key ${chapterSlug}`);
      normalizedChapters[chapterSlug] = chapter;
    }
    requireValue(summaries.length === Object.keys(normalizedChapters).length && summaries.every((item) =>
      normalizedChapters[item.slug]?.id === item.id), `chapter identities ${name}`);
    courseDetails[name] = { course: info, chapters: summaries };
    chapters[name] = normalizedChapters;
  }
  requireValue(Object.keys(sourceProjectDetails).length === projects.length &&
    Object.keys(sourceProjectDocuments).length === projects.length &&
    Object.keys(sourceCourseDetails).length === notes.length &&
    Object.keys(sourceChapters).length === notes.length, "unexpected parent details");
  return { version: 1, revision: raw.revision, profile, feed, posts, projects, notes,
    projectDetails, projectDocuments, courseDetails, chapters };
}

/** 생성 완료 직전에 다시 읽어 DB·이미지 revision 변경을 거부한다. */
export async function confirmRevision(base, expected) {
  requireValue(revisionPattern.test(expected ?? ""), "expected revision");
  const current = object(await readSnapshot(base), "final snapshot");
  requireValue(current.version === 1 && revisionPattern.test(current.revision ?? ""), "final revision");
  if (current.revision !== expected) throw new Error("공개 메타데이터 또는 이미지가 생성 중 변경되었습니다. Pages 빌드를 다시 실행하세요.");
}
