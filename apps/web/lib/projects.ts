import { ApiFailure } from "./api";
import { parseStackBadges, type StackBadge } from "./stack-badges";

/** 프로젝트 상태와 읽기 가능한 카드의 최소 정보. */
export type ProjectStatus = "PLAN" | "DEV" | "MAINT" | "DONE";
export type ProjectSummary = { id: number; slug: string; name: string; status: ProjectStatus;
  startPeriod: string | null; endPeriod: string | null; overview: string; visibility: "PUBLIC" | "PRIVATE";
  documentCount: number; relatedTechCount: number; stackBadges: StackBadge[] };
/** 역할별 프로젝트 목록 페이지. */
export type ProjectPage = { items: ProjectSummary[]; page: number; size: number; totalElements: number; totalPages: number };
/** 관리자 순서 편집에 필요한 본문·배지 없는 프로젝트 행. */
export type ProjectOrderItem = { id: number; name: string; slug: string; visibility: "PUBLIC" | "PRIVATE" };
/** 관리자 선택기에 필요한 본문 없는 프로젝트 행. */
export type AdminProject = Omit<ProjectSummary, "documentCount" | "relatedTechCount"> & {
  homePostId: number; updatedAt: string };
/** 프로젝트 본문 없이 사이드바에 표시되는 출간 문서. */
export type ProjectDocument = { id: number; title: string; slug: string; order: number; publishedDate: string;
  visibility: "PUBLIC" | "PRIVATE"; locked: boolean };
/** 읽을 수 있는 관련 Tech 글의 본문 없는 참조. */
export type RelatedTech = { id: number; title: string; slug: string; publishedDate: string };
/** 공개 프로젝트와 잠금 응답은 서로 다른 필드로 구별한다. */
export type ProjectDetail = { locked: true; project: { name: string; slug: string } } |
  { locked: false; project: Omit<ProjectSummary, "documentCount" | "relatedTechCount"> & { homePostId?: number;
    updatedAt?: string }; home: { id: number; title: string; slug: string; body: string; publishedDate: string };
    documents: ProjectDocument[]; relatedTech: RelatedTech[]; relatedTechCount: number };

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** 정적 URL과 API 응답에 공통인 ASCII 슬러그 계약을 검사한다. */
export function validProjectSlug(value: string): boolean { return value.length > 0 && value.length <= 160 && slugPattern.test(value); }

/** 런타임 JSON 객체인지 확인한다. */
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ApiFailure("response");
  return value as Record<string, unknown>;
}

/** 응답의 정수 필드는 정밀도를 잃지 않고 양수/0으로 좁힌다. */
function number(value: unknown, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) throw new ApiFailure("response");
  return value as number;
}

/** 짧은 제목·주소 문자열을 검사한다. */
function identity(value: unknown): { id: number; title: string; slug: string } {
  const item = record(value);
  if (typeof item.title !== "string" || !item.title || typeof item.slug !== "string" || !validProjectSlug(item.slug))
    throw new ApiFailure("response");
  return { id: number(item.id, 1), title: item.title, slug: item.slug };
}

/** 상태와 기간 표시값을 서버 계약에 맞게 검증한다. */
function metadata(value: unknown): Omit<ProjectSummary, "documentCount" | "relatedTechCount"> {
  const item = record(value);
  if (typeof item.name !== "string" || !item.name || typeof item.slug !== "string" || !validProjectSlug(item.slug) ||
    !["PLAN", "DEV", "MAINT", "DONE"].includes(String(item.status)) ||
    (item.startPeriod !== null && typeof item.startPeriod !== "string") ||
    (item.endPeriod !== null && typeof item.endPeriod !== "string") ||
    typeof item.overview !== "string" || (item.visibility !== "PUBLIC" && item.visibility !== "PRIVATE"))
    throw new ApiFailure("response");
  return { id: number(item.id, 1), slug: item.slug, name: item.name, status: item.status as ProjectStatus,
    startPeriod: item.startPeriod, endPeriod: item.endPeriod, overview: item.overview, visibility: item.visibility,
    stackBadges: parseStackBadges(item.stackBadges ?? []) };
}

/** 목록 카드의 권한별 문서/Tech 건수를 검증한다. */
function summary(value: unknown): ProjectSummary {
  const item = record(value);
  return { ...metadata(item), documentCount: number(item.documentCount), relatedTechCount: number(item.relatedTechCount) };
}

/** 서버 페이지를 빈 성공과 잘못된 응답으로 구별한다. */
export function parseProjectPage(value: unknown, expectedPage: number): ProjectPage {
  const item = record(value);
  if (!Array.isArray(item.items) || item.page !== expectedPage) throw new ApiFailure("response");
  return { items: item.items.map(summary), page: expectedPage, size: number(item.size, 1),
    totalElements: number(item.totalElements), totalPages: number(item.totalPages) };
}

