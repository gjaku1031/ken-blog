import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { parseEditableTable, serializeTable, type TableAlignment, type TableData } from "@/lib/editor-table";
import { parseAttachmentId, parseImageAlt, serializeImageBlock, type ImageData } from "@/lib/editor-image";
import { escapeToggleTitle, splitEditableToggle } from "@/lib/editor-toggle";

/** 편집 가능한 기본 문법과 원문 그대로 잠그는 미지원 문법. */
export type BlockType = "p" | "h1" | "h2" | "h3" | "ul" | "ol" | "todo" | "quote" | "code" | "hr" | "table" | "toggle" | "image" | "raw";
/** 접기 wrapper의 원래 경계와 안쪽 한 단계 문서를 독립적으로 보존한다. */
export type ToggleData = {
  beforeTitle: string; titleRaw: string; originalTitle: string; afterTitle: string;
  inner: MarkdownDocument; suffix: string;
};
export type EditorBlock = {
  id: string; type: BlockType; text: string; raw: string; after: string; dirty: boolean;
  lang?: string; done?: boolean; ordinal?: number; table?: TableData; toggle?: ToggleData; image?: ImageData;
};
export type MarkdownDocument = { head: string; blocks: EditorBlock[]; newline: "\n" | "\r\n" };

const parser = unified().use(remarkParse).use(remarkGfm);
let nextId = 0;

/** 브라우저 수명 안에서 블록 이동·포커스에 사용할 식별자를 만든다. */
export function blockId(): string { nextId += 1; return `editor-block-${nextId}`; }

/** 원문 이외 필드는 편집 가능한 새 문단으로 초기화한다. */
export function emptyBlock(type: BlockType = "p", newline = "\n"): EditorBlock {
  return { id: blockId(), type, text: "", raw: "", after: newline, dirty: true };
}

/** 업로드를 마친 READY 첨부를 새 canonical 이미지 블록으로 삽입한다. */
export function emptyImageBlock(image: ImageData, newline = "\n"): EditorBlock {
  return { ...emptyBlock("image", newline), after: newline.repeat(2), image };
}

/** 제목과 안쪽 빈 문단을 포함한 한 단계 접기를 새로 만든다. */
export function emptyToggleBlock(newline = "\n"): EditorBlock {
  const child = { ...emptyBlock("p", newline), after: "" };
  return { ...emptyBlock("toggle", newline), after: newline.repeat(2), toggle: {
    beforeTitle: `<details>${newline}<summary>`, titleRaw: "", originalTitle: "", afterTitle: "</summary>",
    inner: { head: newline.repeat(2), blocks: [child], newline: newline === "\r\n" ? "\r\n" : "\n" },
    suffix: `${newline.repeat(2)}</details>`,
  } };
}

/** 펜스 안의 HTML을 건드리지 않고 중첩 details 전부를 원문 보호 범위로 찾는다. */
function detailsRanges(source: string): Array<{ start: number; end: number }> {
  const result: Array<{ start: number; end: number }> = [];
  const lines = source.match(/.*(?:\r?\n|$)/g) ?? [];
  let offset = 0;
  let fence: { char: string; count: number } | null = null;
  let depth = 0;
  let start = 0;
  for (const line of lines) {
    if (!line) continue;
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (marker) {
      const chars = marker[1];
      if (!fence) fence = { char: chars[0], count: chars.length };
      else if (chars[0] === fence.char && chars.length >= fence.count && /^\s*$/.test(line.slice(marker[0].length))) fence = null;
    } else if (!fence && /^\s*<\/?details(?:\s|>)/i.test(line)) {
      for (const tag of line.matchAll(/<\/?details(?:\s[^>]*)?>/gi)) {
        if (/^<details/i.test(tag[0])) { if (depth === 0) start = offset + tag.index; depth += 1; }
        else if (depth > 0 && --depth === 0) result.push({ start, end: offset + line.length });
      }
    }
    offset += line.length;
  }
  if (depth > 0) result.push({ start, end: source.length });
  return result;
}

