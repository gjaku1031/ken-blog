import { ApiFailure } from "./api";

/** 권한별 과목 목록에 필요한 소개와 회차 수. */
export type CourseSummary = { id: number; slug: string; field: string; name: string; description: string;
  status: "IN_PROGRESS" | "COMPLETED"; chapterCount: number; latestPublishedDate: string | null };
/** 과목 안에서 현재 역할로 볼 수 있는 회차. */
export type ChapterSummary = { id: number; slug: string; title: string; position: number; publishedDate: string;
  visibility: "PUBLIC" | "PRIVATE"; locked: boolean };
/** 과목 소개와 사이드바를 채우는 공개 상세. */
export type CourseDetail = { course: CourseSummary; chapters: ChapterSummary[] };

/** JSON 객체인지 확인해 잘못된 응답을 빈 목록과 구별한다. */
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ApiFailure("response");
  return value as Record<string, unknown>;
}

/** {@link CourseSummary}의 식별자와 표시 필드를 검증한다. */
export function parseCourseSummary(value: unknown): CourseSummary {
  const item = record(value);
  if (!Number.isSafeInteger(item.id) || (item.id as number) < 1 ||
    typeof item.slug !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.slug) ||
    typeof item.field !== "string" || typeof item.name !== "string" ||
    typeof item.description !== "string" ||
    (item.status !== "IN_PROGRESS" && item.status !== "COMPLETED") ||
    (item.chapterCount !== undefined && (!Number.isSafeInteger(item.chapterCount) || (item.chapterCount as number) < 0)) ||
    (item.latestPublishedDate != null && typeof item.latestPublishedDate !== "string")) throw new ApiFailure("response");
  return { id: item.id as number, slug: item.slug, field: item.field, name: item.name,
    description: item.description, status: item.status, chapterCount: item.chapterCount as number ?? 0,
    latestPublishedDate: item.latestPublishedDate as string | null ?? null };
}

/** {@link CourseSummary} 페이지를 관리자 선택기와 공개 목록에서 공통으로 읽는다. */
export function parseCoursePage(value: unknown): { items: CourseSummary[]; totalPages: number } {
  const item = record(value);
  if (!Array.isArray(item.items)) throw new ApiFailure("response");
  return { items: item.items.map(parseCourseSummary), totalPages: typeof item.totalPages === "number" ? item.totalPages : 1 };
}

/** {@link ChapterSummary} 목록의 공개 메타데이터만 확인한다. */
export function parseChapterSummary(value: unknown): ChapterSummary {
  const item = record(value);
  if (!Number.isSafeInteger(item.id) || (item.id as number) < 1 || typeof item.slug !== "string" ||
    typeof item.title !== "string" || !Number.isSafeInteger(item.position) || (item.position as number) < 1 ||
    typeof item.publishedDate !== "string" ||
    (item.visibility !== "PUBLIC" && item.visibility !== "PRIVATE") || typeof item.locked !== "boolean")
    throw new ApiFailure("response");
  return { id: item.id as number, slug: item.slug, title: item.title, position: item.position as number,
    publishedDate: item.publishedDate, visibility: item.visibility, locked: item.locked };
}

/** {@link CourseDetail}에 속한 회차를 권한별 응답 그대로 유지한다. */
export function parseCourseDetail(value: unknown): CourseDetail {
  const item = record(value);
  if (!Array.isArray(item.chapters)) throw new ApiFailure("response");
  return { course: parseCourseSummary(item.course), chapters: item.chapters.map(parseChapterSummary) };
}
