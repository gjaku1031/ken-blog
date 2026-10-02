/**
 * Mermaid 문법과 SVG를 브라우저의 외부 자원 경계 안에 제한함
 */

export type MermaidTheme = "light" | "dark";

/**
 * 도식 원문 길이 상한
 */
export const MAX_MERMAID_LENGTH = 12 * 1024;
/**
 * 도식 원문 줄 수 상한
 */
export const MAX_MERMAID_LINES = 200;
/**
 * 도식 연결 수 상한
 */
export const MAX_MERMAID_EDGES = 100;

/**
 * 허용 SVG 네임스페이스
 */
const SVG_NS = "http://www.w3.org/2000/svg";
/**
 * 허용 SVG 요소
 */
const SVG_TAGS = new Set([
  "svg", "g", "defs", "marker", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "text", "tspan",
  "title", "desc", "style", "linearGradient", "radialGradient", "stop", "clipPath", "mask", "pattern", "symbol",
  "filter", "feDropShadow",
]);
/**
 * 허용 SVG 속성
 */
const SVG_ATTRIBUTES = new Set([
  "xmlns", "xmlns:xlink", "id", "class", "role", "aria-label", "aria-labelledby", "aria-describedby", "aria-roledescription",
  "width", "height", "viewBox", "preserveAspectRatio", "version", "x", "y", "x1", "x2", "y1", "y2", "dx", "dy", "cx", "cy",
  "r", "rx", "ry", "d", "points", "transform", "fill", "fill-rule", "fill-opacity", "stroke", "stroke-width",
  "stroke-dasharray", "stroke-dashoffset", "stroke-linecap", "stroke-linejoin", "stroke-opacity", "opacity", "marker-end",
  "marker-start", "marker-mid", "markerWidth", "markerHeight", "markerUnits", "refX", "refY", "orient", "clip-path",
  "clipPathUnits", "mask", "maskUnits", "maskContentUnits", "offset", "stop-color", "stop-opacity", "gradientUnits",
  "gradientTransform", "spreadMethod", "style", "text-anchor", "dominant-baseline", "alignment-baseline", "baseline-shift",
  "font-size", "font-family", "font-weight", "font-style", "text-decoration", "letter-spacing", "word-spacing", "line-height",
  "textLength", "lengthAdjust", "vector-effect", "paint-order", "shape-rendering", "pointer-events", "tabindex", "focusable",
  "clip-rule", "flood-color", "flood-opacity", "stdDeviation", "name",
]);
/**
 * 동일 SVG 내부 참조 패턴
 */
