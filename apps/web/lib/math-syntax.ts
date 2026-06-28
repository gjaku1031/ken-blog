import type { Root, RootContent } from "mdast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

/** 원문의 수식 범위와 GFM 파서에 건네는 자리표시자의 대응. */
type MathRange = {
  start: number; end: number; value: string; display: boolean; marker: string;
  raw?: boolean;
  transformedStart: number; transformedEnd: number;
};

/** 파서가 먼저 인식한 코드·주소·이미지 설명 등의 수식 제외 영역. */
type PositionedNode = { type: string; position?: { start: { offset?: number }; end: { offset?: number } };
  children?: PositionedNode[] };

const parser = unified().use(remarkParse).use(remarkGfm);
const BLOCK_DELIMITER = /^ {0,3}\$\$[ \t]*$/;

/** 코드와 이미지 전체, 링크의 주소 부분에 들어 있는 달러를 보호한다. */
function excludedMasks(source: string): { inline: Uint8Array; block: Uint8Array; original: Root } {
  const mask = new Uint8Array(source.length);
  const blockMask = new Uint8Array(source.length);
  const original = parser.parse(source) as Root;
  const root = original as PositionedNode;
  const html: Array<{ start: number; end: number }> = [];
  const cover = (start: number, end: number) => { mask.fill(1, start, end); blockMask.fill(1, start, end); };
  const visit = (node: PositionedNode) => {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start !== undefined && end !== undefined && ["list", "listItem", "blockquote", "table"].includes(node.type)) {
      blockMask.fill(1, start, end);
    }
    if (start !== undefined && end !== undefined &&
      ["code", "inlineCode", "html", "definition", "image", "imageReference"].includes(node.type)) {
      cover(start, end);
      if (node.type === "html") html.push({ start, end });
      return;
    }
    if (start !== undefined && end !== undefined && (node.type === "link" || node.type === "linkReference")) {
      // 링크의 표시 문구는 수식을 허용하되, 괄호·참조 식별자·주소는 건드리지 않는다.
      if (source[start] === "<") { cover(start, end); return; }
      let cursor = start;
      for (const child of node.children ?? []) {
        const childStart = child.position?.start.offset;
        const childEnd = child.position?.end.offset;
        if (childStart === undefined || childEnd === undefined) { cover(start, end); return; }
        cover(cursor, childStart);
        visit(child);
        cursor = childEnd;
      }
      cover(cursor, end);
      return;
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(root);
  // 인라인 raw HTML의 여는/닫는 태그는 별도 AST 노드이므로 사이의 텍스트도 보수적으로 보호한다.
  const stack: Array<{ name: string; start: number }> = [];
  for (const item of html.sort((left, right) => left.start - right.start)) {
    const raw = source.slice(item.start, item.end);
    const tag = /^<(\/)?([A-Za-z][\w:-]*)(?:\s[^>]*)?>$/.exec(raw);
    if (!tag) continue;
    const name = tag[2].toLowerCase();
    if (name === "details" || name === "summary") continue;
    if (tag[1]) {
      const index = stack.findLastIndex((open) => open.name === name);
      if (index >= 0) { cover(stack[index].start, item.end); stack.length = index; }
    } else if (!/\/>$/.test(raw) && !/^(?:br|hr|img|input|meta|link|source|wbr)$/.test(name)) {
      stack.push({ name, start: item.start });
    }
  }
  for (const open of stack) cover(open.start, source.length);
  return { inline: mask, block: blockMask, original };
}

/** 원문의 줄 범위를 개행 문자를 유지한 채 수집한다. */
function lines(source: string): Array<{ start: number; end: number; next: number; text: string }> {
  const result: Array<{ start: number; end: number; next: number; text: string }> = [];
  for (let start = 0; start < source.length;) {
    const newline = source.indexOf("\n", start);
    const next = newline < 0 ? source.length : newline + 1;
    const end = newline < 0 ? next : source[newline - 1] === "\r" ? newline - 1 : newline;
    result.push({ start, end, next, text: source.slice(start, end) });
    start = next;
  }
  return result;
}

/** 독립된 두 `$$` 줄 사이만 블록 수식으로 취급하고 미닫힌 입력은 돌려놓는다. */
function blockRanges(source: string, mask: Uint8Array): MathRange[] {
  const sourceLines = lines(source);
  const result: MathRange[] = [];
  for (let index = 0; index < sourceLines.length; index++) {
    const opening = sourceLines[index];
    const marker = BLOCK_DELIMITER.exec(opening.text);
    if (!marker || mask[opening.start + marker[0].indexOf("$")]) continue;
    let closeIndex = index + 1;
    while (closeIndex < sourceLines.length && !BLOCK_DELIMITER.test(sourceLines[closeIndex].text)) closeIndex++;
    if (closeIndex === sourceLines.length) {
      result.push({ start: opening.start, end: source.length, value: source.slice(opening.start), display: true,
        raw: true, marker: "", transformedStart: 0, transformedEnd: 0 });
      break;
    }
    const closing = sourceLines[closeIndex];
    const body = source.slice(opening.next, closing.start).replace(/\r?\n$/, "");
    result.push({ start: opening.start, end: closing.end, value: body, display: true,
      marker: "", transformedStart: 0, transformedEnd: 0 });
    index = closeIndex;
  }
  return result;
}

/** 바로 앞 역슬래시의 홀짝으로 Markdown 이스케이프 여부를 판단한다. */
function escaped(source: string, position: number): boolean {
  let count = 0;
  for (let index = position - 1; index >= 0 && source[index] === "\\"; index--) count++;
  return count % 2 === 1;
}

/** 엄격한 한 쌍의 단일 달러만 인라인 수식으로 모은다. */
function mathRanges(source: string, masks: { inline: Uint8Array; block: Uint8Array }): MathRange[] {
  const blocks = blockRanges(source, masks.block);
  const result = [...blocks];
  let blockIndex = 0;
  for (let index = 0; index < source.length; index++) {
    const block = blocks[blockIndex];
    if (block && index >= block.start) { index = block.end - 1; blockIndex++; continue; }
    if (source[index] !== "$" || masks.inline[index] || escaped(source, index) ||
      source[index - 1] === "$" || source[index + 1] === "$" ||
      source[index + 1] === undefined || /\s/.test(source[index + 1])) continue;
    let closing = index + 1;
    while (closing < source.length && source[closing] !== "\r" && source[closing] !== "\n") {
      if (source[closing] === "$" && !escaped(source, closing)) break;
      closing++;
    }
    if (source[closing] !== "$" || closing >= source.length || /\s/.test(source[closing - 1]) ||
      source[closing + 1] === "$" || /[0-9]/.test(source[closing + 1] ?? "")) continue;
    result.push({ start: index, end: closing + 1, value: source.slice(index + 1, closing), display: false,
      marker: "", transformedStart: 0, transformedEnd: 0 });
    index = closing;
  }
  return result.sort((left, right) => left.start - right.start);
}

/** 안전 접기 태그 검사에서 수식 안의 HTML처럼 보이는 TeX를 무시할 위치를 반환한다. */
export function mathSourceMask(source: string): Uint8Array {
  const mask = new Uint8Array(source.length);
  for (const range of mathRanges(source, excludedMasks(source))) mask.fill(1, range.start, range.end);
  return mask;
}

/** 원문과 충돌하지 않는 자리표시자로 수식을 잠시 가려 Markdown 우선순위를 보존한다. */
function prepare(source: string, ranges: MathRange[]): string {
  let serial = 0;
  while (source.includes(`KENBLOGMATH${serial}BOUNDARY`)) serial++;
  const prefix = `KENBLOGMATH${serial}BOUNDARY`;
  let transformed = "";
  let cursor = 0;
  for (let index = 0; index < ranges.length; index++) {
    const range = ranges[index];
    const marker = `${prefix}${range.display ? "B" : "I"}${index}END`;
    const replacement = range.display ? `\n\n${marker}\n\n` : marker;
    transformed += source.slice(cursor, range.start);
    range.marker = marker;
    range.transformedStart = transformed.length;
    transformed += replacement;
    range.transformedEnd = transformed.length;
    cursor = range.end;
  }
  return transformed + source.slice(cursor);
}

/** 자리표시자로 달라진 offset을 원문 위치로 다시 옮긴다. */
function originalOffset(offset: number, ranges: MathRange[], endBoundary: boolean): number {
  let left = 0;
  let right = ranges.length;
  while (left < right) {
    const middle = (left + right) >>> 1;
    if (ranges[middle].transformedStart <= offset) left = middle + 1;
    else right = middle;
  }
  const range = ranges[left - 1];
  if (!range) return offset;
  if (offset === range.transformedStart) return range.start;
  if (offset < range.transformedEnd) return endBoundary ? range.end : range.start;
  return offset + range.end - range.transformedEnd;
}

/** 원문의 개행 시작점을 한 번만 모아 위치 복원을 로그 시간으로 제한한다. */
function lineStarts(source: string): number[] {
  const starts = [0];
  for (let index = 0; index < source.length; index++) if (source[index] === "\n") starts.push(index + 1);
  return starts;
}

/** 원문의 offset으로 행·열을 다시 계산한다. */
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

/** TeX 원문을 안전한 text child로 전달하는 읽기용 mdast 노드를 만든다. */
function mathNode(range: MathRange, starts: number[]): RootContent {
  if (range.raw) return { type: "kenMathRaw", value: range.value,
    data: { hName: "pre", hChildren: [{ type: "text", value: range.value }] },
    position: { start: sourcePoint(starts, range.start), end: sourcePoint(starts, range.end) },
  } as unknown as RootContent;
  return { type: range.display ? "kenMathBlock" : "kenMathInline", value: range.value,
    data: { hName: range.display ? "div" : "span", hProperties: {
      className: [range.display ? "ken-math-block" : "ken-math-inline"],
    }, hChildren: [{ type: "text", value: range.value }] },
    position: { start: sourcePoint(starts, range.start), end: sourcePoint(starts, range.end) },
  } as unknown as RootContent;
}

/** 자리표시자 텍스트를 수식 노드로 치환하며 주변 Markdown 노드는 유지한다. */
function restoreNodes(root: Root, ranges: MathRange[], starts: number[]): void {
  const byMarker = new Map(ranges.map((range) => [range.marker, range]));
  const markers = ranges.length ? new RegExp([...byMarker.keys()].map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "g") : null;
  const visit = (children: RootContent[]): RootContent[] => {
    const output: RootContent[] = [];
    for (const node of children) {
      const typed = node as RootContent & { value?: string; children?: RootContent[] };
      if (node.type === "paragraph" && typed.children?.length === 1 && typed.children[0].type === "text") {
        const text = (typed.children[0] as { value: string }).value;
        const block = byMarker.get(text);
        if (block?.display) { output.push(mathNode(block, starts)); continue; }
      }
      if (node.type === "text" && markers && typeof typed.value === "string") {
        let cursor = 0;
        for (const match of typed.value.matchAll(markers)) {
          if (match.index > cursor) output.push({ type: "text", value: typed.value.slice(cursor, match.index) });
          const range = byMarker.get(match[0]);
          if (range) output.push(mathNode(range, starts));
          cursor = match.index + match[0].length;
        }
        if (cursor) {
          if (cursor < typed.value.length) output.push({ type: "text", value: typed.value.slice(cursor) });
          continue;
        }
      }
      if (typed.children) typed.children = visit(typed.children);
      output.push(node);
    }
    return output;
  };
  root.children = visit(root.children);
}

/** 수식 이외 노드의 위치를 원문 offset과 LF/CRLF 행·열로 복원한다. */
function restorePositions(node: PositionedNode, ranges: MathRange[], starts: number[]): void {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (start !== undefined && end !== undefined && !node.type.startsWith("kenMath")) {
    node.position = { start: sourcePoint(starts, originalOffset(start, ranges, false)),
      end: sourcePoint(starts, originalOffset(end, ranges, true)) };
  }
  for (const child of node.children ?? []) restorePositions(child, ranges, starts);
}

/** 모든 사용처가 공유하는 수식 우선 Markdown 파싱 결과를 반환한다. */
export function parseMathMarkdown(source: string): Root {
  const masks = excludedMasks(source);
  const ranges = mathRanges(source, masks);
  if (!ranges.length) return masks.original;
  const transformed = prepare(source, ranges);
  const root = parser.parse(transformed) as Root;
  const starts = lineStarts(source);
  restoreNodes(root, ranges, starts);
  restorePositions(root as PositionedNode, ranges, starts);
  return root;
}

/** React Markdown에서 GFM 뒤, 안전 접기 변환 앞에 등록할 수식 문법 플러그인. */
export function remarkMathSyntax() {
  return (root: Root, file: { value: unknown }) => {
    root.children = parseMathMarkdown(String(file.value)).children;
  };
}
