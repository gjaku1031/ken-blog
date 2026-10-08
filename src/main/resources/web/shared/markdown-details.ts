import { originalOffset, lineStarts, sourcePoint } from './source-position';
import type { Root, RootContent } from "mdast";
import { mathSourceMask } from "./math-syntax";
import { annotationSourceMask, resolveAnnotationDocument,
  type AnnotationItem } from "./annotation-syntax";
import { parseWikiMarkdown, wikiSourceMask } from "./wiki-link-syntax";

/**
 * 접기·요약 태그 경계 종류
 */
type Boundary = "details-open" | "details-close" | "summary-open" | "summary-close";

/**
 * 원문 치환 구간
 */
type Replacement = {
  /**
   * 구간 시작 위치
   */
  start: number;

  /**
   * 구간 끝 위치
   */
  end: number;

  /**
   * 접기 태그 경계 종류
   */
  boundary?: Boundary;

  /**
   * 해석 실패 시 표시할 원문
   */
  fallback?: string
};

/**
 * 치환 전후 위치 대응
 */
type OffsetShift = {
  /**
   * 원문 시작 위치
   */
  start: number;

  /**
   * 원문 끝 위치
   */
  end: number;

  /**
   * 수정된 문자열의 시작 위치
   */
  transformedStart: number;

  /**
   * 수정된 문자열의 끝 위치
   */
  transformedEnd: number
};

/**
 * 원문 위치를 가진 AST 노드
 */