const FRAGMENT_URL = /^url\(\s*['"]?#[-\w:.]+['"]?\s*\)$/i;
/**
 * CSS URL 표현식 패턴
 */
const ANY_URL = /url\s*\([^)]*\)/gi;

/**
 * 지원 도식의 원문 크기와 외부 자원·설정·스타일 기능을 검사하고 실패 이유를 반환함
 */
export function mermaidSourceError(source: string): string | null {
  const lines = source.split(/\r\n|\r|\n/);
  const lineCount = lines.length - (lines.at(-1) === "" ? 1 : 0);
  if (new TextEncoder().encode(source).length > MAX_MERMAID_LENGTH || lineCount > MAX_MERMAID_LINES)
    return "도식이 길어 원문으로 표시합니다.";
  if (!/^(?:flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram)\b/.test(source.trimStart()))
    return "지원하지 않는 Mermaid 도식은 원문으로 표시합니다.";
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(source))
    return "제어 문자가 있는 도식은 원문으로 표시합니다.";
  // Mermaid의 strict 설정은 소스 directive, image shape, 사용자 CSS 자체를 제거하지 않음
  if (/%%\s*\{|^\s*---(?:\s|$)|@\s*\{|(?:^|[;\r\n])\s*(?:click|callback|link|links|style|classDef|linkStyle|cssClass)\b/im.test(source) ||
    /(?:\b(?:https?|ftp|file|data|blob|javascript):|\/\/|url\s*\(|@import\b|@font-face\b|\b(?:-webkit-)?image-set\s*\(|\bcross-fade\s*\(|\bpaint\s*\(|\b(?:src|href|img|image|icon)\s*[:=]|\bfa:|!\[|<\s*\/?\s*[a-z!]|&#|&(?:lt|gt|amp|quot|apos);)/i.test(source))
    return "외부 자원이나 사용자 설정이 포함된 도식은 원문으로 표시합니다.";
  return null;
}

/**
 * 브라우저가 해석할 CSS의 외부 참조와 실행성 표현을 거부함
 */
function safeCss(value: string): boolean {
  if (/[\\@]|\b(?:expression|behavior|import|font-face|image-set|cross-fade|paint)\b|\bsrc\s*:|(?:https?|ftp|file|data|blob|javascript):|\/\//i.test(value)) return false;
  const withoutLocalUrls = value.replace(ANY_URL, (match) => FRAGMENT_URL.test(match) ? "" : "UNSAFE_URL");
  return !/UNSAFE_URL|url\s*\(/i.test(withoutLocalUrls);
}

/**
 * 고정 Mermaid 12 테마가 항상 넣는 두 애니메이션 선언만 제거함
 */
function withoutFixedAnimations(value: string): string {
  return value.replaceAll("@keyframes edge-animation-frame{from{stroke-dashoffset:0;}}", "")
    .replaceAll("@keyframes dash{to{stroke-dashoffset:0;}}", "");
}

/**
 * Mermaid 출력의 XML 요소·속성·CSS를 검증하고 외부 참조가 없는 SVG만 돌려줌
 *
 * 1. XML 크기·선언·루트 요소 검사
 * 2. 허용한 요소·속성·CSS만 통과시키고 내부 참조 수집
 * 3. 실제 SVG 요소의 모든 참조 ID 존재 확인
 */
export function sanitizeMermaidSvg(svg: string): string {
  // XML 크기·선언·루트 요소 검사
  if (svg.length > 512 * 1024 || /<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(svg)) throw new Error("도식 SVG 크기 또는 선언 오류");
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  if (doc.querySelector("parsererror") || doc.documentElement.namespaceURI !== SVG_NS || doc.documentElement.localName !== "svg")
    throw new Error("도식 SVG 형식 오류");
  const ids = new Set<string>();
  const references: string[] = [];
  const elements = [doc.documentElement, ...Array.from(doc.documentElement.querySelectorAll("*"))];
  if (elements.length > 4000) throw new Error("도식 SVG 복잡도 초과");
  // 허용한 요소·속성·CSS만 통과시키고 내부 참조 수집
  for (const element of elements) {
    if (element.namespaceURI !== SVG_NS || !SVG_TAGS.has(element.localName)) throw new Error("도식 SVG 요소 오류");
    if (element.localName === "style") {
      const css = withoutFixedAnimations(element.textContent || "");
      if (!safeCss(css) || element.children.length) throw new Error("도식 SVG 스타일 오류");
      element.textContent = css;
    }
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name;
      const value = attribute.value;
      if (!SVG_ATTRIBUTES.has(name) && !/^data-[\w-]+$/.test(name)) throw new Error("도식 SVG 속성 오류");
      if (name === "xmlns" || name === "xmlns:xlink") {
        if (value !== (name === "xmlns" ? SVG_NS : "http://www.w3.org/1999/xlink")) throw new Error("도식 SVG 네임스페이스 오류");
        continue;
      }
      if (name.toLowerCase().startsWith("on") || /(?:https?|ftp|file|data|blob|javascript):|\/\//i.test(value))
        throw new Error("도식 SVG 외부 참조 오류");
      if (name === "style" && !safeCss(value)) throw new Error("도식 SVG 인라인 스타일 오류");
      if (name === "id") {
        if (!/^[-\w:.]+$/.test(value) || ids.has(value)) throw new Error("도식 SVG ID 오류");
        ids.add(value);
      }
      if (value.includes("url(") || /url\s*\(/i.test(value)) {
        if (!FRAGMENT_URL.test(value) && name !== "style") throw new Error("도식 SVG URL 오류");
      }
      for (const match of value.matchAll(/url\(\s*['"]?#([-\w:.]+)['"]?\s*\)/gi)) references.push(match[1]);
    }
  }
  // 고정 테마 CSS에는 현재 look에서 쓰지 않는 내부 gradient 규칙도 포함됨
  // CSS 자체는 내부 #fragment만 허용하며, 실제 SVG 요소의 참조만 존재 여부를 검사함
  // 실제 SVG 요소의 모든 참조 ID 존재 확인
  if (references.some((id) => !ids.has(id))) throw new Error("도식 SVG 참조 오류");
  // Blob 이미지 문서의 ID는 도식별로 격리되며 모든 fragment는 같은 SVG 안에서만 해석됨
  return new XMLSerializer().serializeToString(doc.documentElement);
}

/**
 * 취소 가능한 Mermaid 렌더 작업
 */
type Job = {
  /**
   * 원문
   */
  source: string;
  /**
   * 렌더 테마
   */
  theme: MermaidTheme;
  /**
   * 작업 취소 신호
   */
  signal: AbortSignal;
  /**
   * 렌더 성공 결과 전달
   */
  resolve: (svg: string) => void;
  /**
   * 렌더 실패 전달
   */
  reject: (error: Error) => void;
  /**
   * 취소 시 대기 작업 정리
   */
  onAbort: () => void;
};

/**
 * 대기 중인 도식 렌더 작업
 */
const jobs: Job[] = [];
/**
 * 렌더 큐 실행 여부
 */
let running = false;
/**
 * 도식별 고유 ID 순번
 */
let sequence = 0;

/**
 * Mermaid 전역 설정을 직렬화하고 해제된 화면의 대기 작업을 건너뜀
 *
 * 1. 전역 Mermaid 설정이 겹치지 않도록 단일 소비자 유지
 * 2. 취소된 작업을 건너뛰고 대기 순서대로 처리
 * 3. 외부 자원·사용자 설정을 제한한 렌더 환경 구성
 * 4. 격리 컨테이너에서 렌더 후 SVG 재검증
 * 5. 실패·취소도 컨테이너·리스너·원문 해제
 */
async function drainQueue(): Promise<void> {
  // 전역 Mermaid 설정이 겹치지 않도록 단일 소비자 유지
  if (running) return;
  running = true;
  try {
    // 취소된 작업을 건너뛰고 대기 순서대로 처리
    while (jobs.length) {
      const job = jobs.shift()!;
      if (job.signal.aborted) {
        job.signal.removeEventListener("abort", job.onAbort);
        job.source = "";
        continue;
      }
      let container: HTMLDivElement | null = null;
      try {
        const { default: mermaid } = await import("mermaid");
        if (job.signal.aborted) continue;
        // 외부 자원·사용자 설정을 제한한 렌더 환경 구성
        mermaid.initialize({ startOnLoad: false, securityLevel: "strict", htmlLabels: false,
          suppressErrorRendering: true, maxTextSize: MAX_MERMAID_LENGTH, maxEdges: MAX_MERMAID_EDGES,
          theme: job.theme === "dark" ? "dark" : "default", layout: "dagre", look: "classic",
          fontFamily: "Arial, sans-serif", arrowMarkerAbsolute: false,
          secure: ["securityLevel", "startOnLoad", "maxTextSize", "maxEdges", "suppressErrorRendering", "theme",
            "themeVariables", "themeCSS", "htmlLabels", "fontFamily", "layout", "look", "arrowMarkerAbsolute"] });
        container = document.createElement("div");
        container.style.cssText = "position:fixed;left:-100000px;top:0;opacity:0;pointer-events:none;z-index:-1";
        container.setAttribute("aria-hidden", "true");
        document.body.appendChild(container);
        const id = `ken_mermaid_${++sequence}_${crypto.randomUUID().replaceAll("-", "")}`;
        // 격리 컨테이너에서 렌더 후 SVG 재검증
        const result = await mermaid.render(id, job.source, container);
        if (!job.signal.aborted) job.resolve(sanitizeMermaidSvg(result.svg));
      } catch {
        if (!job.signal.aborted) job.reject(new Error("도식을 표시할 수 없습니다."));
      } finally {
        // 실패·취소도 컨테이너·리스너·원문 해제
        container?.remove();
        job.signal.removeEventListener("abort", job.onAbort);
        job.source = "";
      }
    }
  } finally {
    running = false;
  }
}

/**
 * 취소할 수 있는 렌더 작업을 예약하며 결과 SVG는 컴포넌트가 만든 Blob URL에만 사용함
 *
 * 1. 이미 취소된 요청은 큐에 넣지 않음
 * 2. 대기 중 취소 시 큐 제거·실패 전달
 * 3. 취소 구독 후 직렬 렌더 큐에 등록
 */
export function renderMermaid(source: string, theme: MermaidTheme, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    // 이미 취소된 요청은 큐에 넣지 않음
    if (signal.aborted) { reject(new DOMException("취소됨", "AbortError")); return; }
    // 대기 중 취소 시 큐 제거·실패 전달
    const job: Job = { source, theme, signal, resolve, reject, onAbort: () => {
      const index = jobs.indexOf(job);
      if (index >= 0) { jobs.splice(index, 1); job.source = ""; }
      reject(new DOMException("취소됨", "AbortError"));
    } };
    // 취소 구독 후 직렬 렌더 큐에 등록
    signal.addEventListener("abort", job.onAbort, { once: true });
    jobs.push(job);
    void drainQueue();
  });
}
