import type { Root } from "mdast";
import { readableMathFallback } from "./math-format";

/** 원문 위치와 연결된 최상위 2·3단 제목 항목. */
export type TocItem = { id: string; label: string; depth: 2 | 3; offset: number };
type ReadableNode = { type: string; value?: string; children?: ReadableNode[];
  data?: { hChildren?: Array<{ type: string; value?: string }> };
  position?: { start: { offset?: number } } };

/** 위키 표시는 라벨로, 주석은 제외해 독자가 읽는 제목만 만든다. */
function headingText(node: ReadableNode): string {
  if (node.type === "kenAnnotationCandidate" || node.type === "image" || node.type === "imageReference") return "";
  if (node.type === "kenWikiLink") return node.data?.hChildren?.map((child) => child.value ?? "").join("") ?? "";
  if (node.type === "kenMathInline") return readableMathFallback(node.value ?? "");
  if (node.type === "text" || node.type === "inlineCode") return node.value ?? "";
  return (node.children ?? []).map(headingText).join("");
}

/** 제목 문자열 기반 앵커와 중복 suffix를 문서 순서대로 확정한다. */
export function extractToc(root: Root): TocItem[] {
  const items: TocItem[] = [];
  const counts = new Map<string, number>();
  const used = new Set<string>();
  for (const node of root.children) {
    if (node.type !== "heading" || (node.depth !== 2 && node.depth !== 3)) continue;
    const offset = node.position?.start.offset;
    if (offset === undefined) continue;
    const label = headingText(node as ReadableNode).replace(/\s+/gu, " ").trim() || "제목";
    const base = label.normalize("NFKC").toLocaleLowerCase("und").replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "").slice(0, 80).replace(/-+$/g, "") || "section";
    let count = (counts.get(base) ?? 0) + 1;
    let id = `section-${base}${count > 1 ? `-${count}` : ""}`;
    while (used.has(id)) { count++; id = `section-${base}-${count}`; }
    counts.set(base, count);
    used.add(id);
    items.push({ id, label, depth: node.depth, offset });
  }
  return items;
}
