import { coverRawHtml } from "./raw-html-mask";
import { escaped, originalOffset, lineStarts, sourcePoint } from './source-position';
import type { Root, RootContent } from "mdast";
import { parseMathMarkdown } from "./math-syntax";

/**
 * 본문 전체에서 식별한 한 주석의 표시·본문·참조 순서
 */
export type AnnotationItem = {
  /**
   * 문서 내 순번
   */
  index: number;

  /**
   * 표시 문구
   */
  label: string;

  /**
   * 본문 내용
   */
  content: string;

  /**
   * 참조 순번 목록
   */
  refs: number[]
};

/**
 * 본문 주석 후보 종류
 */
type CandidateKind = "anonymous" | "definition" | "reference" | "raw";

/**
 * 본문 주석 원문 후보
 */
type Candidate = {
  /**
   * 구간 시작 위치
   */
  start: number;

  /**
   * 구간 끝 위치
   */
  end: number;

  /**
   * 원문
   */
  raw: string;

  /**
   * 문법 후보 종류
   */
  kind: CandidateKind;

  /**
   * 이름
   */
  name?: string;

  /**
   * 본문 내용
   */
  content?: string;

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
 * 본문 주석 후보 AST 노드
 */
type CandidateNode = {
  /**
   * 종류
   */
  type: "kenAnnotationCandidate";

  /**
   * 원문
   */
  raw: string;

  /**
   * 문법 후보 종류
   */
  kind: CandidateKind;

  /**
   * 이름
   */
  name?: string;

  /**
   * 본문 내용
   */
  content?: string;

  /**
   * AST 렌더 보조 정보
   */
  data: {
    /**
     * 변환할 HTML 태그명
     */
    hName: string;

    /**
     * 변환할 HTML 속성
     */
    hProperties?: Record<string, unknown>;

    /**
     * 변환할 HTML 하위 노드
     */
    hChildren: Array<{
      /**
       * 종류
       */
      type: "text";

      /**
       * 노드 값
       */
      value: string
    }>
  };

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
  }
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
 * 본문 주석 파싱 원문 바이트 상한
 */
const MAX_SOURCE = 1024 * 1024;

/**
 * 문법 후보 개수 상한
 */
const MAX_CANDIDATES = 512;

/**
 * 주석 본문 길이 상한
 */
const MAX_CONTENT = 2048;

/**
 * 주석 이름 코드 포인트 수 상한
 */
const MAX_NAME_CODEPOINTS = 64;

/**
 * UTF-8 바이트 기준 1MiB를 넘는 원문은 주석 파서를 안전하게 건너뜀
 */
function sourceTooLarge(source: string): boolean {
  return source.length > MAX_SOURCE || new TextEncoder().encode(source).length > MAX_SOURCE;
}

/**
 * 수식·코드·이미지·링크·raw HTML 안에서 후보를 찾지 않도록 원문 위치를 가림
 *
 * 1. AST에서 코드·수식·링크 등 제외 구간 수집
 * 2. HTML 여닫는 태그 사이의 텍스트도 제외
 * 3. 닫히지 않은 HTML은 문서 끝까지 제외
 */
function excludedMask(source: string, root: Root): Uint8Array {
  const mask = new Uint8Array(source.length);
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
    if (start !== undefined && end !== undefined &&
      (["code", "inlineCode", "html", "definition", "image", "imageReference"].includes(node.type) ||
        node.type.startsWith("kenMath"))) {
      cover(start, end);
      if (node.type === "html") html.push({ start, end });
      return;
    }
    if (start !== undefined && end !== undefined && (node.type === "link" || node.type === "linkReference")) {
      // 본문 링크 안에서 sup 링크를 만들면 <a>가 중첩되므로 표시 문구까지 원문으로 둠
      cover(start, end);
      return;
    }
    for (const child of node.children ?? []) visit(child);
  };
  // AST에서 코드·수식·링크 등 제외 구간 수집
  visit(root as PositionedNode);
  // 인라인 HTML 태그 사이에 있는 텍스트도 HTML로 취급하되 안전한 details/summary 내용은 남김
  // HTML 여닫는 태그 사이의 텍스트도 제외
  coverRawHtml(source, html, cover);
  return mask;
}

/**
 * 한 줄의 균형 잡힌 후보를 익명 정의·이름 정의·재참조·원문으로 분류함
 *
 * 1. 중첩·길이·닫는 괄호 검사, 실패하면 원문 유지
 * 2. 공백으로 시작하면 익명 정의, 그 외는 이름·본문 분리
 */
