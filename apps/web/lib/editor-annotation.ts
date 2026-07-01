import type { Root } from "mdast";
import { type AnnotationItem } from "./annotation-syntax";
import { blockMarkdown, emptyBlock, ensureBlockBoundaries, serializeEditorMarkdown,
  type EditorBlock, type MarkdownDocument } from "./editor-markdown";
import { escapeToggleTitle } from "./editor-toggle";
import { parseAnnotationDocument } from "./markdown-details";

/** 현재 텍스트와 범위를 함께 보관해 오래된 커서가 다른 원고를 수정하지 못하게 한다. */
export type EditorAnnotationSelection = { id: string; start: number; end: number; expectedText: string };
/** 접기 자식의 초점을 부모 블록과 구별하는 삽입 결과. */
export type EditorAnnotationFocus = { id: string; offset: number; path?: { toggleId: string } };
/** 전체 문서에서 확정된 참조와 단일 블록 Markdown 안의 UTF-16 위치. */
export type EditorAnnotationReference = {
  start: number; end: number; index: number; occurrence: number; label: string; raw: string;
};
/** 저장 원문과 주석 목록, 정확히 대응되는 텍스트 블록의 참조만 모은다. */
export type EditorAnnotationModel = {
  body: string; items: AnnotationItem[]; byBlock: Map<string, EditorAnnotationReference[]>;
};

type Target = { block: EditorBlock; index: number; toggleIndex?: number; toggleId?: string };
type Span = { id: string; start: number; end: number };
type CandidateNode = { type: string; raw?: string;
  position?: { start: { offset?: number }; end: { offset?: number } };
  data?: { hName?: string; hProperties?: Record<string, unknown>;
    hChildren?: Array<{ type: "text"; value: string }> };
  children?: CandidateNode[] };

const INLINE_TYPES = new Set(["p", "h1", "h2", "h3", "ul", "ol", "todo", "quote"]);
const INSERTION = "[* ]";

/** 최상위와 한 단계 접기 자식을 실제 표시 순서로 모으고 다른 블록은 제외한다. */
function editableTargets(document: MarkdownDocument): Target[] {
  const targets: Target[] = [];
  document.blocks.forEach((block, index) => {
    if (INLINE_TYPES.has(block.type)) targets.push({ block, index });
    if (block.type === "toggle" && block.toggle) block.toggle.inner.blocks.forEach((child, childIndex) => {
      if (INLINE_TYPES.has(child.type)) targets.push({ block: child, index: childIndex,
        toggleIndex: index, toggleId: block.id });
    });
  });
  return targets;
}

/** 유효한 선택 범위를 대체하고, 범위가 낡았으면 마지막 편집 가능 블록에 안전하게 삽입한다. */
export function insertAnnotationAt(document: MarkdownDocument, selection?: EditorAnnotationSelection | null):
  { document: MarkdownDocument; focus: EditorAnnotationFocus } {
  const targets = editableTargets(document);
  const selected = selection && targets.find((target) => target.block.id === selection.id);
  const valid = selected && selected.block.text === selection?.expectedText &&
    Number.isSafeInteger(selection.start) && Number.isSafeInteger(selection.end) &&
    selection.start >= 0 && selection.end >= selection.start && selection.end <= selected.block.text.length;
  const target = valid ? selected : targets[targets.length - 1];
  if (!target) {
    const added = { ...emptyBlock("p", document.newline), text: INSERTION, after: "" };
    return { document: ensureBlockBoundaries({ ...document, blocks: [...document.blocks, added] }),
      focus: { id: added.id, offset: 3 } };
  }
  const start = valid ? selection!.start : target.block.text.length;
  const end = valid ? selection!.end : start;
  const changed = { ...target.block, text: target.block.text.slice(0, start) + INSERTION +
    target.block.text.slice(end), dirty: true };
  if (target.toggleIndex === undefined) {
    const blocks = document.blocks.map((block, index) => index === target.index ? changed : block);
    return { document: { ...document, blocks }, focus: { id: changed.id, offset: start + 3 } };
  }
  const blocks = document.blocks.map((block, index) => {
    if (index !== target.toggleIndex || !block.toggle) return block;
    const inner = block.toggle.inner;
    return { ...block, dirty: true, toggle: { ...block.toggle, inner: { ...inner,
      blocks: inner.blocks.map((child, childIndex) => childIndex === target.index ? changed : child) } } };
  });
  return { document: { ...document, blocks }, focus: { id: changed.id, offset: start + 3,
    path: { toggleId: target.toggleId! } } };
}

