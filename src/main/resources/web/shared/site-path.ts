/**
 * GitHub Pages 프로젝트 기준 경로
 */
export const BASE = '/ken-blog/';

/**
 * canonical·사이트맵의 공개 출처
 */
export const ORIGIN = 'https://gjaku1031.github.io';

/**
 * 기준 경로와 빌드에서 확정한 상대 경로 결합
 */
export const sitePath = (path = '') => BASE + path;

/**
 * 공개 글·시리즈 식별자 검사, 최대 160자
 */
export function isSlug(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 160 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

/**
 * 공개 식별자를 검증하고 유효하지 않으면 생성 중단
 */
export function checkedSlug(value: unknown): string {
  if (!isSlug(value)) throw new Error('공개 slug 형식 오류');
  return value;
}

/**
 * 검증된 글 식별자의 canonical 상세 경로
 */
export const postPath = (post: {
  /**
   * 글 식별자
   */
  slug: string;
}) => sitePath(`post/${checkedSlug(post.slug)}/`);

/**
 * 서버·브라우저 로캘에 무관한 위키 제목 비교 키
 */
export const wikiKey = (title: string) => title.toLocaleLowerCase('und');