type SourceNode = { type: string; position?: { start: { offset?: number }; end: { offset?: number } }; children?: SourceNode[];
  url?: string; alt?: string;
  ordered?: boolean; checked?: boolean | null; lang?: string | null; align?: TableAlignment[] };
type Span = { start: number; end: number; node: SourceNode; forcedRaw?: boolean };

/** 단일 줄의 단순 목록만 각 항목으로 펼치고, 복잡한 목록은 하나의 원문 블록으로 둔다. */
function listSpans(node: SourceNode, source: string): Span[] | null {
  const children = node.children;
  if (!children?.length) return null;
  const spans: Span[] = [];
  for (const item of children) {
    const start = item.position?.start.offset;
    const end = item.position?.end.offset;
    const raw = start === undefined || end === undefined ? "" : source.slice(start, end);
    if (start === undefined || end === undefined || /\r|\n/.test(raw) || item.children?.length !== 1 ||
      item.children[0].type !== "paragraph" || !/^\s*(?:[-+*]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/.test(raw)) return null;
    spans.push({ start, end, node: { ...item, type: node.ordered ? "orderedItem" : "unorderedItem" } });
  }
  return spans;
}

/**
 * Alt가 디코딩된 뒤에도 literal pipe와 메타 구분자를 혼동하지 않도록 원문 경계를 확인한다.
 * 새 직렬화는 설명 속 pipe를 이스케이프하고 마지막 두 구분자만 이스케이프하지 않는다.
 */
function standaloneImageAlt(raw: string, attachmentId: number, alt: string): boolean {
  const ending = `](attachment:${attachmentId})`;
  if (!raw.startsWith("![") || !raw.endsWith(ending)) return false;
  const source = raw.slice(2, -ending.length);
  if (/[\r\n]/.test(source)) return false;
  if (!alt.includes("|")) return true;
  const pipes: number[] = [];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "\\") { index += 1; continue; }
    if (source[index] === "|") pipes.push(index);
  }
  if (pipes.length < 2) return false;
  return /^\|w=(20|[2-9]\d|100)\|a=(left|center|right)$/.test(source.slice(pipes[pipes.length - 2]));
}

/** 지원하지 않는 문법의 소스 위치를 포함해 Markdown 원문을 편집 블록으로 분리한다. */
export function parseEditorMarkdown(source: string, depth = 0): MarkdownDocument {
  const root = parser.parse(source);
  const protectedRanges = detailsRanges(source);
  const children = root.children as SourceNode[];
  const spans: Span[] = [];
  for (let index = 0; index < children.length; index += 1) {
    const node = children[index];
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined) continue;
    const range = protectedRanges.find((candidate) => candidate.start < end && candidate.end > start);
    if (range) {
      const groupedEnd = Math.max(end, range.end);
      spans.push({ start: Math.min(start, range.start), end: groupedEnd, node, forcedRaw: true });
      while (index + 1 < children.length && (children[index + 1].position?.start.offset ?? Infinity) < groupedEnd) index += 1;
      continue;
    }
    if (node.type === "list") {
      const items = listSpans(node, source);
      if (items) { spans.push(...items); continue; }
    }
    spans.push({ start, end, node });
  }
  // 정의·참조처럼 remark가 겹치는 position을 주면 겹친 구간 전체를 원문으로 묶는다.
  const normalized: Span[] = [];
  for (const span of spans.sort((left, right) => left.start - right.start || left.end - right.end)) {
    const previous = normalized[normalized.length - 1];
    if (previous && span.start < previous.end) {
      previous.end = Math.max(previous.end, span.end);
      previous.forcedRaw = true;
    } else normalized.push({ ...span });
  }
  const head = normalized.length ? source.slice(0, normalized[0].start) : source;
  const blocks = normalized.map((span, index) => {
    const raw = source.slice(span.start, span.end);
    const after = source.slice(span.end, normalized[index + 1]?.start ?? source.length);
    return decodeBlock(raw, after, span.node, Boolean(span.forcedRaw), depth);
  });
  if (!blocks.length && !source) blocks.push({ ...emptyBlock(), after: "" });
  return { head, blocks, newline: source.includes("\r\n") ? "\r\n" : "\n" };
}

