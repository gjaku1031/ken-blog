/**
 * 성공한 Pages 산출물에 포함되는 공개 글별 메타데이터 지문
 * 초안·관리자 데이터·본문은 포함하지 않음
 */
export type DeploymentManifest = {
  /**
   * 비교 형식 버전
   */
  version: 1;

  /**
   * 산출물 생성 시각, 배포 완료 시각으로 사용하지 않음
   */
  generatedAt: string;

  /**
   * 공개 글 ID별 SHA-256
   */
  posts: Record<string, string>;
};

/**
 * 현재 공개 데이터와 실제 서비스 중인 산출물 비교
 */
export type DeploymentComparison = {
  /**
   * 저장된 현재 공개 메타데이터
   */
  current: DeploymentManifest;

  /**
   * 운영 사이트에서 읽은 배포 기록
   */
  deployed: DeploymentManifest;
};

/**
 * 글 상태와 필터에 필요한 관리자 필드
 */
export type Publication = {
  /**
   * 글 ID
   */
  id: number;

  /**
   * 발행 여부
   */
  status: 'DRAFT' | 'PUBLISHED';

  /**
   * 공개 범위
   */
  visibility: 'PUBLIC' | 'PRIVATE';
};

/**
 * 전체·미발행·배포 대기 목록 필터
 */
export type PostFilter = 'all' | 'draft' | 'pending';

/**
 * 비교 불가능한 JSON 객체는 성공 상태로 취급하지 않도록 거부
 */
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('배포 비교 데이터가 올바르지 않습니다.');
  return value as Record<string, unknown>;
}

/**
 * 공개 표시 필드를 고정 순서로 선별, 누락값은 null로 통일
 */
function pick(value: unknown, keys: string[]) {
  if (value == null) return null;
  const row = record(value);
  return Object.fromEntries(keys.map(key => [key, row[key] ?? null]));
}

/**
 * 공개 스냅샷의 글·탐색·프로젝트 정보를 같은 방식으로 해시
 *
 * 1. 공개 스냅샷 형태 검사
 * 2. API 내부 필드와 빌드 중 치환되는 이미지 URL을 제외한 표시 정보 선별
 * 3. 글별 지문 생성, 생성 시각은 비교 대상에서 제외
 */
export async function deploymentManifest(input: unknown): Promise<DeploymentManifest> {
  const snapshot = record(input);
  if (snapshot.version !== 2 || !Array.isArray(snapshot.posts) || !Array.isArray(snapshot.series))
    throw new Error('공개 스냅샷을 확인하지 못했습니다.');
  const groups = snapshot.series.map(record);
  // JSON 속성 순서·서버 전용 부가 필드에 영향을 받지 않는 공개 필드 구성
  const entries = await Promise.all(snapshot.posts.map(async value => {
    const post = record(value);
    if (!Number.isSafeInteger(post.id) || Number(post.id) <= 0 || typeof post.title !== 'string')
      throw new Error('공개 글 정보를 확인하지 못했습니다.');
    const navigation = post.series == null ? null : record(post.series);
    const project = post.section === 'PROJECT' ? groups.find(group => group.id === navigation?.id && group.slug === navigation?.slug) : null;
    const metadata = {
      post: pick(post, ['id', 'slug', 'title', 'summary', 'section', 'publishedAt', 'publishedDate', 'legacyPath', 'tags']),
      category: pick(post.category, ['id', 'path', 'name', 'depth']),
      series: navigation ? { ...pick(navigation, ['id', 'slug', 'name', 'kind', 'position']),
        items: Array.isArray(navigation.items) ? navigation.items.map(item => pick(item, ['id', 'slug', 'title', 'order'])) : null } : null,
      related: pick(post.relatedSeries, ['id', 'slug', 'name', 'kind']),
      project: project ? { ...pick(project, ['id', 'slug', 'name', 'description', 'projectStatus', 'startPeriod', 'endPeriod', 'sortOrder', 'postCount']),
        cover: pick(project.cover, ['id', 'slug', 'title', 'order']),
        badges: Array.isArray(project.stackBadges) ? project.stackBadges.map(badge => pick(badge, ['id', 'name'])) : null } : null,
    };
    // 정적 생성기와 브라우저 모두 표준 Web Crypto 사용
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(metadata)));
    const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    return [String(post.id), hash];
  }));
  return { version: 1, generatedAt: new Date().toISOString(), posts: Object.fromEntries(entries) };
}

/**
 * 배포 기록 형식 검사, 오류·다른 버전을 빈 정상 배포로 오인하지 않음
 */
export function readDeploymentManifest(input: unknown): DeploymentManifest {
  const data = record(input);
  const posts = record(data.posts);
  if (data.version !== 1 || typeof data.generatedAt !== 'string' || !Number.isFinite(Date.parse(data.generatedAt)) ||
      !Object.entries(posts).every(([id, hash]) => /^[1-9][0-9]*$/.test(id) && typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash)))
    throw new Error('배포 기록을 확인하지 못했습니다.');
  return data as DeploymentManifest;
}

/**
 * 발행 설정과 실제 반영 여부를 구분한 상태 표시
 * 배포 기록 조회 실패 시 공개 완료로 추정하지 않음
 */
export function deploymentState(post: Publication, comparison: DeploymentComparison | null) {
  const deployed = comparison?.deployed.posts[post.id];
  const current = comparison?.current.posts[post.id];
  if (post.status === 'DRAFT') return deployed
    ? { kind: 'pending', label: '발행 취소 · 배포 대기' }
    : { kind: 'draft', label: '미발행' };
  if (post.visibility === 'PRIVATE') return deployed
    ? { kind: 'pending', label: '비공개 전환 · 배포 대기' }
    : { kind: 'private', label: '비공개 발행' };
  if (!comparison || !current) return { kind: 'unknown', label: '배포 상태 확인 필요' };
  if (!deployed) return { kind: 'pending', label: '발행 후 배포 대기' };
  return current === deployed
    ? { kind: 'published', label: '공개 반영 완료' }
    : { kind: 'pending', label: '수정 후 배포 대기' };
}

/**
 * 전체 관리자 목록을 먼저 필터링하며 페이지 범위는 호출자가 적용
 */
export function filterPosts<T extends Publication>(posts: T[], filter: PostFilter, comparison: DeploymentComparison | null): T[] {
  return posts.filter(post => filter === 'all' || (filter === 'draft' ? post.status === 'DRAFT' : deploymentState(post, comparison).kind === 'pending'));
}
