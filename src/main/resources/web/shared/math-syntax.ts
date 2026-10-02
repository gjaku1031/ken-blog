import type { Root, RootContent } from "mdast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

/**
 * 원문의 수식 범위와 GFM 파서에 건네는 자리표시자의 대응
 */
type MathRange = {
  /**
   * 구간 시작 위치
   */
  start: number;
  /**
   * 구간 끝 위치
   */
  end: number;
  /**
   * 노드 값
   */
  value: string;
  /**
   * 블록 수식 여부
   */
  display: boolean;
  /**
   * 충돌 방지용 치환 마커
   */
  marker: string;
  /**
   * 원문 표시 여부
   */
  raw?: boolean;
  /**
   * 치환 후 시작 위치
   */
  transformedStart: number;
  /**
   * 치환 후 끝 위치
   */
  transformedEnd: number;
};

/**
 * 파서가 먼저 인식한 코드·주소·이미지 설명 등의 수식 제외 영역
 */
type PositionedNode = {
  /**
   * 종류
   */
  type: string;
  /**
   * 문서 내 위치
   */
  position?: {
    /**
     * 구간 시작 위치
     */
    start: {
      /**
       * 원문 오프셋
       */
      offset?: number
    };
    /**
     * 구간 끝 위치
     */
    end: {
      /**
       * 원문 오프셋
       */
      offset?: number
    }
  };
  /**
   * 하위 AST 노드
   */
  children?: PositionedNode[]
};

/**
 * 공유 GFM Markdown 파서
 */
const parser = unified().use(remarkParse).use(remarkGfm);
/**
 * 독립된 블록 수식 구분자 패턴
 */
const BLOCK_DELIMITER = /^ {0,3}\$\$[ \t]*$/;

/**
 * 코드와 이미지 전체, 링크의 주소 부분에 들어 있는 달러를 보호함
 *
 * 1. AST에서 코드·수식·링크 등 제외 구간 수집
 * 2. HTML 여닫는 태그 사이의 텍스트도 제외
 * 3. 닫히지 않은 HTML은 문서 끝까지 제외
 */
function excludedMasks(source: string): {
  /**
   * 인라인 문법 제외 구간
   */
  inline: Uint8Array;
  /**
   * 블록 문법 제외 구간
   */
  block: Uint8Array;
  /**
   * 치환 전 AST
   */
  original: Root
} {
  const mask = new Uint8Array(source.length);
  const blockMask = new Uint8Array(source.length);
  const original = parser.parse(source) as Root;
  const root = original as PositionedNode;
  const html: Array<{
    /**
     * 구간 시작 위치
     */
    start: number;
    /**
     * 구간 끝 위치
     */
    end: number
  }> = [];
  /**
   * 파싱 제외 구간 표시
   */
  const cover = (start: number, end: number) => { mask.fill(1, start, end); blockMask.fill(1, start, end); };
  /**
   * 현재 노드와 하위 노드 순회
   */
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
      // 링크의 표시 문구는 수식을 허용하되, 괄호·참조 식별자·주소는 건드리지 않음
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
  // AST에서 코드·수식·링크 등 제외 구간 수집
  visit(root);
  // 인라인 raw HTML의 여는/닫는 태그는 별도 AST 노드이므로 사이의 텍스트도 보수적으로 보호함
  // HTML 여닫는 태그 사이의 텍스트도 제외
  const stack: Array<{
    /**
     * 이름
     */
    name: string;
    /**
     * 구간 시작 위치
     */
    start: number
  }> = [];
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
  // 닫히지 않은 HTML은 문서 끝까지 제외
  for (const open of stack) cover(open.start, source.length);
  return { inline: mask, block: blockMask, original };
}

/**
 * 원문의 줄 범위를 개행 문자를 유지한 채 수집함
 */
function lines(source: string): Array<{
  /**
   * 구간 시작 위치
   */
  start: number;
  /**
   * 구간 끝 위치
   */
  end: number;
  /**
   * 다음 탐색 위치
   */
  next: number;
  /**
   * 표시 텍스트
   */
  text: string
}> {
  const result: Array<{
    /**
     * 구간 시작 위치
     */
    start: number;
    /**
     * 구간 끝 위치
     */
    end: number;
    /**
     * 다음 탐색 위치
     */
    next: number;
    /**
     * 표시 텍스트
     */
    text: string
  }> = [];
  for (let start = 0; start < source.length;) {
    const newline = source.indexOf("\n", start);
    const next = newline < 0 ? source.length : newline + 1;
    const end = newline < 0 ? next : source[newline - 1] === "\r" ? newline - 1 : newline;
    result.push({ start, end, next, text: source.slice(start, end) });
    start = next;
  }
  return result;
}

/**
 * 독립된 두 `$$` 줄 사이만 블록 수식으로 취급하고 미닫힌 입력은 돌려놓음
 *
 * 1. 줄별 독립 구분자와 한 줄 블록 수식 탐색
 * 2. 닫히지 않은 블록은 남은 원문으로 보존
 * 3. 닫힌 블록만 수식 범위로 수집
 */