function classify(source: string, start: number, end: number, nested: boolean): Candidate {
  const raw = source.slice(start, end);
  const base: Candidate = { start, end, raw, kind: "raw", marker: "", transformedStart: 0, transformedEnd: 0 };
  // 중첩·길이·닫는 괄호 검사, 실패하면 원문 유지
  if (nested || raw.length > MAX_CONTENT + MAX_NAME_CODEPOINTS * 2 + 4 || raw[raw.length - 1] !== "]") return base;
  const inside = raw.slice(2, -1);
  // 공백으로 시작하면 익명 정의, 그 외는 이름·본문 분리
  if (/^[ \t]/.test(inside)) {
    const content = inside.trim();
    return content && content.length <= MAX_CONTENT ? { ...base, kind: "anonymous", content } : base;
  }
  const match = /^([^\s\[\]]+)(?:[ \t]+([\s\S]*))?$/.exec(inside);
  if (!match || Array.from(match[1]).length > MAX_NAME_CODEPOINTS) return base;
  if (match[2] === undefined) return { ...base, kind: "reference", name: match[1] };
  const content = match[2].trim();
  return content && content.length <= MAX_CONTENT ? { ...base, kind: "definition", name: match[1], content } : base;
}

/**
 * 닫히지 않은 후보는 줄 끝까지 한 번에 건너뛰어 긴 입력의 반복 스캔을 막음
 *
 * 1. 제외 영역 밖의 이스케이프되지 않은 시작점 검색
 * 2. 같은 줄에서 괄호 균형을 맞추며 종료점 탐색
 * 3. 후보 상한 초과 시 문서 전체 원문 처리 신호 반환
 */
function candidates(source: string, mask: Uint8Array): Candidate[] | null {
  const found: Candidate[] = [];
  // 제외 영역 밖의 이스케이프되지 않은 시작점 검색
  for (let index = 0; index < source.length; index++) {
    if (source[index] !== "[" || source[index + 1] !== "*" || mask[index] || escaped(source, index)) continue;
    let depth = 1;
    let nested = false;
    let cursor = index + 2;
    // 같은 줄에서 괄호 균형을 맞추며 종료점 탐색
    while (cursor < source.length && source[cursor] !== "\r" && source[cursor] !== "\n") {
      if (mask[cursor]) { cursor++; continue; }
      if (source[cursor] === "\\" && cursor + 1 < source.length) { cursor += 2; continue; }
      if (source[cursor] === "[") {
        if (source[cursor + 1] === "*") nested = true;
        depth++;
      } else if (source[cursor] === "]" && --depth === 0) { cursor++; break; }
      cursor++;
    }
    const end = cursor;
    found.push(depth === 0 ? classify(source, index, end, nested) :
      { start: index, end, raw: source.slice(index, end), kind: "raw",
        marker: "", transformedStart: 0, transformedEnd: 0 });
    // 후보 상한 초과 시 문서 전체 원문 처리 신호 반환
    if (found.length > MAX_CANDIDATES) return null;
    index = end - 1;
  }
  return found;
}

/**
 * 접기 태그·편집 모델의 원문 구간 검사에서 주석 안의 HTML 모양 텍스트를 가림
 */
export function annotationSourceMask(source: string, root: Root = parseMathMarkdown(source)): Uint8Array {
  const mask = new Uint8Array(source.length);
  if (sourceTooLarge(source)) { mask.fill(1); return mask; }
  const found = candidates(source, excludedMask(source, root));
  if (found === null) { mask.fill(1); return mask; }
  for (const candidate of found) mask.fill(1, candidate.start, candidate.end);
  return mask;
}

/**
 * 충돌 없는 영숫자 접두사를 한정된 횟수만 시도하고 실패하면 안전 원문으로 돌림
 */
function markerPrefix(source: string): string | null {
  for (let serial = 0; serial < 16; serial++) {
    const prefix = `KENBLOGANNOTATION${serial}BOUNDARY`;
    if (!source.includes(prefix)) return prefix;
  }
  return null;
}

/**
 * 원문의 후보를 마커로 치환하되 나중에 위치를 복원할 대응을 기록함
 *
 * 1. 후보별 원문·치환 위치 대응 기록
 * 2. 마지막 후보 뒤의 원문 보존
 */
