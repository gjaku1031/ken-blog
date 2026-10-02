import type { Root, RootContent } from "mdast";
import { annotationSourceMask, parseAnnotationMarkdown, type AnnotationItem } from "./annotation-syntax";
import { parseMathMarkdown } from "./math-syntax";

/**
 * 원문에서 검증된 위키 링크 하나
 * 제목만 대상 조회에 쓰고 표시명은 텍스트로만 사용함
 */
export type WikiLinkCandidate = {
  /**
   * 제목
   */
  title: string;

  /**
   * 표시 문구
   */
  label: string;

  /**
   * 원문
   */
  raw: string;

  /**
   * 구간 시작 위치
   */
  start: number;

  /**
   * 구간 끝 위치
   */
  end: number
};

/**
 * 원문 치환 구간
 */
type Replacement = WikiLinkCandidate & {
  /**
   * 충돌 방지용 치환 마커
   */
  marker: string;

  /**
   * 치환 후 시작 위치
   */
  transformedStart: number;

  /**
   * 치환 후 끝 위치
   */
  transformedEnd: number
};

/**
 * 원문 위치를 가진 AST 노드
 */
type PositionedNode = {
  /**
   * 종류
   */
  type: string;

  /**
   * 노드 값
   */
  value?: string;

  /**
   * 하위 AST 노드
   */
  children?: PositionedNode[];

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
   * AST 렌더 보조 정보
   */
  data?: Record<string, unknown>
};

/**
 * 파싱 원문 바이트 상한
 */
const MAX_SOURCE_BYTES = 1024 * 1024;

/**
 * 문법 후보 개수 상한
 */
const MAX_CANDIDATES = 512;

/**
 * 위키 제목 코드 포인트 수 상한
 */
const MAX_TITLE_CODEPOINTS = 200;

/**
 * 위키 표시명 코드 포인트 수 상한
 */
const MAX_LABEL_CODEPOINTS = 2048;

/**
 * 위키 문법을 해석하지 않는 노드 종류
 */
const EXCLUDED = new Set(["code", "inlineCode", "html", "definition", "image", "imageReference", "link"]);

/**
 * 제목·표시명에 허용하지 않는 문자
 */
const INVALID_CHARACTER = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\ud800-\udfff]/u;

/**
 * 수식·코드·이미지·기존 링크·HTML·주석 안쪽을 위키 후보에서 제외함
 *
 * 1. AST에서 코드·수식·링크 등 제외 구간 수집
 * 2. HTML 여닫는 태그 사이의 텍스트도 제외
 * 3. 닫히지 않은 HTML은 문서 끝까지 제외
 */
function excludedMask(source: string): Uint8Array {
  const mask = annotationSourceMask(source);
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
  const cover = (start: number, end: number) => mask.fill(1, start, end);

  /**
   * 현재 노드와 하위 노드 순회
   */
  const visit = (node: PositionedNode) => {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start !== undefined && end !== undefined) {
      if (EXCLUDED.has(node.type) || node.type.startsWith("kenMath")) {
        cover(start, end);
        if (node.type === "html") html.push({ start, end });
        return;
      }
      if (node.type === "linkReference") {
        // [[제목]]은 Markdown 참조 정의가 있어도 위키 문법 우선
        const possibleWiki = start > 0 && source[start - 1] === "[" && source[end] === "]";
        if (!possibleWiki) cover(start, end);
        return;
      }
    }
    for (const child of node.children ?? []) visit(child);
  };
  // AST에서 코드·수식·링크 등 제외 구간 수집
  visit(parseMathMarkdown(source) as PositionedNode);
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
  for (const item of html.sort((a, b) => a.start - b.start)) {
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
  return mask;
}

/**
 * 역슬래시 홀짝에 따라 이스케이프된 시작 대괄호를 구별함
 */
function escaped(source: string, position: number): boolean {
  let count = 0;
  for (let index = position - 1; index >= 0 && source[index] === "\\"; index--) count++;
  return count % 2 === 1;
}

/**
 * 안전한 닫힘과 제목·표시명만 후보로 반환하며 나머지는 Markdown 원문으로 둠
 *
 * 1. 기존 Markdown 문법의 제외 영역 계산
 */
