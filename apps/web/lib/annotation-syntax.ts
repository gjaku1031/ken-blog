import type { Root, RootContent } from "mdast";
import { parseMathMarkdown } from "./math-syntax";

/** 본문 전체에서 식별한 한 주석의 표시·본문·참조 순서. */
export type AnnotationItem = { index: number; label: string; content: string; firstRef: number; refs: number[] };

type CandidateKind = "anonymous" | "definition" | "reference" | "raw";
type Candidate = { start: number; end: number; raw: string; kind: CandidateKind; name?: string; content?: string;
  marker: string; transformedStart: number; transformedEnd: number };
type CandidateNode = { type: "kenAnnotationCandidate"; raw: string; kind: CandidateKind;
  name?: string; content?: string; data: { hName: string; hProperties?: Record<string, unknown>;
    hChildren: Array<{ type: "text"; value: string }> }; position?: { start: { offset?: number }; end: { offset?: number } } };
type PositionedNode = { type: string; position?: { start: { offset?: number }; end: { offset?: number } };
  children?: PositionedNode[] };

const MAX_SOURCE = 1024 * 1024;
const MAX_CANDIDATES = 512;
const MAX_CONTENT = 2048;
const MAX_NAME_CODEPOINTS = 64;

/** UTF-8 바이트 기준 1MiB를 넘는 원문은 주석 파서를 안전하게 건너뛴다. */
function sourceTooLarge(source: string): boolean {
  return source.length > MAX_SOURCE || new TextEncoder().encode(source).length > MAX_SOURCE;
}

/** 수식·코드·이미지·링크·raw HTML 안에서 후보를 찾지 않도록 원문 위치를 가린다. */
function excludedMask(source: string, root: Root): Uint8Array {
  const mask = new Uint8Array(source.length);
  const html: Array<{ start: number; end: number }> = [];
  const cover = (start: number, end: number) => mask.fill(1, start, end);
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
      // 본문 링크 안에서 sup 링크를 만들면 <a>가 중첩되므로 표시 문구까지 원문으로 둔다.
      cover(start, end);
      return;
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(root as PositionedNode);
  // 인라인 HTML 태그 사이에 있는 텍스트도 HTML로 취급하되 안전한 details/summary 내용은 남긴다.
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
  return mask;
}

/** 바로 앞 역슬래시의 홀짝으로 현재 구두점이 이스케이프됐는지 판단한다. */
function escaped(source: string, position: number): boolean {
  let count = 0;
  for (let index = position - 1; index >= 0 && source[index] === "\\"; index--) count++;
  return count % 2 === 1;
}

