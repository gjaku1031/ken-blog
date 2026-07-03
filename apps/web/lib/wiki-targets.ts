import { parseAnnotationDocument } from "./markdown-details";
import { collectWikiTitles } from "./wiki-link-syntax";

/** 읽기와 같은 AST에서 현재 저장 본문의 전체 제목 참조를 순서대로 추출한다. */
export function collectWikiTargets(body: string): string[] {
  const parsed = parseAnnotationDocument(body);
  return collectWikiTitles(parsed.root, parsed.items).titles;
}