function scan(source: string, maximum: number): WikiLinkCandidate[] {
  if (source.length > MAX_SOURCE_BYTES || new TextEncoder().encode(source).length > MAX_SOURCE_BYTES) return [];
  // 기존 Markdown 문법의 제외 영역 계산
  const mask = excludedMask(source);
  const output: WikiLinkCandidate[] = [];
  let attempts = 0;
  // 이스케이프·중첩·줄 경계·제목 길이를 검사하며 후보 수 제한
  for (let start = 0; start < source.length - 1; start++) {
    if (source[start] !== "[" || source[start + 1] !== "[" || mask[start] || escaped(source, start)) continue;
    if (++attempts > maximum) break;
    let end = start + 2;
    let nested = false;
    let closed = false;
    while (end < source.length && source[end] !== "\r" && source[end] !== "\n") {
      if (source[end] === "[" && source[end + 1] === "[") nested = true;
      if (source[end] === "]" && source[end + 1] === "]" && !escaped(source, end)) { end += 2; closed = true; break; }
      end++;
    }
    if (!closed || nested) {
      start = Math.min(end, source.length) - 1;
      continue;
    }
    const raw = source.slice(start, end);
    const interior = raw.slice(2, -2);
    const divider = interior.indexOf("|");
    const title = (divider < 0 ? interior : interior.slice(0, divider)).trim();
    const label = divider < 0 ? title : interior.slice(divider + 1).trim();
    if (title && label && !/[\[\]|]/.test(title) && !INVALID_CHARACTER.test(title) &&
      !INVALID_CHARACTER.test(label) &&
      Array.from(title).length <= MAX_TITLE_CODEPOINTS && Array.from(label).length <= MAX_LABEL_CODEPOINTS &&
      !mask.slice(start, end).some(Boolean)) output.push({ title, label, raw, start, end });
    start = end - 1;
  }
  return output;
}

/**
 * 안전 접기 태그를 위키 표시명 내부에서 재해석하지 않도록 후보 범위를 가림
 */
export function wikiSourceMask(source: string): Uint8Array {
  const mask = new Uint8Array(source.length);
  for (const candidate of scan(source, MAX_CANDIDATES)) mask.fill(1, candidate.start, candidate.end);
  return mask;
}

/**
 * 마커를 원문 offset으로 역매핑해 접기와 Mermaid의 위치 계약을 보존함
 *
 * 1. 치환 시작점 기준 이분 탐색
 */
function originalOffset(offset: number, ranges: Replacement[], endBoundary: boolean): number {
  // 치환 시작점 기준 이분 탐색
  let left = 0;
  let right = ranges.length;
  while (left < right) {
    const middle = (left + right) >>> 1;
    if (ranges[middle].transformedStart <= offset) left = middle + 1;
    else right = middle;
  }
  // 치환 내부는 요청한 경계로, 외부는 누적 길이 차이로 복원
  if (left === 0) return offset;
  const range = ranges[left - 1];
  if (offset === range.transformedStart) return range.start;
  if (offset < range.transformedEnd) return endBoundary ? range.end : range.start;
  return offset + range.end - range.transformedEnd;
}

/**
 * 긴 원문의 각 AST 위치를 일정한 비용으로 되찾도록 줄 시작을 한 번만 모음
 */
function lineStarts(source: string): number[] {
  const starts = [0];
  for (let index = 0; index < source.length; index++) if (source[index] === "\n") starts.push(index + 1);
  return starts;
}

/**
 * 원문 줄·열을 포함한 위치를 이분 탐색으로 만듦
 *
 * 1. 오프셋이 속한 원문 줄을 이분 탐색
 * 2. 원문 기준 행·열·오프셋 반환
 */