/** 한 줄의 균형 잡힌 후보를 익명 정의·이름 정의·재참조·원문으로 분류한다. */
function classify(source: string, start: number, end: number, nested: boolean): Candidate {
  const raw = source.slice(start, end);
  const base: Candidate = { start, end, raw, kind: "raw", marker: "", transformedStart: 0, transformedEnd: 0 };
  if (nested || raw.length > MAX_CONTENT + MAX_NAME_CODEPOINTS * 2 + 4 || raw[raw.length - 1] !== "]") return base;
  const inside = raw.slice(2, -1);
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

/** 닫히지 않은 후보는 줄 끝까지 한 번에 건너뛰어 긴 입력의 반복 스캔을 막는다. */
function candidates(source: string, mask: Uint8Array): Candidate[] | null {
  const found: Candidate[] = [];
  for (let index = 0; index < source.length; index++) {
    if (source[index] !== "[" || source[index + 1] !== "*" || mask[index] || escaped(source, index)) continue;
    let depth = 1;
    let nested = false;
    let cursor = index + 2;
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
    if (found.length > MAX_CANDIDATES) return null;
    index = end - 1;
  }
  return found;
}

/** 접기 태그·편집 모델의 원문 구간 검사에서 주석 안의 HTML 모양 텍스트를 가린다. */
export function annotationSourceMask(source: string): Uint8Array {
  const mask = new Uint8Array(source.length);
  if (sourceTooLarge(source)) { mask.fill(1); return mask; }
  const root = parseMathMarkdown(source);
  const found = candidates(source, excludedMask(source, root));
  if (found === null) { mask.fill(1); return mask; }
  for (const candidate of found) mask.fill(1, candidate.start, candidate.end);
  return mask;
}

/** 충돌 없는 영숫자 접두사를 한정된 횟수만 시도하고 실패하면 안전 원문으로 돌린다. */
function markerPrefix(source: string): string | null {
  for (let serial = 0; serial < 16; serial++) {
    const prefix = `KENBLOGANNOTATION${serial}BOUNDARY`;
    if (!source.includes(prefix)) return prefix;
  }
  return null;
}

/** 원문의 후보를 마커로 치환하되 나중에 위치를 복원할 대응을 기록한다. */
function prepare(source: string, found: Candidate[], prefix: string): string {
  let transformed = "";
  let cursor = 0;
  found.forEach((candidate, index) => {
    transformed += source.slice(cursor, candidate.start);
    candidate.marker = `${prefix}${index}END`;
    candidate.transformedStart = transformed.length;
    transformed += candidate.marker;
    candidate.transformedEnd = transformed.length;
    cursor = candidate.end;
  });
  return transformed + source.slice(cursor);
}

/** 치환 뒤의 offset을 원문 offset으로 이분 탐색해 복원한다. */
function originalOffset(offset: number, found: Candidate[], endBoundary: boolean): number {
  let left = 0;
  let right = found.length;
  while (left < right) {
    const middle = (left + right) >>> 1;
    if (found[middle].transformedStart <= offset) left = middle + 1;
    else right = middle;
  }
  const candidate = found[left - 1];
  if (!candidate) return offset;
  if (offset === candidate.transformedStart) return candidate.start;
  if (offset < candidate.transformedEnd) return endBoundary ? candidate.end : candidate.start;
  return offset + candidate.end - candidate.transformedEnd;
}

/** CRLF도 한 줄로 취급하기 위해 원문 줄 시작 offset을 모은다. */
function lineStarts(source: string): number[] {
  const starts = [0];
  for (let index = 0; index < source.length; index++) if (source[index] === "\n") starts.push(index + 1);
  return starts;
}

/** 원문 offset을 행·열·offset을 갖춘 unist 위치로 만든다. */
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

/** 후보는 최종 문서 해석 전까지도 텍스트로만 렌더해 이미지·HTML 실행을 막는다. */
function candidateNode(candidate: Candidate, starts: number[]): RootContent {
  return { type: "kenAnnotationCandidate", raw: candidate.raw, kind: candidate.kind,
    name: candidate.name, content: candidate.content,
    data: { hName: "span", hChildren: [{ type: "text", value: candidate.raw }] },
    position: { start: sourcePoint(starts, candidate.start), end: sourcePoint(starts, candidate.end) },
  } as unknown as RootContent;
}

/** 파싱 결과의 마커 텍스트를 원문 후보 노드로 바꿔 주변 Markdown 구조를 유지한다. */
function restoreCandidates(root: Root, found: Candidate[], starts: number[], prefix: string): void {
  const marker = new RegExp(`${prefix}([0-9]+)END`, "g");
  const visit = (children: RootContent[]): RootContent[] => {
    const output: RootContent[] = [];
    for (const node of children) {
      const typed = node as RootContent & { value?: string; children?: RootContent[] };
      if (node.type === "text" && typeof typed.value === "string") {
        let cursor = 0;
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
  root.children = visit(root.children);
}

/** 마커 때문에 이동한 일반 AST 노드 위치를 원문의 LF/CRLF 위치로 되돌린다. */
function restorePositions(node: PositionedNode, found: Candidate[], starts: number[]): void {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (start !== undefined && end !== undefined && node.type !== "kenAnnotationCandidate") {
    node.position = { start: sourcePoint(starts, originalOffset(start, found, false)),
      end: sourcePoint(starts, originalOffset(end, found, true)) };
  }
  for (const child of node.children ?? []) restorePositions(child, found, starts);
}

/** 과도한 후보 수나 마커 충돌에서는 문서 전체를 텍스트만 있는 원문 노드로 남긴다. */
function rawDocument(source: string): Root {
  const starts = lineStarts(source);
  return { type: "root", children: [{ type: "kenAnnotationRaw", value: source,
    data: { hName: "pre", hChildren: [{ type: "text", value: source }] },
    position: { start: sourcePoint(starts, 0), end: sourcePoint(starts, source.length) },
  } as unknown as RootContent] };
}

/** 수식 문법 다음, 안전 접기 재파싱에서도 공유하는 주석 우선 파싱 결과. */
export function parseAnnotationMarkdown(source: string): Root {
  if (sourceTooLarge(source)) return rawDocument(source);
  const root = parseMathMarkdown(source);
  const found = candidates(source, excludedMask(source, root));
  if (found === null) return rawDocument(source);
  if (!found.length) return root;
  const prefix = markerPrefix(source);
  if (!prefix) return rawDocument(source);
  const modified = prepare(source, found, prefix);
  const parsed = parseMathMarkdown(modified);
  const starts = lineStarts(source);
  restoreCandidates(parsed, found, starts, prefix);
  restorePositions(parsed as PositionedNode, found, starts);
  return parsed;
}

/** React Markdown에서 수식 다음·안전 접기 이전에 쓰는 주석 구문 플러그인. */
export function remarkAnnotationSyntax() {
  return (root: Root, file: { value: unknown }) => { root.children = parseAnnotationMarkdown(String(file.value)).children; };
}

/** 허용한 링크 주소만 주석 본문에서 활성화하고 나머지는 원문 후보로 남긴다. */
function safeLink(url: string): boolean {
  if (/[\u0000-\u001f\u007f\\]/.test(url)) return false;
  return url.startsWith("#") || (url.startsWith("/") && !url.startsWith("//")) ||
    /^(https?:|mailto:)/i.test(url) || /^[^:/?#][^:]*$/.test(url);
}

/** 주석 본문을 한 문단의 안전한 인라인 문법으로 제한한다. */
function validContent(content: string): boolean {
  if (!content || content.length > MAX_CONTENT || /\r|\n/.test(content)) return false;
  const root = parseMathMarkdown(content);
  if (root.children.length !== 1 || root.children[0].type !== "paragraph") return false;
  const visit = (node: RootContent): boolean => {
    if (node.type === "text" || node.type === "inlineCode" || (node as { type: string }).type === "kenMathInline") return true;
    if (node.type === "strong" || node.type === "emphasis") return node.children.every(visit);
    if (node.type === "link") return safeLink(node.url) && node.children.every(visit);
    return false;
  };
  return root.children[0].children.every(visit);
}

/** 안전 접기 그룹화 후 실제로 남은 후보만 문서 전체 순서로 해석한다. */
export function resolveAnnotationDocument(root: Root): AnnotationItem[] {
  const nodes: CandidateNode[] = [];
  const visit = (node: RootContent | Root) => {
    if ((node as { type: string }).type === "kenAnnotationCandidate") { nodes.push(node as unknown as CandidateNode); return; }
    for (const child of "children" in node ? node.children : []) visit(child);
  };
  visit(root);
  nodes.sort((left, right) => (left.position?.start.offset ?? 0) - (right.position?.start.offset ?? 0));
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
  for (const node of nodes) {
    let item: AnnotationItem | undefined;
    if (node.kind === "anonymous" && valid.get(node)) {
      anonymousNumber++;
      item = { index: items.length, label: String(anonymousNumber), content: node.content!,
        firstRef: occurrence, refs: [] };
      items.push(item);
    } else if ((node.kind === "definition" && valid.get(node)) || node.kind === "reference") {
      const content = node.name ? definitions.get(node.name) : undefined;
      if (content && node.name) {
        item = named.get(node.name);
        if (!item) {
          item = { index: items.length, label: node.name, content, firstRef: occurrence, refs: [] };
          named.set(node.name, item);
          items.push(item);
        }
      }
    }
    if (!item) {
      node.data = { hName: "span", hChildren: [{ type: "text", value: node.raw }] };
      continue;
    }
    item.refs.push(occurrence);
    node.data = { hName: "sup", hProperties: { className: ["ken-annotation-ref"],
      "data-annotation-index": String(item.index), "data-annotation-occurrence": String(occurrence) },
    hChildren: [{ type: "text", value: `[${item.label}]` }] };
    occurrence++;
  }
  return items;
}

/** 안전 접기 뒤에 문서 범위의 정의·참조를 확정하는 remark 플러그인. */
export function remarkResolveAnnotations() {
  return (root: Root) => { resolveAnnotationDocument(root); };
}
