/** Spring 공개 응답의 분류 참조. */
export type CategoryRef = { id: number; path: string; name: string; depth: number };

/** 현재 역할로 읽을 수 있는 분류별 글 수와 하위 구조. */
export type CategoryNode = CategoryRef & {
  directCount: number;
  totalCount: number;
  children: CategoryNode[];
};

/** 공개 피드의 본문 없는 게시글. */
export type PostSummary = {
  id: number;
  title: string;
  slug: string;
  publishedDate: string;
  category: CategoryRef | null;
  tags: string[];
};

/** 공개 피드 페이지와 전체 건수. */
export type PostPage = {
  items: PostSummary[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
};

/** 읽기 허용 시 원문, 익명 PRIVATE이면 잠금 메타데이터만 가진 상세. */
export type PostDetail = PostSummary & { locked: boolean; body: string | null };

/** 현재 역할에서 보이는 태그의 글 수. */
export type TagCount = { name: string; count: number };

/** 인증된 계정의 서버 세션 정보. */
export type CurrentUser = { username: string; role: "USER" | "ADMIN" };

/** 제목 조회 API의 권한별 최소 결과. 잠금과 없음에는 대상 정보가 없다. */
export type WikiLinkResult = { requestedTitle: string; status: "LOCKED" | "MISSING" } |
  { requestedTitle: string; status: "READABLE"; id: number; title: string; slug: string };

/** 본문 없이 제공되는 검색·역링크의 읽기 가능한 최소 글 정보. */
export type WikiTitleItem = { id: number; title: string; slug: string };
/** 관리자 제목 검색의 7개 결과와 입력 문자열의 정확한 해석. */
export type WikiTitleSearch = { items: WikiTitleItem[]; exact: WikiLinkResult };
/** 공개 역링크 한 페이지의 최소 정보. */
export type WikiBacklinkPage = { items: WikiTitleItem[]; page: number; hasMore: boolean };

/** 클라이언트가 표시할 안전한 요청 실패 분류. */
export class ApiFailure extends Error {
  /** 내부 URL·본문 없이 상태와 실패 종류만 보관한다. */
  constructor(public readonly kind: "config" | "network" | "timeout" | "response" | "http", public readonly status?: number) {
    super(kind);
    this.name = "ApiFailure";
  }
}

/** API 연결 실패를 사용자에게 보여 줄 고정 안내로 변환한다. */
export function apiFailureMessage(error: unknown): string {
  if (error instanceof ApiFailure) {
    if (error.kind === "config") return "공개 API 주소가 아직 올바르게 설정되지 않았습니다. 연결 후 글을 불러올 수 있습니다.";
    if (error.kind === "timeout") return "API 응답 시간이 초과되었습니다. 다시 시도해 주세요.";
    if (error.kind === "network") return "API에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.";
    if (error.status === 404) return "요청한 글을 찾을 수 없습니다.";
    if (error.status === 401) return "로그인 세션이 만료되었습니다. 다시 로그인해 주세요.";
    if (error.status === 503) return "데이터베이스 연결이 일시적으로 불가능합니다.";
  }
  return "응답을 처리할 수 없습니다. 잠시 후 다시 시도해 주세요.";
}

/** 공개 빌드 변수의 원본 주소를 검사하고 API 절대 URL을 만든다. */
export function apiUrl(path: string): URL {
  const base = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();
  if (!base) throw new ApiFailure("config");
  try {
    const url = new URL(base);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password ||
      url.pathname !== "/" || url.search || url.hash ||
      (globalThis.location?.protocol === "https:" && url.protocol !== "https:")) {
      throw new ApiFailure("config");
    }
    return new URL(path, url);
  } catch {
    throw new ApiFailure("config");
  }
}