function point(starts: readonly number[], offset: number): {
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
 * 보이지 않는 임의 URL 없이 원문 title/label을 HAST 텍스트 노드로 전달함
 */
function wikiNode(starts: readonly number[], candidate: WikiLinkCandidate): RootContent {
  return { type: "kenWikiLink", data: { hName: "span", hProperties: { className: ["ken-wiki-link"],
    "data-wiki-title": candidate.title, "data-wiki-raw": candidate.raw },
    hChildren: [{ type: "text", value: candidate.label }] },
  position: { start: point(starts, candidate.start), end: point(starts, candidate.end) } } as unknown as RootContent;
}

/**
 * 주석/수식 파싱 뒤 텍스트 마커만 검증된 위키 노드로 복원함
 *
 * 1. 후보와 원문 크기 제한 확인
 * 2. 후보별 마커와 원문 위치 대응 기록
 * 3. 본문 주석 파싱 후 마커를 위키 노드로 복원
 * 4. 주변 노드의 위치를 원문 기준으로 복원
 */
export function parseWikiMarkdown(source: string, maximum = MAX_CANDIDATES): Root {
  // 후보와 원문 크기 제한 확인
  const found = scan(source, maximum);
  if (!found.length) return parseAnnotationMarkdown(source);
  let prefix = "";
  for (let serial = 0; serial < 16; serial++) {
    const candidate = `KENBLOGWIKI${serial}BOUNDARY`;
    if (!source.includes(candidate)) { prefix = candidate; break; }
  }
  if (!prefix) return parseAnnotationMarkdown(source);
  const ranges: Replacement[] = [];
  // 후보별 마커와 원문 위치 대응 기록
  let modified = "";
  let cursor = 0;
  for (const [index, candidate] of found.entries()) {
    modified += source.slice(cursor, candidate.start);
    const marker = `${prefix}${index}END`;
    const transformedStart = modified.length;
    modified += marker;
    ranges.push({ ...candidate, marker, transformedStart, transformedEnd: modified.length });
    cursor = candidate.end;
  }
  modified += source.slice(cursor);
  // 본문 주석 파싱 후 마커를 위키 노드로 복원
  const root = parseAnnotationMarkdown(modified);
  const starts = lineStarts(source);
  const expression = new RegExp(`${prefix}([0-9]+)END`, "g");

  /**
   * 원문 위치 또는 텍스트 노드 복원
   */
  const restore = (node: PositionedNode) => {
    if (!node.children) return;
    const children: PositionedNode[] = [];
    for (const child of node.children) {
      if (child.type === "text" && typeof child.value === "string") {
        let cursor = 0;
        let matched = false;
        for (const match of child.value.matchAll(expression)) {
          const range = ranges[Number(match[1])];
          if (!range || range.marker !== match[0]) continue;
          if (match.index > cursor) children.push({ type: "text", value: child.value.slice(cursor, match.index) });
          children.push(wikiNode(starts, range) as PositionedNode);
          cursor = match.index + match[0].length;
          matched = true;
        }
        if (matched) {
          if (cursor < child.value.length) children.push({ type: "text", value: child.value.slice(cursor) });
          continue;
        }
      }
      restore(child);
      children.push(child);
    }
    node.children = children;
  };
  restore(root as PositionedNode);

  /**
   * 치환된 노드 위치를 원문 위치로 변환
   */
  const remap = (node: PositionedNode) => {
    if (node.type !== "kenWikiLink") {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (start !== undefined && end !== undefined) node.position = {
        start: point(starts, originalOffset(start, ranges, false)),
        end: point(starts, originalOffset(end, ranges, true)),
      };
    }
    for (const child of node.children ?? []) remap(child);
  };
  // 주변 노드의 위치를 원문 기준으로 복원
  remap(root as PositionedNode);
  return root;
}

/**
 * 실제로 렌더되는 위키 노드와 유효한 주석 본문에서 조회 대상만 모음
 */
export function collectWikiTitles(root: Root, items: AnnotationItem[]): {
  /**
   * 위키 대상 제목 목록
   */
  titles: string[]
} {
  const titles: string[] = [];
  const seen = new Set<string>();
  let count = 0;

  /**
   * 하위 노드에서 조회 대상을 수집
   */
  const collect = (node: PositionedNode) => {
    if (node.type === "kenWikiLink") {
      count++;
      const title = (node.data?.hProperties as Record<string, unknown> | undefined)?.["data-wiki-title"];
      if (typeof title === "string" && seen.size < 128 && !seen.has(title)) { seen.add(title); titles.push(title); }
      return;
    }
    for (const child of node.children ?? []) collect(child);
  };
  collect(root as PositionedNode);
  for (const item of items) {
    const remaining = Math.max(0, MAX_CANDIDATES - count);
    if (!remaining) break;
    const annotationRoot = parseWikiMarkdown(item.content, remaining);
    collect(annotationRoot as PositionedNode);
  }
  return { titles };
}
