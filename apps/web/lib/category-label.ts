import type { CategoryNode } from "./api";

/** 카테고리 ID를 트리의 등록된 표시명 경로로 변환한다. {@link categoryLabelPath} */
export function categoryLabelPath(nodes: CategoryNode[], id: number): string | null {
  for (const node of nodes) {
    if (node.id === id) return node.name;
    const child = categoryLabelPath(node.children, id);
    if (child) return `${node.name} › ${child}`;
  }
  return null;
}