/** 실제 직렬화된 블록 길이를 더해 전체 원문과 자식 블록의 시작 위치를 맞춘다. */
function editableSpans(document: MarkdownDocument, base = 0): Span[] {
  const spans: Span[] = [];
  let cursor = base + document.head.length;
  for (const block of document.blocks) {
    const source = blockMarkdown(block, document.newline);
    if (INLINE_TYPES.has(block.type)) spans.push({ id: block.id, start: cursor, end: cursor + source.length });
    if (block.type === "toggle" && block.toggle) {
      const toggle = block.toggle;
      const title = block.text === toggle.originalTitle ? toggle.titleRaw : escapeToggleTitle(block.text);
      const prefix = toggle.beforeTitle + title + toggle.afterTitle;
      const inner = serializeEditorMarkdown(toggle.inner);
      // 원래 wrapper와 새 직렬화가 맞지 않으면 잘못된 번호 대신 원문 미리보기를 유지한다.
      if (source.startsWith(prefix) && source.slice(prefix.length).startsWith(inner)) {
        spans.push(...editableSpans(toggle.inner, cursor + prefix.length));
      }
    }
    cursor += source.length + block.after.length;
  }
  return spans;
}

/** resolve된 후보의 원문 위치와 내부 숫자 속성을 다시 확인하고 안전한 참조만 추린다. */
function resolvedReferences(root: Root, items: AnnotationItem[]): EditorAnnotationReference[] {
  const references: EditorAnnotationReference[] = [];
  const visit = (node: CandidateNode) => {
    if (node.type === "kenAnnotationCandidate" && node.data?.hName === "sup") {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      const indexText = node.data.hProperties?.["data-annotation-index"];
      const occurrenceText = node.data.hProperties?.["data-annotation-occurrence"];
      const index = typeof indexText === "string" ? Number(indexText) : NaN;
      const occurrence = typeof occurrenceText === "string" ? Number(occurrenceText) : NaN;
      const item = items[index];
      if (start !== undefined && end !== undefined && start < end &&
        Number.isSafeInteger(index) && Number.isSafeInteger(occurrence) && item?.refs.includes(occurrence) &&
        typeof node.raw === "string") references.push({ start, end, index, occurrence,
        label: item.label, raw: node.raw });
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(root as CandidateNode);
  return references.sort((left, right) => left.start - right.start);
}

/** 저장할 본문 한 개를 읽기 파서로 확정하고 정확히 포함된 편집 블록에만 전체 번호를 배치한다. */
export function buildEditorAnnotationModel(document: MarkdownDocument): EditorAnnotationModel {
  const body = serializeEditorMarkdown(document);
  const { root, items } = parseAnnotationDocument(body);
  const spans = editableSpans(document).sort((left, right) => left.start - right.start);
  const byBlock = new Map<string, EditorAnnotationReference[]>();
  let spanIndex = 0;
  for (const reference of resolvedReferences(root, items)) {
    if (body.slice(reference.start, reference.end) !== reference.raw) continue;
    while (spanIndex < spans.length && spans[spanIndex].end <= reference.start) spanIndex++;
    const span = spans[spanIndex];
    if (!span || reference.start < span.start || reference.end > span.end) continue;
    const local = { ...reference, start: reference.start - span.start, end: reference.end - span.start };
    const list = byBlock.get(span.id) ?? [];
    list.push(local);
    byBlock.set(span.id, list);
  }
  return { body, items, byBlock };
}

/** 블록 단편을 다시 번호 매기지 않고 전체 문서에서 확정한 정확한 후보만 위첨자로 표시한다. */
export function remarkEditorAnnotations(references: readonly EditorAnnotationReference[] = []) {
  return (root: Root) => {
    const byPosition = new Map(references.map((reference) =>
      [`${reference.start}:${reference.end}`, reference]));
    const visit = (node: CandidateNode) => {
      if (node.type === "kenAnnotationCandidate") {
        const reference = byPosition.get(`${node.position?.start.offset}:${node.position?.end.offset}`);
        if (reference && node.raw === reference.raw) node.data = { hName: "sup",
          hProperties: { className: ["ken-annotation-ref"],
            "data-annotation-index": String(reference.index),
            "data-annotation-occurrence": String(reference.occurrence) },
          hChildren: [{ type: "text", value: `[${reference.label}]` }] };
        return;
      }
      for (const child of node.children ?? []) visit(child);
    };
    visit(root as CandidateNode);
  };
}
