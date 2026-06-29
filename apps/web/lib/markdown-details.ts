import type { Root, RootContent } from "mdast";
import { mathSourceMask, parseMathMarkdown } from "./math-syntax";

type Boundary = "details-open" | "details-close" | "summary-open" | "summary-close";
type Replacement = { start: number; end: number; boundary?: Boundary; fallback?: string };
type OffsetShift = { originalStart: number; originalEnd: number; modifiedStart: number; modifiedEnd: number };
type PositionedNode = { position?: { start: { offset?: number }; end: { offset?: number } }; children?: PositionedNode[] };
type Frame = { summarySeen: boolean; summaryOpen: boolean; contentStart: number };
type SafeNode = RootContent & { children: RootContent[]; data: { hName: string } };

const MAX_DEPTH = 8;
const MAX_BOUNDARIES = 2048;
const DEFAULT_SUMMARY = "펼치기";

/** Markdown 코드 구간의 태그 예제를 접기 문법으로 오인하지 않도록 위치를 표시한다. */
function codeMask(source: string): Uint8Array {
  const mask = new Uint8Array(source.length);
  let fence: { character: string; length: number } | null = null;
  let start = 0;
  while (start < source.length) {
    const next = source.indexOf("\n", start);
    const end = next < 0 ? source.length : next + 1;
    const line = source.slice(start, end).replace(/\r?\n$/, "");
    if (fence) {
      mask.fill(1, start, end);
      const close = line.match(/^ {0,3}(`+|~+)[ \t]*$/);
      if (close && close[1][0] === fence.character && close[1].length >= fence.length) fence = null;
    } else {
      const open = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
      if (open && !(open[1][0] === "`" && open[2].includes("`"))) {
        fence = { character: open[1][0], length: open[1].length };
        mask.fill(1, start, end);
      } else if (/^(?: {4}|\t)/.test(line)) {
        mask.fill(1, start, end);
      }
    }
    start = end;
  }

  const markInlineCode = (from: number, to: number) => {
    const runs: { start: number; end: number; length: number }[] = [];
    for (let index = from; index < to;) {
      if (mask[index] || source[index] !== "`") { index++; continue; }
      let end = index + 1;
      while (end < to && source[end] === "`" && !mask[end]) end++;
      runs.push({ start: index, end, length: end - index });
      index = end;
    }
    const nextSame: (number | undefined)[] = Array(runs.length);
    const nextByLength = new Map<number, number>();
    for (let index = runs.length - 1; index >= 0; index--) {
      nextSame[index] = nextByLength.get(runs[index].length);
      nextByLength.set(runs[index].length, index);
    }
    for (let index = 0; index < runs.length;) {
      const closing = nextSame[index];
      if (closing === undefined) { index++; continue; }
      mask.fill(1, runs[index].start, runs[closing].end);
      index = closing + 1;
    }
  };
  const blank = /\r?\n[ \t]*\r?\n/g;
  let paragraphStart = 0;
  for (const match of source.matchAll(blank)) {
    markInlineCode(paragraphStart, match.index);
    paragraphStart = match.index + match[0].length;
  }
  markInlineCode(paragraphStart, source.length);
  const mathMask = mathSourceMask(source);
  for (let index = 0; index < mask.length; index++) if (mathMask[index]) mask[index] = 1;
  return mask;
}

/** 따옴표 안의 `>`와 태그 비슷한 문자열을 건너뛰며 HTML 태그 끝을 찾는다. */
function tagEnd(source: string, start: number): number {
  let quote = "";
  for (let index = start + 1; index < source.length; index++) {
    const character = source[index];
    if (quote) {
      if (character === quote) quote = "";
    } else if (character === "'" || character === '"') {
      quote = character;
    } else if (character === ">") {
      return index + 1;
    }
  }
  return source.length;
}

/** 하나의 접기 범위를 검사하고, 불명확한 HTML은 범위 전체를 원문 표시로 돌린다. */
function readGroup(source: string, start: number, mask: Uint8Array): { end: number; safe: boolean; boundaries: Replacement[] } {
  const frames: Frame[] = [];
  const boundaries: Replacement[] = [];
  let safe = true;
  for (let index = start; index < source.length;) {
    if (mask[index] || source[index] !== "<") { index++; continue; }
    let escapes = 0;
    for (let back = index - 1; back >= 0 && source[back] === "\\"; back--) escapes++;
    if (escapes % 2) { index++; continue; }
    if (source.startsWith("<!--", index)) {
      safe = false;
      const end = source.indexOf("-->", index + 4);
      index = end < 0 ? source.length : end + 3;
      continue;
    }
    if (!/^<\/?[a-z]/i.test(source.slice(index, index + 3))) { index++; continue; }
    const end = tagEnd(source, index);
    const raw = source.slice(index, end);
    const general = raw.match(/^<\/?([a-z][\w:-]*)\b/i);
    if (!general) { index = end; continue; }
    const name = general[1].toLowerCase();
    if (name !== "details" && name !== "summary") {
      safe = false;
      if (/^(script|style|iframe|pre|code|textarea)$/.test(name) && !raw.startsWith("</")) {
        const closing = new RegExp(`</${name}\\s*>`, "ig");
        closing.lastIndex = end;
        const match = closing.exec(source);
        index = match ? closing.lastIndex : source.length;
      } else {
        index = end;
      }
      continue;
    }
    const exact = raw.match(/^<(\/)?(details|summary)\s*>$/i);
    if (!exact) safe = false;
    const closing = raw.startsWith("</");
    if (name === "details") {
      if (closing) {
        const frame = frames.pop();
        if (!frame || frame.summaryOpen) safe = false;
        boundaries.push({ start: index, end, boundary: "details-close" });
        if (frames.length === 0) return { end, safe, boundaries };
      } else {
        if (frames.at(-1)?.summaryOpen) safe = false;
        frames.push({ summarySeen: false, summaryOpen: false, contentStart: end });
        if (frames.length > MAX_DEPTH) safe = false;
        boundaries.push({ start: index, end, boundary: "details-open" });
      }
    } else {
      const frame = frames.at(-1);
      if (!frame) safe = false;
      else if (closing) {
        if (!frame.summaryOpen) safe = false;
        frame.summaryOpen = false;
        boundaries.push({ start: index, end, boundary: "summary-close" });
      } else {
        if (frame.summarySeen || frame.summaryOpen) safe = false;
        if (source.slice(frame.contentStart, index).trim()) safe = false;
        frame.summarySeen = true;
        frame.summaryOpen = true;
        boundaries.push({ start: index, end, boundary: "summary-open" });
      }
    }
    if (boundaries.length > MAX_BOUNDARIES) safe = false;
    index = end;
  }
  return { end: source.length, safe: false, boundaries };
}

/** 원본 AST에서 블록 HTML로 확인된 접기 시작점만 수집한다. */
function starts(root: Root): number[] {
  const positions: number[] = [];
  for (const child of root.children) {
    if (child.type !== "html") continue;
    const match = child.value.match(/^ {0,3}<details\b/i);
    const offset = child.position?.start.offset;
    if (match && offset !== undefined) positions.push(offset + match[0].indexOf("<"));
  }
  return positions;
}

/** 마커를 노출 원문과 충돌하지 않는 문단 텍스트로 선택한다. */
function markerPrefix(source: string): string {
  let number = 0;
  while (source.includes(`KENBLOGSAFEDETAILS${number}BOUNDARY`)) number++;
  return `KENBLOGSAFEDETAILS${number}BOUNDARY`;
}

/** 마커 문단인지 검사한다. */
function markerIndex(node: RootContent, prefix: string): number | null {
  if (node.type !== "paragraph" || node.children.length !== 1 || node.children[0].type !== "text") return null;
  const match = node.children[0].value.match(new RegExp(`^${prefix}([0-9]+)END$`));
  return match ? Number(match[1]) : null;
}

/** 접기 마커 치환 전후의 길이 차이로 바뀐 offset을 원문 위치로 되돌린다. */
function originalOffset(offset: number, shifts: OffsetShift[], endBoundary: boolean): number {
  let left = 0;
  let right = shifts.length;
  while (left < right) {
    const middle = (left + right) >>> 1;
    if (shifts[middle].modifiedStart <= offset) left = middle + 1;
    else right = middle;
  }
  const shift = shifts[left - 1];
  if (!shift) return offset;
  if (offset === shift.modifiedStart) return shift.originalStart;
  if (offset < shift.modifiedEnd) return endBoundary ? shift.originalEnd : shift.originalStart;
  return offset + shift.originalEnd - shift.modifiedEnd;
}

/** 원본의 CRLF도 한 줄로 세며 각 줄의 시작 offset을 모은다. */
function lineStarts(source: string): number[] {
  const starts = [0];
  for (let index = 0; index < source.length; index++) if (source[index] === "\n") starts.push(index + 1);
  return starts;
}

/** 원본 offset으로 unist의 행·열·offset을 다시 계산한다. */
function sourcePoint(starts: number[], offset: number): { line: number; column: number; offset: number } {
  let left = 0;
  let right = starts.length;
  while (left < right) {
    const middle = (left + right) >>> 1;
    if (starts[middle] <= offset) left = middle + 1;
    else right = middle;
  }
  return { line: left, column: offset - starts[left - 1] + 1, offset };
}

/** 수식 파서가 복원한 수정 문자열 위치를 다시 실제 게시글 원문 위치로 옮긴다. */
function restoreSourcePositions(root: Root, source: string, shifts: OffsetShift[]): void {
  const starts = lineStarts(source);
  const visit = (node: PositionedNode) => {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start !== undefined && end !== undefined) {
      node.position = { start: sourcePoint(starts, originalOffset(start, shifts, false)),
        end: sourcePoint(starts, originalOffset(end, shifts, true)) };
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(root as PositionedNode);
}

/** 원래의 참조 링크·각주 정의를 공유하는 단일 AST 안에서 안전한 접기 노드를 조립한다. */
function groupNodes(root: Root, replacements: Replacement[], prefix: string, source: string): Root | null {
  const output: RootContent[] = [];
  const stack: { details: SafeNode; target: RootContent[]; parent: RootContent[]; start: number; invalid: boolean; summary?: RootContent[] }[] = [];
  const append = (node: RootContent) => (stack.at(-1)?.target ?? output).push(node);
  let used = 0;
  for (const node of root.children) {
    const index = markerIndex(node, prefix);
    if (index === null) { append(node); continue; }
    const replacement = replacements[index];
    if (!replacement) return null;
    used++;
    if (replacement.fallback !== undefined) {
      append({ type: "code", value: replacement.fallback });
      continue;
    }
    if (replacement.boundary === "details-open") {
      const details = { type: "safeDetails", data: { hName: "details" }, children: [] } as unknown as SafeNode;
      const parent = stack.at(-1)?.target ?? output;
      parent.push(details);
      stack.push({ details, target: details.children, parent, start: replacement.start, invalid: false });
    } else if (replacement.boundary === "details-close") {
      if (!stack.length) return null;
      const current = stack.pop()!;
      if (current.summary) current.invalid = true;
      if (current.invalid) {
        const position = current.parent.indexOf(current.details);
        if (position < 0) return null;
        current.parent[position] = { type: "code", value: source.slice(current.start, replacement.end) };
      } else if (!current.details.children.some((child) => (child as SafeNode).data?.hName === "summary")) {
        current.details.children.unshift({ type: "safeSummary", data: { hName: "summary" }, children: [{ type: "text", value: DEFAULT_SUMMARY }] } as unknown as RootContent);
      }
    } else if (replacement.boundary === "summary-open") {
      const current = stack.at(-1);
      if (!current || current.summary) return null;
      current.summary = [];
      current.target = current.summary;
    } else if (replacement.boundary === "summary-close") {
      const current = stack.at(-1);
      if (!current?.summary) return null;
      const parts = current.summary;
      if (parts.length > 1 || parts.some((part) => part.type !== "paragraph" && part.type !== "text")) {
        current.invalid = true;
      } else {
        const children = parts.flatMap((part) => part.type === "paragraph" ? part.children : [part]);
        current.details.children.push({ type: "safeSummary", data: { hName: "summary" }, children: children.length ? children : [{ type: "text", value: DEFAULT_SUMMARY }] } as unknown as RootContent);
      }
      current.summary = undefined;
      current.target = current.details.children;
    }
  }
  if (stack.length || used !== replacements.length) return null;
  root.children = output;
  return root;
}

/** 안전한 접기 태그만 단일 Markdown 문서 AST의 네이티브 disclosure 노드로 변환한다. */
export function remarkSafeDetails() {
  return (root: Root, file: { value: unknown }) => {
    const source = String(file.value);
    const candidates = starts(root);
    if (!candidates.length) return;
    const mask = codeMask(source);
    const replacements: Replacement[] = [];
    let cursor = 0;
    for (const candidate of candidates) {
      if (candidate < cursor || mask[candidate]) continue;
      let next = candidate;
      while (next < source.length && !mask[next]) {
        const group = readGroup(source, next, mask);
        if (!group.safe) replacements.push({ start: next, end: group.end, fallback: source.slice(next, group.end) });
        else replacements.push(...group.boundaries);
        cursor = group.end;
        if (replacements.length > MAX_BOUNDARIES) break;
        // 한 HTML 블록에 같은 줄로 이어 쓴 형제 접기도 각각 보존한다.
        const sibling = source.slice(cursor).match(/^\s*<details\b/i);
        if (!sibling) break;
        next = cursor + sibling[0].indexOf("<");
      }
      if (replacements.length > MAX_BOUNDARIES) break;
    }
    if (!replacements.length) return;
    if (replacements.length > MAX_BOUNDARIES) {
      root.children = [{ type: "code", value: source }];
      return;
    }
    const prefix = markerPrefix(source);
    let modified = "";
    let from = 0;
    const shifts: OffsetShift[] = [];
    replacements.forEach((item, index) => {
      modified += source.slice(from, item.start);
      const modifiedStart = modified.length;
      modified += `\n\n${prefix}${index}END\n\n`;
      shifts.push({ originalStart: item.start, originalEnd: item.end,
        modifiedStart, modifiedEnd: modified.length });
      from = item.end;
    });
    modified += source.slice(from);
    const parsed = parseMathMarkdown(modified);
    restoreSourcePositions(parsed, source, shifts);
    const grouped = groupNodes(parsed, replacements, prefix, source);
    root.children = grouped?.children ?? [{ type: "code", value: source }];
  };
}