/** AST 분류를 원문 문법으로 재확인하고 모호한 구간은 읽기 전용으로 둔다. */
function decodeBlock(raw: string, after: string, node: SourceNode, forcedRaw: boolean, depth: number): EditorBlock {
  const base: EditorBlock = { id: blockId(), type: "raw", text: raw, raw, after, dirty: false };
  if (forcedRaw) {
    const source = depth === 0 ? splitEditableToggle(raw) : null;
    if (!source) return base;
    return { ...base, type: "toggle", text: source.title, toggle: {
      beforeTitle: source.beforeTitle, titleRaw: source.titleRaw, originalTitle: source.title,
      afterTitle: source.afterTitle, inner: parseEditorMarkdown(source.innerSource, 1), suffix: source.suffix,
    } };
  }
  if (node.type === "table") {
    const table = parseEditableTable(raw, node.children?.[0]?.children?.length ?? 0, node.children?.length ?? 0, node.align);
    if (table) return { ...base, type: "table", text: "", table };
  }
  if (node.type === "paragraph" && node.children?.length === 1 && node.children[0].type === "image") {
    const image = node.children[0];
    const attachmentId = parseAttachmentId(image.url ?? "");
    const alt = parseImageAlt(image.alt ?? "");
    if (attachmentId !== null && alt && standaloneImageAlt(raw, attachmentId, image.alt ?? "")) {
      return { ...base, type: "image", text: "", image: { attachmentId, ...alt } };
    }
  }
  if (node.type === "paragraph" && !/^\s*(?:\$\$|!\[)/i.test(raw) && !/<details\b/i.test(raw) &&
    !node.children?.some((child) => child.type === "image" || child.type === "imageReference")) return { ...base, type: "p" };
  if (node.type === "heading") {
    const match = /^(#{1,3})[ \t]+([^\r\n]*)$/.exec(raw);
    if (match) return { ...base, type: `h${match[1].length}` as BlockType, text: match[2] };
  }
  if (node.type === "unorderedItem" || node.type === "orderedItem") {
    const match = /^\s*(?:([-+*])|(\d+)[.)])[ \t]+(?:\[([ xX])\][ \t]+)?([^\r\n]*)$/.exec(raw);
    if (match) return { ...base, type: match[3] === undefined ? (node.type === "orderedItem" ? "ol" : "ul") : "todo",
      text: match[4], done: match[3]?.toLowerCase() === "x", ordinal: match[2] ? Number(match[2]) : undefined };
  }
  if (node.type === "blockquote") {
    const match = /^>\s?([^\r\n]*)$/.exec(raw);
    if (match) return { ...base, type: "quote", text: match[1] };
  }
  if (node.type === "code") {
    const match = /^ {0,3}(`{3,}|~{3,})([^\r\n]*)\r?\n([\s\S]*?)\r?\n {0,3}(`{3,}|~{3,})[ \t]*$/.exec(raw);
    const lang = match?.[2].trim() ?? "";
    if (match && match[1][0] === match[4][0] && match[4].length >= match[1].length &&
      /^[A-Za-z0-9_-]*$/.test(lang) && lang.toLowerCase() !== "mermaid") {
      return { ...base, type: "code", text: match[3], lang };
    }
  }
  if (node.type === "thematicBreak") return { ...base, type: "hr", text: "" };
  return base;
}

/** 새 문단의 첫 토큰이 다른 블록으로 재해석되지 않게 CommonMark 구두점을 이스케이프한다. */
function escapedParagraph(text: string): string {
  return text.split(/\r?\n/).map((line) => {
    if (/^\d{1,9}[.)][ \t]/.test(line)) return line.replace(/^(\d{1,9})([.)])/, "$1\\$2");
    if (/^(?:#{1,6}[ \t]|[-+*>|][ \t]|[-*_]{3,}[ \t]*$|\$\$|`{3,}|~{3,}|!\[|<details\b)/i.test(line)) {
      return `\\${line}`;
    }
    return line;
  }).join("\n");
}