function blockRanges(source: string, mask: Uint8Array): MathRange[] {
  const sourceLines = lines(source);
  const result: MathRange[] = [];
  // 줄별 독립 구분자와 한 줄 블록 수식 탐색
  for (let index = 0; index < sourceLines.length; index++) {
    const opening = sourceLines[index];
    const compact = /^ {0,3}\$\$([^$\r\n]+)\$\$[ \t]*$/.exec(opening.text);
    if (compact && !mask[opening.start + opening.text.indexOf("$")]) {
      result.push({ start: opening.start, end: opening.end, value: compact[1], display: true,
        marker: "", transformedStart: 0, transformedEnd: 0 });
      continue;
    }
    const marker = BLOCK_DELIMITER.exec(opening.text);
    if (!marker || mask[opening.start + marker[0].indexOf("$")]) continue;
    let closeIndex = index + 1;
    while (closeIndex < sourceLines.length && !BLOCK_DELIMITER.test(sourceLines[closeIndex].text)) closeIndex++;
    // 닫히지 않은 블록은 남은 원문으로 보존
    if (closeIndex === sourceLines.length) {
      result.push({ start: opening.start, end: source.length, value: source.slice(opening.start), display: true,
        raw: true, marker: "", transformedStart: 0, transformedEnd: 0 });
      break;
    }
    const closing = sourceLines[closeIndex];
    // 닫힌 블록만 수식 범위로 수집
    const body = source.slice(opening.next, closing.start).replace(/\r?\n$/, "");
    result.push({ start: opening.start, end: closing.end, value: body, display: true,
      marker: "", transformedStart: 0, transformedEnd: 0 });
    index = closeIndex;
  }
  return result;
}

/**
 * 바로 앞 역슬래시의 홀짝으로 Markdown 이스케이프 여부를 판단함
 */
function escaped(source: string, position: number): boolean {
  let count = 0;
  for (let index = position - 1; index >= 0 && source[index] === "\\"; index--) count++;
  return count % 2 === 1;
}

/**
 * 엄격한 한 쌍의 단일 달러만 인라인 수식으로 모음
 *
 * 1. 블록 수식을 먼저 확정해 인라인 중복 해석 방지
 * 2. 같은 줄의 이스케이프되지 않은 닫는 달러 검색
 * 3. 공백·연속 달러·숫자 인접 조건 검사 후 범위 수집
 */