type PositionedNode = {
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
 * 접기 태그 중첩 상태
 */
type Frame = {
  /**
   * 요약 태그 확인 여부
   */
  summarySeen: boolean;

  /**
   * 요약 태그 열림 여부
   */
  summaryOpen: boolean;

  /**
   * 접기 내용 시작 위치
   */
  contentStart: number
};

/**
 * 검증된 접기 AST 노드
 */
type SafeNode = RootContent & {
  /**
   * 하위 AST 노드
   */
  children: RootContent[];

  /**
   * AST 렌더 보조 정보
   */
  data: {
    /**
     * 변환할 HTML 태그명
     */
    hName: string
  }
};

/**
 * 접기 중첩 깊이 상한
 */
const MAX_DEPTH = 8;

/**
 * 접기 경계 개수 상한
 */
const MAX_BOUNDARIES = 2048;

/**
 * 제목 없는 접기의 기본 표시 문구
 */
const DEFAULT_SUMMARY = "펼치기";

/**
 * Markdown 코드 구간의 태그 예제를 접기 문법으로 오인하지 않도록 위치를 표시함
 *
 * 1. 펜스·들여쓰기 코드의 줄 범위 제외
 * 2. 문단별 인라인 코드의 백틱 쌍 처리
 * 3. 수식·본문 주석·위키 링크 제외 영역 합산
 */
function codeMask(source: string): Uint8Array {
  const mask = new Uint8Array(source.length);
  let fence: {
    /**
     * 구분 문자
     */
    character: string;

    /**
     * 길이
     */
    length: number
  } | null = null;
  let start = 0;
  // 펜스·들여쓰기 코드의 줄 범위 제외
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

  /**
   * 인라인 코드 구간을 접기 파싱에서 제외
   */
  const markInlineCode = (from: number, to: number) => {
    const runs: {
      /**
       * 구간 시작 위치
       */
      start: number;

      /**
       * 구간 끝 위치
       */
      end: number;

      /**
       * 길이
       */
      length: number
    }[] = [];
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
  // 문단별 인라인 코드의 백틱 쌍 처리
  const blank = /\r?\n[ \t]*\r?\n/g;
  let paragraphStart = 0;
  for (const match of source.matchAll(blank)) {
    markInlineCode(paragraphStart, match.index);
    paragraphStart = match.index + match[0].length;
  }
  markInlineCode(paragraphStart, source.length);
  // 수식·본문 주석·위키 링크 제외 영역 합산
  const mathMask = mathSourceMask(source);
  for (let index = 0; index < mask.length; index++) if (mathMask[index]) mask[index] = 1;
  const annotationMask = annotationSourceMask(source);
  for (let index = 0; index < mask.length; index++) if (annotationMask[index]) mask[index] = 1;
  const wikiMask = wikiSourceMask(source);
  for (let index = 0; index < mask.length; index++) if (wikiMask[index]) mask[index] = 1;
  return mask;
}

/**
 * 따옴표 안의 `>`와 태그 비슷한 문자열을 건너뛰며 HTML 태그 끝을 찾음
 */
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

/**
 * 하나의 접기 범위를 검사하고, 불명확한 HTML은 범위 전체를 원문 표시로 돌림
 *
 * 1. 가려진 구간·이스케이프를 건너뛰며 태그 탐색
 * 2. 접기 외 HTML이 섞이면 전체 그룹을 원문 처리
 * 3. 스택으로 접기 중첩과 summary의 위치·개수 검증
 * 4. 닫히지 않은 그룹은 문서 끝까지 원문 처리
 */
function readGroup(source: string, start: number, mask: Uint8Array): {
  /**
   * 구간 끝 위치
   */
  end: number;

  /**
   * 허용 구조 여부
   */
  safe: boolean;

  /**
   * 태그 경계 목록
   */
  boundaries: Replacement[]
} {
  const frames: Frame[] = [];
  const boundaries: Replacement[] = [];
  let safe = true;
  // 가려진 구간·이스케이프를 건너뛰며 태그 탐색
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
    // 접기 외 HTML이 섞이면 전체 그룹을 원문 처리
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
    // 스택으로 접기 중첩과 summary의 위치·개수 검증
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
  // 닫히지 않은 그룹은 문서 끝까지 원문 처리
  return { end: source.length, safe: false, boundaries };
}

/**
 * 원본 AST에서 블록 HTML로 확인된 접기 시작점만 수집함
 */
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

/**
 * 마커를 노출 원문과 충돌하지 않는 문단 텍스트로 선택함
 */
function markerPrefix(source: string): string {
  let number = 0;
  while (source.includes(`KENBLOGSAFEDETAILS${number}BOUNDARY`)) number++;
  return `KENBLOGSAFEDETAILS${number}BOUNDARY`;
}

/**
 * 마커 문단인지 검사함
 */
function markerIndex(node: RootContent, prefix: string): number | null {
  if (node.type !== "paragraph" || node.children.length !== 1 || node.children[0].type !== "text") return null;
  const match = node.children[0].value.match(new RegExp(`^${prefix}([0-9]+)END$`));
  return match ? Number(match[1]) : null;
}

/**
 * 수식 파서가 복원한 수정 문자열 위치를 다시 실제 게시글 원문 위치로 옮김
 */
function restoreSourcePositions(root: Root, source: string, shifts: OffsetShift[]): void {
  const starts = lineStarts(source);

  /**
   * 현재 노드와 하위 노드 순회
   */
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

/**
 * 원래의 참조 링크·각주 정의를 공유하는 단일 AST 안에서 안전한 접기 노드를 조립함
 *
 * 1. 일반 노드는 유지하고 마커 문단만 해석
 * 2. 검증 실패 범위를 코드 원문으로 복원
 * 3. 접기 스택으로 본문·요약 노드 조립
 * 4. 모든 그룹 종료·마커 소비 확인 후 결과 반영
 */
function groupNodes(root: Root, replacements: Replacement[], prefix: string, source: string): Root | null {
  const output: RootContent[] = [];
  const stack: {
    /**
     * 현재 접기 노드
     */
    details: SafeNode;

    /**
     * 노드 추가 대상
     */
    target: RootContent[];

    /**
     * 부모 노드 목록
     */
    parent: RootContent[];

    /**
     * 구간 시작 위치
     */
    start: number;

    /**
     * 유효하지 않은 구조 여부
     */
    invalid: boolean;

    /**
     * 접기 요약 노드
     */
    summary?: RootContent[];

    /**
     * 요약 시작 위치
     */
    summaryStart?: number
  }[] = [];
  const starts = lineStarts(source);

  /**
   * 현재 접기 프레임 또는 최상위 결과에 노드 추가
   */
  const append = (node: RootContent) => (stack.at(-1)?.target ?? output).push(node);
  let used = 0;
  // 일반 노드는 유지하고 마커 문단만 해석
  for (const node of root.children) {
    const index = markerIndex(node, prefix);
    if (index === null) { append(node); continue; }
    const replacement = replacements[index];
    if (!replacement) return null;
    used++;
    // 검증 실패 범위를 코드 원문으로 복원
    if (replacement.fallback !== undefined) {
      append({ type: "code", value: replacement.fallback,
        position: { start: sourcePoint(starts, replacement.start), end: sourcePoint(starts, replacement.end) } });
      continue;
    }
    // 접기 스택으로 본문·요약 노드 조립
    if (replacement.boundary === "details-open") {
      const details = { type: "safeDetails", data: { hName: "details" }, children: [],
        position: { start: sourcePoint(starts, replacement.start), end: sourcePoint(starts, replacement.end) } } as unknown as SafeNode;
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
        current.parent[position] = { type: "code", value: source.slice(current.start, replacement.end),
          position: { start: sourcePoint(starts, current.start), end: sourcePoint(starts, replacement.end) } };
      } else if (!current.details.children.some((child) => (child as SafeNode).data?.hName === "summary")) {
        current.details.children.unshift({ type: "safeSummary", data: { hName: "summary" }, children: [{ type: "text", value: DEFAULT_SUMMARY }],
          position: { start: sourcePoint(starts, current.start), end: sourcePoint(starts, current.start) } } as unknown as RootContent);
      }
    } else if (replacement.boundary === "summary-open") {
      const current = stack.at(-1);
      if (!current || current.summary) return null;
      current.summary = [];
      current.summaryStart = replacement.start;
      current.target = current.summary;
    } else if (replacement.boundary === "summary-close") {
      const current = stack.at(-1);
      if (!current?.summary) return null;
      const parts = current.summary;
      if (parts.length > 1 || parts.some((part) => part.type !== "paragraph" && part.type !== "text")) {
        current.invalid = true;
      } else {
        const children = parts.flatMap((part) => part.type === "paragraph" ? part.children : [part]);
        current.details.children.push({ type: "safeSummary", data: { hName: "summary" }, children: children.length ? children : [{ type: "text", value: DEFAULT_SUMMARY }],
          position: { start: sourcePoint(starts, current.summaryStart ?? current.start), end: sourcePoint(starts, replacement.end) } } as unknown as RootContent);
      }
      current.summary = undefined;
      current.target = current.details.children;
    }
  }
  // 모든 그룹 종료·마커 소비 확인 후 결과 반영
  if (stack.length || used !== replacements.length) return null;
  root.children = output;
  return root;
}

/**
 * 안전한 접기 태그만 단일 Markdown 문서 AST의 네이티브 disclosure 노드로 변환함
 *
 * 1. 블록 HTML에서 접기 시작점·제외 영역 확인
 * 2. 접기 경계 검증, 잘못된 그룹은 원문 범위로 수집
 * 3. 경계를 충돌 없는 마커로 치환
 * 4. 한 문서로 재파싱 후 원문 위치·접기 구조 복원
 */
function remarkSafeDetails() {
  return (root: Root, file: {
  /**
   * 노드 값
   */
  value: unknown
  }) => {
    const source = String(file.value);
    // 블록 HTML에서 접기 시작점·제외 영역 확인
    const candidates = starts(root);
    if (!candidates.length) return;
    const mask = codeMask(source);
    const replacements: Replacement[] = [];
    let cursor = 0;
    // 접기 경계 검증, 잘못된 그룹은 원문 범위로 수집
    for (const candidate of candidates) {
      if (candidate < cursor || mask[candidate]) continue;
      let next = candidate;
      while (next < source.length && !mask[next]) {
        const group = readGroup(source, next, mask);
        if (!group.safe) replacements.push({ start: next, end: group.end, fallback: source.slice(next, group.end) });
        else replacements.push(...group.boundaries);
        cursor = group.end;
        if (replacements.length > MAX_BOUNDARIES) break;
        // 한 HTML 블록에 같은 줄로 이어 쓴 형제 접기도 각각 보존함
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
    // 경계를 충돌 없는 마커로 치환
    const prefix = markerPrefix(source);
    let modified = "";
    let from = 0;
    const shifts: OffsetShift[] = [];
    replacements.forEach((item, index) => {
      modified += source.slice(from, item.start);
      const transformedStart = modified.length;
      modified += `\n\n${prefix}${index}END\n\n`;
      shifts.push({ start: item.start, end: item.end,
        transformedStart, transformedEnd: modified.length });
      from = item.end;
    });
    modified += source.slice(from);
    // 한 문서로 재파싱 후 원문 위치·접기 구조 복원
    const parsed = parseWikiMarkdown(modified);
    restoreSourcePositions(parsed, source, shifts);
    const grouped = groupNodes(parsed, replacements, prefix, source);
    root.children = grouped?.children ?? [{ type: "code", value: source }];
  };
}

/**
 * 수식·주석·안전 접기를 같은 문서로 조립하고 살아남은 주석만 목록으로 반환함
 */
export function parseAnnotationDocument(source: string): {
  /**
   * 문서 AST 루트
   */
  root: Root;

  /**
   * 조회 결과 목록
   */
  items: AnnotationItem[]
} {
  const root = parseWikiMarkdown(source);
  remarkSafeDetails()(root, { value: source });
  return { root, items: resolveAnnotationDocument(root) };
}