/** 수정한 블록만 Markdown으로 생성하고 기존 블록의 원문·구분자는 그대로 둔다. */
export function blockMarkdown(block: EditorBlock, newline = "\n"): string {
  if (!block.dirty || block.type === "raw") return block.raw;
  const text = block.text.replace(/\r\n/g, "\n");
  let result: string;
  switch (block.type) {
    case "p": result = escapedParagraph(text); break;
    case "h1": case "h2": case "h3": result = `${"#".repeat(Number(block.type[1]))} ${text.replace(/\n/g, " ")}`; break;
    case "ul": result = `- ${escapedParagraph(text.replace(/\n/g, " "))}`; break;
    case "ol": result = `${block.ordinal ?? 1}. ${escapedParagraph(text.replace(/\n/g, " "))}`; break;
    case "todo": result = `- [${block.done ? "x" : " "}] ${escapedParagraph(text.replace(/\n/g, " "))}`; break;
    case "quote": result = `> ${escapedParagraph(text.replace(/\n/g, " "))}`; break;
    case "hr": result = "---"; break;
    case "table": result = block.table ? serializeTable(block.table) : block.raw; break;
    case "image": result = block.image ? serializeImageBlock(block.image) : block.raw; break;
    case "toggle": {
      if (!block.toggle) return block.raw;
      const inner = serializeEditorMarkdown(block.toggle.inner);
      const seam = inner + (block.toggle.suffix.match(/^[ \t\r\n]*/)?.[0] ?? "");
      // 원래 빈 접기에 처음 본문을 넣을 때만 닫힘 태그와 내용이 한 줄에 붙지 않게 한다.
      const boundary = inner.trim() && !/\r?\n[ \t]*$/.test(seam) ? block.toggle.inner.newline : "";
      return block.toggle.beforeTitle +
        (block.text === block.toggle.originalTitle ? block.toggle.titleRaw : escapeToggleTitle(block.text)) +
        block.toggle.afterTitle + inner + boundary + block.toggle.suffix;
    }
    case "code": {
      const longest = Math.max(2, ...Array.from(text.matchAll(/`+/g), (match) => match[0].length));
      const fence = "`".repeat(longest + 1);
      result = `${fence}${block.lang ?? ""}\n${text}\n${fence}`;
      break;
    }
    default: result = block.raw;
  }
  return result.replace(/\n/g, newline);
}

/** head·각 블록 원문·원래 구분 공백을 이어 붙여 무수정 라운드트립을 보장한다. */
export function serializeEditorMarkdown(document: MarkdownDocument): string {
  return document.head + document.blocks.map((block) => blockMarkdown(block, document.newline) + block.after).join("");
}

/** 구조 변경 뒤 이웃 블록이 하나의 목록·문단으로 합쳐지지 않게 경계만 보강한다. */
export function ensureBlockBoundaries(document: MarkdownDocument): MarkdownDocument {
  const blocks = document.blocks.map((block, index) => {
    const next = document.blocks[index + 1];
    if (!next) return block;
    const needed = block.type === next.type && ["ul", "ol", "todo"].includes(block.type) ? 1 : 2;
    // HTML·들여쓴 코드의 raw slice가 개행으로 끝나기도 하므로 after만 세면 원문 빈 줄을 늘린다.
    const whitespace = (blockMarkdown(block, document.newline) + block.after).match(/[ \t\r\n]*$/)?.[0] ?? "";
    const present = whitespace.match(/\r?\n/g)?.length ?? 0;
    return present >= needed ? block : { ...block, after: block.after + document.newline.repeat(needed - present) };
  });
  return { ...document, blocks };
}
