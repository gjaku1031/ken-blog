import { AdminApi, ApiError } from './api';

type WikiItem = { requestedTitle?: unknown; status?: unknown; slug?: unknown;
  section?: unknown; projectSlug?: unknown; courseSlug?: unknown };
const SITE = 'https://gjaku1031.github.io/ken-blog/';
const slug = (value: unknown): value is string => typeof value === 'string' && value.length <= 160 &&
  /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);

/** 서버가 확인한 출간 대상만 Pages의 canonical 경로로 조합; 임의 URL은 신뢰하지 않음. */
function destination(item: WikiItem): string | null {
  if (item.status === 'MISSING') return null;
  if (item.status !== 'READABLE' || !slug(item.slug)) throw new ApiError(0, 'response');
  if (item.section === 'TECH') return `${SITE}post/${item.slug}/`;
  if (item.section === 'PROJECT_HOME' && slug(item.projectSlug)) return `${SITE}project/${item.projectSlug}/`;
  if (item.section === 'PROJECT_DOC' && slug(item.projectSlug))
    return `${SITE}project/${item.projectSlug}/docs/${item.slug}/`;
  if (item.section === 'NOTE_CHAPTER' && slug(item.courseSlug))
    return `${SITE}course/${item.courseSlug}/chapters/${item.slug}/`;
  throw new ApiError(0, 'response');
}

/** 같은 원고의 반복 조회를 짧게 재사용하고 서버의 제목 수·UTF-8 요청 한도를 지키는 조회기. */
export class WikiPreviewResolver {
  private readonly cache = new Map<string, { url: string | null; time: number }>();

  constructor(private readonly api: AdminApi) {}

  /** 없는 글도 null로 구분하며 취소·실패 응답은 캐시에 기록하지 않음. */
  async resolve(titles: readonly string[], signal: AbortSignal): Promise<Map<string, string | null>> {
    const unique = [...new Set(titles)];
    if (unique.length > 128) throw new ApiError(400);
    const result = new Map<string, string | null>();
    const pending: string[] = [];
    const now = Date.now();
    for (const title of unique) {
      const cached = this.cache.get(title);
      if (cached && now - cached.time < 30_000) result.set(title, cached.url);
      else pending.push(title);
    }
    // 캐시는 현재 문서에서 사용하는 제목만 남겨 편집 중 무한히 늘어나지 않게 함.
    for (const key of this.cache.keys()) if (!unique.includes(key)) this.cache.delete(key);
    const encoder = new TextEncoder();
    while (pending.length) {
      const batch: string[] = [];
      let bytes = 0;
      while (pending.length && batch.length < 20) {
        const title = pending[0];
        const size = encoder.encode(title).length;
        if (size > 1500) throw new ApiError(400);
        if (batch.length && bytes + size > 1500) break;
        batch.push(pending.shift()!); bytes += size;
      }
      if (signal.aborted) throw new DOMException('취소된 위키 조회', 'AbortError');
      const params = new URLSearchParams();
      batch.forEach((title) => params.append('title', title));
      const value = await this.api.get<{ items?: WikiItem[] }>(`/wiki-links/resolve?${params}`, signal);
      if (signal.aborted) throw new DOMException('취소된 위키 조회', 'AbortError');
      if (!Array.isArray(value?.items) || value.items.length !== batch.length) throw new ApiError(0, 'response');
      const rows = value.items.map((item, index) => {
        if (!item || item.requestedTitle !== batch[index]) throw new ApiError(0, 'response');
        return [batch[index], destination(item)] as const;
      });
      for (const [title, url] of rows) { result.set(title, url); this.cache.set(title, { url, time: now }); }
    }
    return result;
  }
}
