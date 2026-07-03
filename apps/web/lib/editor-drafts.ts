import { ApiFailure, type CategoryNode, parseCategories, parseTags, type TagCount } from "./api";
import { validWikiTitle } from "./wiki-link-syntax";

/** 서버 편집본의 저장 가능한 필드와 낙관적 잠금 revision. */
export type DraftDetail = {
  id: number; revision: number; postId: number | null; baseUpdatedAt: string | null;
  title: string; slug: string; body: string; categoryId: number | null; tags: string[];
  visibility: "PUBLIC" | "PRIVATE"; createdAt: string; updatedAt: string; attachmentIds: number[]; wikiTargets: string[];
};
/** 목록 SQL이 본문 열을 읽지 않는 편집본 한 행. */
export type DraftSummary = Omit<DraftDetail, "body" | "attachmentIds" | "wikiTargets">;
/** 0기반 10개 단위 관리자 편집본 페이지. */
export type DraftPage = { items: DraftSummary[]; page: number; size: number; totalElements: number; totalPages: number };
/** 기존 공개 원문의 관리자 상세. */
export type AdminPost = { id: number; title: string; slug: string; body: string; updatedAt: string;
  status: "DRAFT" | "PUBLISHED"; visibility: "PUBLIC" | "PRIVATE";
  category: { id: number } | null; tags: string[]; attachmentIds: number[]; wikiTargets: string[] };
/** 전체 교체 저장과 신규 편집본 생성에서 공통으로 보내는 값. */
export type DraftValues = Pick<DraftDetail, "title" | "slug" | "body" | "categoryId" | "tags" | "visibility" | "attachmentIds" | "wikiTargets">;

/** DTO 검증에 사용할 JSON 객체 가드. */
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ApiFailure("response");
  return value as Record<string, unknown>;
}

/** 정수 정밀도를 잃으면 다른 원고를 선택하지 않도록 안전 정수만 수용한다. */
function integer(value: unknown, min = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < min) throw new ApiFailure("response");
  return value as number;
}

/** 서버 상세의 첨부 연결은 100개 이하의 중복 없는 양수 안전 정수 오름차순만 수용한다. */
function attachmentIds(value: unknown): number[] {
  if (!Array.isArray(value) || value.length > 100) throw new ApiFailure("response");
  const ids = value.map((entry) => integer(entry, 1));
  if (ids.some((id, index) => index > 0 && id <= ids[index - 1])) throw new ApiFailure("response");
  return ids;
}

/** 서버가 저장한 제목 참조는 중복 없는 최대 128개의 안전한 제목만 수용한다. */
function wikiTargets(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 128) throw new ApiFailure("response");
  const seen = new Set<string>();
  return value.map((entry) => {
    if (typeof entry !== "string" || validWikiTitle(entry) !== entry || seen.has(entry))
      throw new ApiFailure("response");
    seen.add(entry);
    return entry;
  });
}

/** 양수 ID 외의 정적 쿼리 값은 API로 보내지 않는다. */
export function positiveId(value: string | null): number | null {
  if (!value || !/^[1-9]\d*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/** 관리자 응답의 nullable ID·시각과 전체 저장 필드를 검사한다. */
function draftFields(value: unknown): DraftSummary {
  const item = record(value);
  const postId = item.postId === null ? null : integer(item.postId, 1);
  const categoryId = item.categoryId === null ? null : integer(item.categoryId, 1);
  if (typeof item.title !== "string" || typeof item.slug !== "string" ||
    !Array.isArray(item.tags) || !item.tags.every((tag) => typeof tag === "string") ||
    (item.visibility !== "PUBLIC" && item.visibility !== "PRIVATE") ||
    (item.baseUpdatedAt !== null && typeof item.baseUpdatedAt !== "string") ||
    typeof item.createdAt !== "string" || typeof item.updatedAt !== "string") throw new ApiFailure("response");
  return { id: integer(item.id, 1), revision: integer(item.revision), postId,
    baseUpdatedAt: item.baseUpdatedAt, title: item.title, slug: item.slug, categoryId,
    tags: item.tags, visibility: item.visibility, createdAt: item.createdAt, updatedAt: item.updatedAt };
}

/** 본문까지 포함한 저장·조회 응답을 확인한다. */
export function parseDraftDetail(value: unknown): DraftDetail {
  const fields = draftFields(value);
  const item = record(value);
  if (typeof item.body !== "string") throw new ApiFailure("response");
  return { ...fields, body: item.body, attachmentIds: attachmentIds(item.attachmentIds),
    wikiTargets: wikiTargets(item.wikiTargets) };
}

/** 본문 없는 관리자 페이지를 빈 데이터로 오해하지 않도록 검증한다. */
export function parseDraftPage(value: unknown): DraftPage {
  const item = record(value);
  if (!Array.isArray(item.items)) throw new ApiFailure("response");
  return { items: item.items.map(draftFields), page: integer(item.page), size: integer(item.size, 1),
    totalElements: integer(item.totalElements), totalPages: integer(item.totalPages) };
}

/** 기존 게시글을 편집본의 기반 시각과 함께 읽는다. */
export function parseAdminPost(value: unknown): AdminPost {
  const item = record(value);
  const category = item.category === null ? null : record(item.category);
  if (typeof item.title !== "string" || typeof item.slug !== "string" || typeof item.body !== "string" ||
    typeof item.updatedAt !== "string" || !Array.isArray(item.tags) ||
    !item.tags.every((tag) => typeof tag === "string") ||
    (item.status !== "DRAFT" && item.status !== "PUBLISHED") ||
    (item.visibility !== "PUBLIC" && item.visibility !== "PRIVATE")) throw new ApiFailure("response");
  return { id: integer(item.id, 1), title: item.title, slug: item.slug, body: item.body,
    updatedAt: item.updatedAt, status: item.status, visibility: item.visibility,
    category: category ? { id: integer(category.id, 1) } : null, tags: item.tags,
    attachmentIds: attachmentIds(item.attachmentIds), wikiTargets: wikiTargets(item.wikiTargets) };
}

/** 관리자 분류 트리의 전체 항목을 확인한다. */
export function parseAdminCategories(value: unknown): CategoryNode[] { return parseCategories(value); }
/** 관리자 태그의 실제 등록 건수 목록을 확인한다. */
export function parseAdminTags(value: unknown): TagCount[] { return parseTags(value); }

/** 저장되지 않은 현재 값을 편집본 API의 전필드 교체 계약으로 직렬화한다. */
export function draftValues(values: DraftValues): DraftValues {
  return { title: values.title, slug: values.slug, body: values.body, categoryId: values.categoryId,
    tags: [...values.tags], visibility: values.visibility, attachmentIds: [...values.attachmentIds],
    wikiTargets: [...values.wikiTargets] };
}