function prepare(source: string, found: Candidate[], prefix: string): string {
  let transformed = "";
  let cursor = 0;
  // 후보별 원문·치환 위치 대응 기록
  found.forEach((candidate, index) => {
    transformed += source.slice(cursor, candidate.start);
    candidate.marker = `${prefix}${index}END`;
    candidate.transformedStart = transformed.length;
    transformed += candidate.marker;
    candidate.transformedEnd = transformed.length;
    cursor = candidate.end;
  });
  // 마지막 후보 뒤의 원문 보존
  return transformed + source.slice(cursor);
}

/**
 * 후보는 최종 문서 해석 전까지도 텍스트로만 렌더해 이미지·HTML 실행을 막음
 */
function candidateNode(candidate: Candidate, starts: number[]): RootContent {
  return { type: "kenAnnotationCandidate", raw: candidate.raw, kind: candidate.kind,
    name: candidate.name, content: candidate.content,
    data: { hName: "span", hChildren: [{ type: "text", value: candidate.raw }] },
    position: { start: sourcePoint(starts, candidate.start), end: sourcePoint(starts, candidate.end) },
  } as unknown as RootContent;
}

/**
 * 파싱 결과의 마커 텍스트를 원문 후보 노드로 바꿔 주변 Markdown 구조를 유지함
 *
 * 1. 후보 번호를 읽을 마커 패턴 준비
 * 2. 주변 텍스트를 보존하며 마커만 후보 노드로 복원
 * 3. 하위 노드까지 복원한 결과 반영
 */