function mathRanges(source: string, masks: {
  /**
   * 인라인 문법 제외 구간
   */
  inline: Uint8Array;
  /**
   * 블록 문법 제외 구간
   */
  block: Uint8Array
}): MathRange[] {
  // 블록 수식을 먼저 확정해 인라인 중복 해석 방지
  const blocks = blockRanges(source, masks.block);
  const result = [...blocks];
  let blockIndex = 0;
  for (let index = 0; index < source.length; index++) {
    const block = blocks[blockIndex];
    if (block && index >= block.start) { index = block.end - 1; blockIndex++; continue; }
    if (source[index] !== "$" || masks.inline[index] || escaped(source, index) ||
      source[index - 1] === "$" || source[index + 1] === "$" ||
      source[index + 1] === undefined || /\s/.test(source[index + 1])) continue;
    // 같은 줄의 이스케이프되지 않은 닫는 달러 검색
    let closing = index + 1;
    while (closing < source.length && source[closing] !== "\r" && source[closing] !== "\n") {
      // 공백·연속 달러·숫자 인접 조건 검사 후 범위 수집
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

/**
 * 안전 접기 태그 검사에서 수식 안의 HTML처럼 보이는 TeX를 무시할 위치를 반환함
 */
export function mathSourceMask(source: string): Uint8Array {
  const mask = new Uint8Array(source.length);
  for (const range of mathRanges(source, excludedMasks(source))) mask.fill(1, range.start, range.end);
  return mask;
}

/**
 * 원문과 충돌하지 않는 자리표시자로 수식을 잠시 가려 Markdown 우선순위를 보존함
 *
 * 1. 원문과 충돌하지 않는 마커 접두사 선택
 * 2. 블록·인라인 구분을 유지하며 치환 위치 기록
 */
function prepare(source: string, ranges: MathRange[]): string {
  // 원문과 충돌하지 않는 마커 접두사 선택
  let serial = 0;
  while (source.includes(`KENBLOGMATH${serial}BOUNDARY`)) serial++;
  const prefix = `KENBLOGMATH${serial}BOUNDARY`;
  let transformed = "";
  let cursor = 0;
  // 블록·인라인 구분을 유지하며 치환 위치 기록
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

/**
 * 자리표시자로 달라진 offset을 원문 위치로 다시 옮김
 *
 * 1. 치환 시작점 기준 이분 탐색
 * 2. 치환 내부는 요청한 경계로, 외부는 누적 길이 차이로 복원
 */
function originalOffset(offset: number, ranges: MathRange[], endBoundary: boolean): number {
  // 치환 시작점 기준 이분 탐색
  let left = 0;
  let right = ranges.length;
  while (left < right) {
    const middle = (left + right) >>> 1;
    if (ranges[middle].transformedStart <= offset) left = middle + 1;
    else right = middle;
  }
  const range = ranges[left - 1];
  // 치환 내부는 요청한 경계로, 외부는 누적 길이 차이로 복원
  if (!range) return offset;
  if (offset === range.transformedStart) return range.start;
  if (offset < range.transformedEnd) return endBoundary ? range.end : range.start;
  return offset + range.end - range.transformedEnd;
}

/**
 * 원문의 개행 시작점을 한 번만 모아 위치 복원을 로그 시간으로 제한함
 */
function lineStarts(source: string): number[] {
  const starts = [0];
  for (let index = 0; index < source.length; index++) if (source[index] === "\n") starts.push(index + 1);
  return starts;
}

/**
 * 원문의 offset으로 행·열을 다시 계산함
 *
 * 1. 오프셋이 속한 원문 줄을 이분 탐색
 * 2. 원문 기준 행·열·오프셋 반환
 */
function sourcePoint(starts: number[], offset: number): {
  /**
   * 행 번호
   */
  line: number;
  /**
   * 열 번호
   */
  column: number;
  /**
   * 원문 오프셋
   */
  offset: number
} {
  // 오프셋이 속한 원문 줄을 이분 탐색
  let left = 0;
  let right = starts.length;
  while (left < right) {
    const middle = (left + right) >>> 1;
    if (starts[middle] <= offset) left = middle + 1;
    else right = middle;
  }
  // 원문 기준 행·열·오프셋 반환
  return { line: left, column: offset - starts[left - 1] + 1, offset };
}

/**
 * TeX 원문을 안전한 text child로 전달하는 읽기용 mdast 노드를 만듦
 */
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

/**
 * 자리표시자 텍스트를 수식 노드로 치환하며 주변 Markdown 노드는 유지함
 *
 * 1. 마커별 수식 범위 조회 준비
 * 2. 마커만 있는 문단을 블록 수식으로 복원
 * 3. 텍스트 속 마커를 인라인 수식으로 복원
 * 4. 하위 문서까지 복원한 결과 반영
 */
function restoreNodes(root: Root, ranges: MathRange[], starts: number[]): void {
  // 마커별 수식 범위 조회 준비
  const byMarker = new Map(ranges.map((range) => [range.marker, range]));
  const markers = ranges.length ? new RegExp([...byMarker.keys()].map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "g") : null;
  /**
   * 현재 노드와 하위 노드 순회
   */
  const visit = (children: RootContent[]): RootContent[] => {
    const output: RootContent[] = [];
    for (const node of children) {
      const typed = node as RootContent & {
        /**
         * 노드 값
         */
        value?: string;
        /**
         * 하위 AST 노드
         */
        children?: RootContent[]
      };
      // 마커만 있는 문단을 블록 수식으로 복원
      if (node.type === "paragraph" && typed.children?.length === 1 && typed.children[0].type === "text") {
        const text = (typed.children[0] as {
          /**
           * 노드 값
           */
          value: string
        }).value;
        const block = byMarker.get(text);
        if (block?.display) { output.push(mathNode(block, starts)); continue; }
      }
      // 텍스트 속 마커를 인라인 수식으로 복원
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
  // 하위 문서까지 복원한 결과 반영
  root.children = visit(root.children);
}

/**
 * 수식 이외 노드의 위치를 원문 offset과 LF/CRLF 행·열로 복원함
 */
function restorePositions(node: PositionedNode, ranges: MathRange[], starts: number[]): void {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (start !== undefined && end !== undefined && !node.type.startsWith("kenMath")) {
    node.position = { start: sourcePoint(starts, originalOffset(start, ranges, false)),
      end: sourcePoint(starts, originalOffset(end, ranges, true)) };
  }
  for (const child of node.children ?? []) restorePositions(child, ranges, starts);
}

/**
 * 모든 사용처가 공유하는 수식 우선 Markdown 파싱 결과를 반환함
 *
 * 1. 제외 구간과 블록·인라인 수식 범위 확인
 * 2. 수식을 마커로 치환한 뒤 Markdown 파싱
 * 3. 수식 노드와 원문 위치 복원
 */
export function parseMathMarkdown(source: string): Root {
  // 제외 구간과 블록·인라인 수식 범위 확인
  const masks = excludedMasks(source);
  const ranges = mathRanges(source, masks);
  if (!ranges.length) return masks.original;
  // 수식을 마커로 치환한 뒤 Markdown 파싱
  const transformed = prepare(source, ranges);
  const root = parser.parse(transformed) as Root;
  const starts = lineStarts(source);
  // 수식 노드와 원문 위치 복원
  restoreNodes(root, ranges, starts);
  restorePositions(root as PositionedNode, ranges, starts);
  return root;
}
