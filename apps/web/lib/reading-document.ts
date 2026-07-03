import type { AnnotationItem } from "./annotation-syntax";
import { parseAnnotationDocument } from "./markdown-details";
import { extractToc, type TocItem } from "./table-of-contents";
import { collectWikiTitles } from "./wiki-link-syntax";

/** 한 원문에서 위키·주석·목차를 일치시키는 읽기 모델. */
export type ReadingDocument = { items: AnnotationItem[]; wiki: { titles: string[]; annotationLimits: number[] };
  toc: TocItem[] };

/** 접기 변환까지 마친 단일 AST로 읽기 보조 탐색 정보를 계산한다. */
export function buildReadingDocument(body: string): ReadingDocument {
  const parsed = parseAnnotationDocument(body);
  return { items: parsed.items, wiki: collectWikiTitles(parsed.root, parsed.items), toc: extractToc(parsed.root) };
}