function restoreCandidates(root: Root, found: Candidate[], starts: number[], prefix: string): void {
  // 후보 번호를 읽을 마커 패턴 준비
  const marker = new RegExp(`${prefix}([0-9]+)END`, "g");

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
      if (node.type === "text" && typeof typed.value === "string") {
        let cursor = 0;
        // 주변 텍스트를 보존하며 마커만 후보 노드로 복원
        for (const match of typed.value.matchAll(marker)) {
          const candidate = found[Number(match[1])];
          if (!candidate || candidate.marker !== match[0]) continue;
          if (match.index > cursor) output.push({ type: "text", value: typed.value.slice(cursor, match.index) });
          output.push(candidateNode(candidate, starts));
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
  // 하위 노드까지 복원한 결과 반영
  root.children = visit(root.children);
}

/**
 * 마커 때문에 이동한 일반 AST 노드 위치를 원문의 LF/CRLF 위치로 되돌림
 */
function restorePositions(node: PositionedNode, found: Candidate[], starts: number[]): void {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (start !== undefined && end !== undefined && node.type !== "kenAnnotationCandidate") {
    node.position = { start: sourcePoint(starts, originalOffset(start, found, false)),
      end: sourcePoint(starts, originalOffset(end, found, true)) };
  }
  for (const child of node.children ?? []) restorePositions(child, found, starts);
}

/**
 * 과도한 후보 수나 마커 충돌에서는 문서 전체를 텍스트만 있는 원문 노드로 남김
 */
function rawDocument(source: string): Root {
  const starts = lineStarts(source);
  return { type: "root", children: [{ type: "kenAnnotationRaw", value: source,
    data: { hName: "pre", hChildren: [{ type: "text", value: source }] },
    position: { start: sourcePoint(starts, 0), end: sourcePoint(starts, source.length) },
  } as unknown as RootContent] };
}

/**
 * 수식 문법 다음, 안전 접기 재파싱에서도 공유하는 주석 우선 파싱 결과
 *
 * 1. 입력·후보 수·마커 충돌 제한 검사
 * 2. 후보를 마커로 가린 뒤 수식 파서로 재해석
 * 3. 후보 노드와 원문 위치를 차례로 복원
 */
export function parseAnnotationMarkdown(source: string, root: Root = parseMathMarkdown(source)): Root {
  // 입력·후보 수·마커 충돌 제한 검사
  if (sourceTooLarge(source)) return rawDocument(source);
  const found = candidates(source, excludedMask(source, root));
  if (found === null) return rawDocument(source);
  if (!found.length) return root;
  const prefix = markerPrefix(source);
  if (!prefix) return rawDocument(source);
  // 후보를 마커로 가린 뒤 수식 파서로 재해석
  const modified = prepare(source, found, prefix);
  const parsed = parseMathMarkdown(modified);
  const starts = lineStarts(source);
  // 후보 노드와 원문 위치를 차례로 복원
  restoreCandidates(parsed, found, starts, prefix);
  restorePositions(parsed as PositionedNode, found, starts);
  return parsed;
}

/**
 * 허용한 링크 주소만 주석 본문에서 활성화하고 나머지는 원문 후보로 남김
 */
function safeLink(url: string): boolean {
  if (/[\u0000-\u001f\u007f\\]/.test(url)) return false;
  return url.startsWith("#") || (url.startsWith("/") && !url.startsWith("//")) ||
    /^(https?:|mailto:)/i.test(url) || /^[^:/?#][^:]*$/.test(url);
}

/**
 * 주석 본문을 한 문단의 안전한 인라인 문법으로 제한함
 */
function validContent(content: string): boolean {
  if (!content || content.length > MAX_CONTENT || /\r|\n/.test(content)) return false;
  const root = parseMathMarkdown(content);
  if (root.children.length !== 1 || root.children[0].type !== "paragraph") return false;

  /**
   * 현재 노드와 하위 노드 순회
   */
  const visit = (node: RootContent): boolean => {
    if (node.type === "text" || node.type === "inlineCode" || (node as {
    /**
     * 종류
     */
    type: string
  }).type === "kenMathInline") return true;
    if (node.type === "strong" || node.type === "emphasis") return node.children.every(visit);
    if (node.type === "link") return safeLink(node.url) && node.children.every(visit);
    return false;
  };
  return root.children[0].children.every(visit);
}

/**
 * 안전 접기 그룹화 후 실제로 남은 후보만 문서 전체 순서로 해석함
 *
 * 1. 남은 후보를 원문 순서로 정렬
 * 2. 본문을 검증하고 이름별 최초 유효 정의 수집
 * 3. 익명 번호·이름 참조를 첫 등장 순서로 배정
 * 4. 정의가 없거나 잘못된 후보는 텍스트로 유지
 * 5. 유효 참조에 왕복 탐색용 순번 부여
 */
export function resolveAnnotationDocument(root: Root): AnnotationItem[] {
  const nodes: CandidateNode[] = [];

  /**
   * 현재 노드와 하위 노드 순회
   */
  const visit = (node: RootContent | Root) => {
    if ((node as {
    /**
     * 종류
     */
    type: string
  }).type === "kenAnnotationCandidate") { nodes.push(node as unknown as CandidateNode); return; }
    for (const child of "children" in node ? node.children : []) visit(child);
  };
  // 남은 후보를 원문 순서로 정렬
  visit(root);
  nodes.sort((left, right) => (left.position?.start.offset ?? 0) - (right.position?.start.offset ?? 0));
  // 본문을 검증하고 이름별 최초 유효 정의 수집
  const valid = new Map<CandidateNode, boolean>();
  const definitions = new Map<string, string>();
  for (const node of nodes) {
    const allowed = (node.kind === "anonymous" || node.kind === "definition") &&
      validContent(node.content ?? "");
    valid.set(node, allowed);
    if (allowed && node.kind === "definition" && node.name && !definitions.has(node.name)) {
      definitions.set(node.name, node.content!);
    }
  }
  const items: AnnotationItem[] = [];
  const named = new Map<string, AnnotationItem>();
  let anonymousNumber = 0;
  let occurrence = 0;
  // 익명 번호·이름 참조를 첫 등장 순서로 배정
  for (const node of nodes) {
    let item: AnnotationItem | undefined;
    if (node.kind === "anonymous" && valid.get(node)) {
      anonymousNumber++;
      item = { index: items.length, label: String(anonymousNumber), content: node.content!,
        refs: [] };
      items.push(item);
    } else if ((node.kind === "definition" && valid.get(node)) || node.kind === "reference") {
      const content = node.name ? definitions.get(node.name) : undefined;
      if (content && node.name) {
        item = named.get(node.name);
        // 정의가 없거나 잘못된 후보는 텍스트로 유지
        if (!item) {
          item = { index: items.length, label: node.name, content, refs: [] };
          named.set(node.name, item);
          items.push(item);
        }
      }
    }
    if (!item) {
      node.data = { hName: "span", hChildren: [{ type: "text", value: node.raw }] };
      continue;
    }
    // 유효 참조에 왕복 탐색용 순번 부여
    item.refs.push(occurrence);
    node.data = { hName: "sup", hProperties: { className: ["ken-annotation-ref"],
      "data-annotation-index": String(item.index), "data-annotation-occurrence": String(occurrence) },
    hChildren: [{ type: "text", value: `[${item.label}]` }] };
    occurrence++;
  }
  return items;
}