/** 취소 신호와 8초 제한을 결합해 쿠키 정책을 명시한 요청을 수행한다. */
export async function apiRequest(
  path: string,
  credentials: RequestCredentials,
  options: { method?: "GET" | "POST" | "PUT" | "DELETE"; body?: unknown; csrf?: { headerName: string; token: string }; signal?: AbortSignal } = {},
): Promise<unknown> {
  const url = apiUrl(path);
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) controller.abort();
  const timer = setTimeout(abort, 8_000);
  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    if (options.csrf) {
      if (options.csrf.headerName !== "X-CSRF-TOKEN" || !options.csrf.token) throw new ApiFailure("response");
      headers[options.csrf.headerName] = options.csrf.token;
    }
    const response = await fetch(url, {
      method: options.method ?? "GET", body: options.body === undefined ? undefined : JSON.stringify(options.body),
      headers, credentials, cache: "no-store", mode: "cors", redirect: "error", signal: controller.signal,
    });
    if (!response.ok) throw new ApiFailure("http", response.status);
    if (response.status === 204) return null;
    try { return await response.json() as unknown; }
    catch { throw new ApiFailure(controller.signal.aborted ? "timeout" : "response"); }
  } catch (error) {
    if (error instanceof ApiFailure) throw error;
    if (controller.signal.aborted && !options.signal?.aborted) throw new ApiFailure("timeout");
    if (options.signal?.aborted) throw error;
    throw new ApiFailure("network");
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
  }
}

/** JSON 응답을 읽으며 비정상 본문을 계약 오류로 바꾼다. */
export async function apiJson<T>(path: string, credentials: RequestCredentials, signal?: AbortSignal): Promise<T> {
  return await apiRequest(path, credentials, { signal }) as T;
}

/** 인증 변경 후 새 CSRF 토큰을 세션에서 가져온다. 원문은 메모리에만 둔다. */
export async function fetchCsrf(signal?: AbortSignal): Promise<{ headerName: string; token: string }> {
  const value = await apiJson<unknown>("/api/v1/auth/csrf", "include", signal);
  if (!isRecord(value) || value.headerName !== "X-CSRF-TOKEN" || typeof value.token !== "string" || !value.token) {
    throw new ApiFailure("response");
  }
  return { headerName: value.headerName, token: value.token };
}

/** 서버 응답이 객체인지 좁힌다. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 조회 요청의 순서와 PRIVATE 필드 부재를 포함해 위키 응답을 엄격히 확인한다. */
export function parseWikiLinkResults(value: unknown, requested: readonly string[]): WikiLinkResult[] {
  if (!isRecord(value) || Object.keys(value).length !== 1 || !Array.isArray(value.items) ||
    value.items.length !== requested.length) throw new ApiFailure("response");
  return value.items.map((item: unknown, index: number): WikiLinkResult => {
    if (!isRecord(item) || item.requestedTitle !== requested[index]) throw new ApiFailure("response");
    if (item.status === "LOCKED" || item.status === "MISSING") {
      if (Object.keys(item).length !== 2) throw new ApiFailure("response");
      return { requestedTitle: item.requestedTitle, status: item.status };
    }
    if (item.status !== "READABLE" || Object.keys(item).length !== 5 ||
      typeof item.id !== "number" || !Number.isSafeInteger(item.id) || item.id <= 0 ||
      typeof item.title !== "string" || !item.title ||
      typeof item.slug !== "string" || item.slug.length > 160 ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.slug)) throw new ApiFailure("response");
    return { requestedTitle: item.requestedTitle, status: "READABLE", id: item.id,
      title: item.title, slug: item.slug };
  });
}

/** 검색·역링크가 본문이나 비공개 메타데이터를 실수로 노출하지 않도록 필드를 제한한다. */
function parseWikiTitleItem(value: unknown): WikiTitleItem {
  if (!isRecord(value) || Object.keys(value).length !== 3 ||
    !Number.isSafeInteger(value.id) || (value.id as number) <= 0 ||
    typeof value.title !== "string" || !value.title ||
    typeof value.slug !== "string" || value.slug.length > 160 ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.slug)) throw new ApiFailure("response");
  return { id: value.id as number, title: value.title, slug: value.slug };
}

/** 관리자 제목 검색의 정확한 대상과 최대 7개 후보를 검증한다. */
export function parseWikiTitleSearch(value: unknown, query: string): WikiTitleSearch {
  if (!isRecord(value) || !Array.isArray(value.items) || value.items.length > 7)
    throw new ApiFailure("response");
  const exact = parseWikiLinkResults({ items: [value.exact] }, [query])[0];
  return { items: value.items.map(parseWikiTitleItem), exact };
}

