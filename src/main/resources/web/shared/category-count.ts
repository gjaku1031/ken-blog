import type { Category } from './post-fields';

/**
 * 서버 합계가 있으면 사용하고 없으면 하위 분류의 직접 글 수를 합산
 */
export function categoryCount(category: Category): number {
  return category.totalCount ?? category.directCount + category.children.reduce((sum, child) => sum + categoryCount(child), 0);
}
