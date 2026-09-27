import { ApiFailure, apiJson, postDestination, type CategoryRef, type PostDestination } from "./api";

/** 홈·Tech·검색에서 공통으로 표시하는 본문 없는 출간 글. */
export type FeedItem = PostDestination & { id: number; title: string; summary: string | null; publishedDate: string;
  visibility: "PUBLIC" | "PRIVATE"; category: CategoryRef | null; tags: string[];
  chapterPosition: number | null; chapterTotal: number | null; seriesPosition: number | null;
  seriesTotal: number | null; pinOrder: number | null; viewCount: number | null };
/** 필터와 권한이 반영된 목록 한 페이지. */
export type FeedPage = { items: FeedItem[]; page: number; size: number; totalElements: number; totalPages: number };
/** KST 날짜별 출간 건수. */
export type Activity = { items: Array<{ date: string; count: number }>; postCount: number; activeDays: number };

/** JSON 객체와 숫자 필드의 타입을 검증한다. */
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ApiFailure("response");
  return value as Record<string, unknown>;
}

/** {@link postDestination}에 전달할 섹션 소속과 공개 카드 필드를 확인한다. */
export function parseFeedItem(value: unknown): FeedItem {
  const item = record(value);
  if (!Number.isSafeInteger(item.id) || (item.id as number) < 1 || typeof item.title !== "string" ||
    typeof item.slug !== "string" || typeof item.publishedDate !== "string" ||
    (item.summary != null && typeof item.summary !== "string") ||
    (item.visibility !== "PUBLIC" && item.visibility !== "PRIVATE") ||
    (item.section !== "TECH" && item.section !== "NOTE_CHAPTER" &&
      item.section !== "PROJECT_HOME" && item.section !== "PROJECT_DOC") ||
    !Array.isArray(item.tags) || !item.tags.every((tag) => typeof tag === "string")) throw new ApiFailure("response");
  const route: PostDestination = { slug: item.slug, section: item.section,
    projectSlug: item.projectSlug as string | null ?? null, courseSlug: item.courseSlug as string | null ?? null };
  postDestination(route);
  let category: CategoryRef | null = null;
  if (item.category != null) {
    const ref = record(item.category);
    if (!Number.isSafeInteger(ref.id) || typeof ref.path !== "string" || typeof ref.name !== "string" ||
      !Number.isSafeInteger(ref.depth)) throw new ApiFailure("response");
    category = { id: ref.id as number, path: ref.path, name: ref.name, depth: ref.depth as number };
  }
  const numberOrNull = (name: string): number | null => item[name] == null ? null :
    Number.isSafeInteger(item[name]) && (item[name] as number) >= 0 ? item[name] as number : null;
  return { id: item.id as number, title: item.title, ...route, summary: item.summary as string | null ?? null,
    publishedDate: item.publishedDate, visibility: item.visibility, category, tags: item.tags as string[],
    chapterPosition: numberOrNull("chapterPosition"), chapterTotal: numberOrNull("chapterTotal"),
    seriesPosition: numberOrNull("seriesPosition"), seriesTotal: numberOrNull("seriesTotal"),
    pinOrder: numberOrNull("pinOrder"), viewCount: numberOrNull("viewCount") };
}

/** 목록 페이지의 실제 총건수와 행을 검사한다. */
export function parseFeedPage(value: unknown): FeedPage {
  const item = record(value);
  if (!Array.isArray(item.items) || ![item.page, item.size, item.totalElements, item.totalPages].every((number) =>
    Number.isSafeInteger(number) && (number as number) >= 0)) throw new ApiFailure("response");
  return { items: item.items.map(parseFeedItem), page: item.page as number, size: item.size as number,
    totalElements: item.totalElements as number, totalPages: item.totalPages as number };
}

/** 전체 페이지의 핀 ID를 실제 순서대로 읽어 목록 일부만 변경하는 오류를 막는다. */
export async function readPinnedIds(credentials: RequestCredentials): Promise<number[]> {
  const ids: number[] = [];
  let page = 0; let totalPages = 1;
  do {
    const result = parseFeedPage(await apiJson<unknown>(`/api/v1/feed?section=all&sort=pin&page=${page}&size=100`, credentials));
    ids.push(...result.items.map((item) => item.id));
    totalPages = result.totalPages; page += 1;
  } while (page < totalPages);
  return ids;
}

/** 잔디 API의 날짜와 건수를 확인한다. */
export function parseActivity(value: unknown): Activity {
  const item = record(value);
  if (!Array.isArray(item.items) || !Number.isSafeInteger(item.postCount) || !Number.isSafeInteger(item.activeDays))
    throw new ApiFailure("response");
  return { items: item.items.map((entry) => { const row = record(entry);
    if (typeof row.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(row.date) ||
      !Number.isSafeInteger(row.count) || (row.count as number) < 0) throw new ApiFailure("response");
    return { date: row.date, count: row.count as number }; }), postCount: item.postCount as number,
    activeDays: item.activeDays as number };
}