/** 요청 페이지와 최대 10개 역링크, 다음 페이지 여부를 확인한다. */
export function parseWikiBacklinkPage(value: unknown, requestedPage: number): WikiBacklinkPage {
  if (!isRecord(value) || !Array.isArray(value.items) || value.items.length > 10 ||
    value.page !== requestedPage || typeof value.hasMore !== "boolean") throw new ApiFailure("response");
  return { items: value.items.map(parseWikiTitleItem), page: requestedPage, hasMore: value.hasMore };
}

/** 현재 사용자 DTO의 이름과 역할만 확인한다. */
export function parseCurrentUser(value: unknown): CurrentUser {
  if (!isRecord(value) || typeof value.username !== "string" ||
    (value.role !== "USER" && value.role !== "ADMIN")) throw new ApiFailure("response");
  return { username: value.username, role: value.role };
}

/** 공개 목록 응답의 필수 필드를 검사해 불완전한 API 응답을 빈 목록으로 오해하지 않게 한다. */
export function parsePostPage(value: unknown): PostPage {
  if (!isRecord(value) || !Array.isArray(value.items) ||
    ![value.page, value.size, value.totalElements, value.totalPages].every((n) => typeof n === "number" && Number.isFinite(n))) {
    throw new ApiFailure("response");
  }
  return { items: value.items.map(parsePostSummary), page: value.page as number, size: value.size as number,
    totalElements: value.totalElements as number, totalPages: value.totalPages as number };
}

/** 분류 참조의 필수 필드를 검사한다. */
function parseCategoryRef(value: unknown): CategoryRef {
  if (!isRecord(value) || typeof value.id !== "number" || typeof value.path !== "string" ||
    typeof value.name !== "string" || typeof value.depth !== "number") throw new ApiFailure("response");
  return { id: value.id, path: value.path, name: value.name, depth: value.depth };
}

/** 본문 없는 글의 필수 메타데이터를 검사한다. */
function parsePostSummary(value: unknown): PostSummary {
  if (!isRecord(value) || typeof value.id !== "number" || typeof value.title !== "string" ||
    typeof value.slug !== "string" || typeof value.publishedDate !== "string" ||
    !Array.isArray(value.tags) || !value.tags.every((tag) => typeof tag === "string")) throw new ApiFailure("response");
  return { id: value.id, title: value.title, slug: value.slug, publishedDate: value.publishedDate,
    category: value.category === null ? null : parseCategoryRef(value.category), tags: value.tags };
}

/** 잠금 여부와 본문을 포함하는 글 상세를 검사한다. */
export function parsePostDetail(value: unknown): PostDetail {
  const summary = parsePostSummary(value);
  if (!isRecord(value) || typeof value.locked !== "boolean" ||
    (value.body !== null && typeof value.body !== "string") ||
    (value.locked && (value.body !== null || value.category !== null || summary.tags.length > 0))) {
    throw new ApiFailure("response");
  }
  return { ...summary, locked: value.locked, body: value.body };
}

/** 분류 트리와 권한별 건수를 재귀 검증한다. */
export function parseCategories(value: unknown): CategoryNode[] {
  if (!Array.isArray(value)) throw new ApiFailure("response");
  return value.map((item): CategoryNode => {
    const ref = parseCategoryRef(item);
    if (!isRecord(item) || typeof item.directCount !== "number" ||
      typeof item.totalCount !== "number" || !Array.isArray(item.children)) throw new ApiFailure("response");
    return { ...ref, directCount: item.directCount, totalCount: item.totalCount,
      children: parseCategories(item.children) };
  });
}

/** 역할별 태그 집계 목록을 검증한다. */
export function parseTags(value: unknown): TagCount[] {
  if (!Array.isArray(value)) throw new ApiFailure("response");
  return value.map((item): TagCount => {
    if (!isRecord(item) || typeof item.name !== "string" || typeof item.count !== "number") throw new ApiFailure("response");
    return { name: item.name, count: item.count };
  });
}