/** 전체 프로젝트 순서 응답의 식별자 중복과 표시 필드를 검증한다. {@link ProjectOrderItem} */
export function parseProjectOrder(value: unknown): ProjectOrderItem[] {
  const response = record(value);
  if (!Array.isArray(response.items)) throw new ApiFailure("response");
  const seen = new Set<number>();
  return response.items.map((entry): ProjectOrderItem => {
    const item = record(entry);
    const id = number(item.id, 1);
    if (seen.has(id) || typeof item.name !== "string" || !item.name ||
      typeof item.slug !== "string" || !validProjectSlug(item.slug) ||
      (item.visibility !== "PUBLIC" && item.visibility !== "PRIVATE")) throw new ApiFailure("response");
    seen.add(id);
    return { id, name: item.name, slug: item.slug, visibility: item.visibility };
  });
}

/** 관리자 프로젝트 목록·상세의 메타데이터만 검증한다. */
export function parseAdminProject(value: unknown): AdminProject {
  const item = record(value);
  if (typeof item.updatedAt !== "string") throw new ApiFailure("response");
  return { ...metadata(item), homePostId: number(item.homePostId, 1), updatedAt: item.updatedAt };
}

/** 프로젝트 선택용 관리자 페이지는 페이지 번호와 행 수를 확인한다. */
export function parseAdminProjectPage(value: unknown, expectedPage: number): {
  items: AdminProject[]; page: number; totalPages: number;
} {
  const item = record(value);
  if (!Array.isArray(item.items) || item.page !== expectedPage) throw new ApiFailure("response");
  return { items: item.items.map(parseAdminProject), page: expectedPage, totalPages: number(item.totalPages) };
}

/** 읽을 수 있는 관련 Tech 참조만 간소화한다. */
export function parseRelatedTech(value: unknown): RelatedTech {
  const item = record(value);
  const ref = identity(item);
  if (typeof item.publishedDate !== "string") throw new ApiFailure("response");
  return { ...ref, publishedDate: item.publishedDate };
}

/** 프로젝트 관련 Tech의 한 페이지를 본문 없는 목록으로 확인한다. */
export function parseRelatedTechPage(value: unknown, expectedPage: number): {
  items: RelatedTech[]; page: number; totalPages: number;
} {
  const item = record(value);
  if (!Array.isArray(item.items) || item.items.length > 5 || item.page !== expectedPage || item.size !== 5)
    throw new ApiFailure("response");
  return { items: item.items.map(parseRelatedTech), page: expectedPage, totalPages: number(item.totalPages) };
}

/** 잠금 응답에서 의도적으로 본문·목록을 읽지 않는다. */
export function parseProjectDetail(value: unknown): ProjectDetail {
  const item = record(value);
  const project = record(item.project);
  if (item.locked === true) {
    if (typeof project.name !== "string" || typeof project.slug !== "string" || !validProjectSlug(project.slug))
      throw new ApiFailure("response");
    return { locked: true, project: { name: project.name, slug: project.slug } };
  }
  if (item.locked !== false || !Array.isArray(item.documents) || !Array.isArray(item.relatedTech))
    throw new ApiFailure("response");
  const home = record(item.home);
  const homeIdentity = identity(home);
  if (typeof home.body !== "string" || typeof home.publishedDate !== "string") throw new ApiFailure("response");
  const projectMeta = metadata(project);
  const documents = item.documents.map((entry): ProjectDocument => {
    const data = record(entry);
    const ref = identity(data);
    if (typeof data.publishedDate !== "string" || typeof data.locked !== "boolean" ||
      (data.visibility !== "PUBLIC" && data.visibility !== "PRIVATE")) throw new ApiFailure("response");
    return { ...ref, order: number(data.order, 1), publishedDate: data.publishedDate,
      visibility: data.visibility, locked: data.locked };
  });
  return { locked: false, project: { ...projectMeta,
    homePostId: project.homePostId === undefined ? undefined : number(project.homePostId, 1),
    updatedAt: typeof project.updatedAt === "string" ? project.updatedAt : undefined },
    home: { ...homeIdentity, body: home.body, publishedDate: home.publishedDate }, documents,
    relatedTech: item.relatedTech.map(parseRelatedTech), relatedTechCount: number(item.relatedTechCount) };
}

/** 디자인에 고정된 네 상태 라벨. */
export function projectStatusLabel(status: ProjectStatus): string {
  return { PLAN: "기획 중", DEV: "개발 중", MAINT: "유지보수 중", DONE: "완료" }[status];
}

/** 시작·종료 기간의 한쪽 값만 있어도 자연스럽게 표시한다. */
export function formatProjectPeriod(start: string | null, end: string | null, status: ProjectStatus): string {
  if (!start && !end) return "";
  if (!start) return end ?? "";
  if (!end) return status === "DONE" ? start : `${start} – 현재`;
  return start === end ? start : `${start} – ${end}`;
}
