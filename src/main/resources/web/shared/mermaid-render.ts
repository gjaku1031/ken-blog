import { ARCHITECTURE_LAYOUT, architectureIconError, styleArchitectureSvg } from "./mermaid-architecture.ts";

/**
 * Mermaid 밝은·어두운 테마
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
 * Mermaid 도식의 최대 기준 글자 크기, 본문에서 확대 없이 표시될 때의 크기
 */
const MERMAID_FONT_SIZE = 14;

/**
 * ERD 그룹 제목 아래에 관계 끝 표시가 놓이지 않도록 확보할 여백
 */
const ERD_GROUP_TITLE_MARGIN = { top: 18, bottom: 12 } as const;

/**
 * ERD 그룹 제목을 둘 그룹 왼쪽 테두리로부터의 거리
 */
const ERD_GROUP_LABEL_INSET = 12;

/**
 * ERD 표시 배율. 표 행 높이와 여백이 커서 기준 글자 크기 그대로면 본문보다 커 보임
 */
const ERD_DISPLAY_SCALE = 0.85;

/**
 * SVG의 고유 표시 크기를 배율만큼 줄임. viewBox는 유지해 그림 비율과 확대 보기는 그대로 둠
 */
function scaleSvgSize(svg: string, scale: number): string {
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  for (const name of ["width", "height"]) {
    const value = Number(doc.documentElement.getAttribute(name));
    if (Number.isFinite(value) && value > 0) doc.documentElement.setAttribute(name, String(Math.round(value * scale)));
  }
  return new XMLSerializer().serializeToString(doc);
}

/**
 * 범례 주석에서 쓸 수 있는 선 종류와 모양
 */
const LEGEND_LINES = {
  thick: { width: 3.5, dash: "none" },
  solid: { width: 2, dash: "none" },
  dotted: { width: 2, dash: "3 3" },
} as const;

/**
 * 범례가 원래 크기로 보이는 도식 표시 폭. 이보다 넓은 도식은 범례를 비례해 키움
 */
const LEGEND_DISPLAY_WIDTH = 800;

/**
 * 범례 항목. 선 종류, 노드 모양(round·diamond), ERD 관계 끝(zero·many), 색 견본(color)
 */
type LegendItem =
  | { kind: keyof typeof LEGEND_LINES | "round" | "diamond" | "zero" | "many"; title: string }
  | { kind: "color"; fill: string; stroke: string; title: string };

/**
 * 원문의 `%% legend: ...` 주석을 범례 항목으로 읽음
 *
 * 항목은 `종류=설명`을 `;`로 구분함. 색 견본은 `color:#채움:#테두리=설명`
 * 예: `%% legend: color:#eff6ff:#2563eb=독자 행동; round=시작·끝; diamond=판단; solid=요청`
 */
function legendItems(source: string): LegendItem[] {
  const line = source.match(/^\s*%%\s*legend:\s*(.+)$/m)?.[1];
  if (!line) return [];
  const items: LegendItem[] = [];
  for (const part of line.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const key = part.slice(0, index).trim(), title = part.slice(index + 1).trim().slice(0, 40);
    if (!title) continue;
    const color = key.match(/^color:(#[0-9a-fA-F]{6}):(#[0-9a-fA-F]{6})$/);
    if (color) items.push({ kind: "color", fill: color[1], stroke: color[2], title });
    else if (key in LEGEND_LINES || ["round", "diamond", "zero", "many"].includes(key))
      items.push({ kind: key as Exclude<LegendItem["kind"], "color">, title });
  }
  return items.slice(0, 12);
}

/**
 * 도식 아래 오른쪽에 범례 상자를 붙이고 viewBox를 그만큼 늘림
 */
function appendLegend(svg: string, items: LegendItem[], theme: "light" | "dark"): string {
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  const root = doc.documentElement;
  const box = root.getAttribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
  if (!box || box.length !== 4 || box.some(value => !Number.isFinite(value))) return svg;
  const [left, top, width, height] = box;
  const line = theme === "dark" ? "#c9d1d9" : "#333333";
  const text = theme === "dark" ? "#bdc8d3" : "#586b7b";
  const pad = 14, row = 24, gap = 12;
  // 글자 폭은 렌더링 전에 잴 수 없어 한글 12px, 그 밖 7px로 어림함
  const textWidth = Math.max(...items.map(({ title }) => [...title].reduce((sum, char) => sum + (/[\u3131-\uD79D]/.test(char) ? 12 : 7), 0)), 24);
  const boxWidth = pad * 2 + 39 + textWidth, boxHeight = pad * 2 + 20 + items.length * row;
  // 본문 폭(약 800px)보다 넓은 도식은 화면에서 줄어들므로 범례를 그만큼 키워 표시 크기를 일정하게 유지함
  const scale = Math.max(1, width / LEGEND_DISPLAY_WIDTH);
  const originX = left + width - boxWidth * scale, originY = top + height + gap * scale;
  const x = 0, y = 0;
  const ns = "http://www.w3.org/2000/svg";
  const make = (name: string, attrs: Record<string, string | number>, parent: Element) => {
    const node = doc.createElementNS(ns, name);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
    parent.appendChild(node);
    return node;
  };
  const stroke = (color = line, width = 1.5, dash = "none") => `fill:none;stroke:${color};stroke-width:${width}px;stroke-dasharray:${dash}`;
  const group = make("g", { transform: `translate(${originX},${originY}) scale(${scale})` }, root);
  make("rect", { x, y, width: boxWidth, height: boxHeight, rx: 6, style: `fill:none;stroke:${text};stroke-width:1px;stroke-opacity:0.6` }, group);
  make("text", { x: x + pad, y: y + pad + 10, style: `font-size:12px;font-weight:600;fill:${line};font-family:Arial,sans-serif` }, group).textContent = "범례";
  items.forEach((item, index) => {
    const cy = y + pad + 20 + row * index + row / 2, sx = x + pad;
    if (item.kind === "color") {
      // 다크 테마에서는 classDef와 같은 방식으로 채움·테두리를 조정함
      const fill = theme === "dark" ? mixColor(item.stroke, "#111827", 0.18) : item.fill;
      const edge = theme === "dark" ? mixColor(item.stroke, "#ffffff", 0.7) : item.stroke;
      make("rect", { x: sx + 4, y: cy - 7, width: 22, height: 14, rx: 2, style: `fill:${fill};stroke:${edge};stroke-width:1.5px` }, group);
    } else if (item.kind === "round") {
      make("rect", { x: sx + 1, y: cy - 7, width: 28, height: 14, rx: 7, style: stroke() }, group);
    } else if (item.kind === "diamond") {
      make("path", { d: `M${sx + 15},${cy - 8} L${sx + 25},${cy} L${sx + 15},${cy + 8} L${sx + 5},${cy} Z`, style: stroke() }, group);
    } else if (item.kind === "zero") {
      make("path", { d: `M${sx},${cy} h20`, style: stroke() }, group);
      make("circle", { cx: sx + 25, cy, r: 4, style: stroke() }, group);
    } else if (item.kind === "many") {
      make("path", { d: `M${sx},${cy} h30 M${sx + 20},${cy} L${sx + 30},${cy - 6} M${sx + 20},${cy} L${sx + 30},${cy + 6}`, style: stroke() }, group);
    } else {
      const { width: strokeWidth, dash } = LEGEND_LINES[item.kind];
      make("path", { d: `M${sx},${cy} h30`, style: stroke(line, strokeWidth, dash) }, group);
    }
    make("text", { x: sx + 39, y: cy + 4, style: `font-size:12px;fill:${text};font-family:Arial,sans-serif` }, group).textContent = item.title;
  });
  root.setAttribute("viewBox", `${left} ${top} ${width} ${height + (gap + boxHeight) * scale}`);
  return new XMLSerializer().serializeToString(doc);
}

/**
 * ERD 그룹 제목을 그룹 왼쪽 위로 옮김
 *
 * 관계선은 그룹 위쪽 가운데로 자주 들어오므로 가운데 제목이 관계 끝 표시와 겹침
 */
function alignErdGroupLabels(svg: string): string {
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  for (const cluster of doc.querySelectorAll("g.cluster")) {
    const rect = cluster.querySelector(":scope > rect");
    const label = cluster.querySelector(":scope > g.cluster-label");
    const offset = label?.getAttribute("transform")?.match(/^translate\(\s*-?[\d.]+\s*,\s*(-?[\d.]+)\s*\)$/);
    const left = Number(rect?.getAttribute("x"));
    if (!label || !offset || !Number.isFinite(left)) continue;
    label.setAttribute("transform", `translate(${left + ERD_GROUP_LABEL_INSET}, ${offset[1]})`);
  }
  return new XMLSerializer().serializeToString(doc);
}

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
 * 단순한 클래스 이름, 6자리 색상, 제한된 선 두께만 읽음
 */
function colorClass(line: string): {
  /**
   * 이름
   */
  name: string;

  /**
   * 역할별 Mermaid 클래스 스타일
   */
  styles: Record<string, string>
} | null {
  const match = /^[ \t]*classDef[ \t]+([A-Za-z][\w-]{0,31})[ \t]+([^;\r\n]+);?[ \t]*$/.exec(line);
  if (!match) return null;
  const declarations = match[2].split(",").map(value => value.trim());
  if (declarations.length > 4 || !declarations.every(value =>
    /^(?:fill|stroke|color)[ \t]*:[ \t]*#[0-9a-fA-F]{6}$/.test(value) ||
    /^stroke-width[ \t]*:[ \t]*[1-4]px$/.test(value))) return null;
  return { name: match[1], styles: Object.fromEntries(declarations.map(value => value.split(":").map(part => part.trim()))) };
}

/**
 * 기준 색상과 지정 비율로 혼합한 색상 생성
 */
function mixColor(color: string, base: string, weight: number): string {
  return "#" + [1, 3, 5].map(offset => Math.round(
    parseInt(color.slice(offset, offset + 2), 16) * weight +
    parseInt(base.slice(offset, offset + 2), 16) * (1 - weight),
  ).toString(16).padStart(2, "0")).join("");
}

/**
 * 다크 테마의 교차 행·그룹에서도 읽히도록 검증된 색상 선언만 조정함
 */
export function mermaidThemeSource(source: string, theme: MermaidTheme): string {
  if (theme === "light") return source;
  return source.split(/\r\n|\r|\n/).map(line => {
    const definition = colorClass(line);
    if (!definition) return line;
    const { styles } = definition;
    const fill = styles.stroke ?? styles.fill;
    if (styles.fill) styles.fill = mixColor(fill, "#111827", 0.18);
    if (styles.stroke) styles.stroke = mixColor(styles.stroke, "#ffffff", 0.7);
    if (styles.color) styles.color = mixColor(styles.color, "#ffffff", 0.15);
    return `classDef ${definition.name} ${Object.entries(styles).map(([key, value]) => `${key}:${value}`).join(",")}`;
  }).join("\n");
}

/**
 * 지원 도식의 크기를 제한하고, 색상 classDef·로컬 아이콘 이외의 설정·CSS·외부 참조를 거부함
 */
export function mermaidSourceError(source: string): string | null {
  const lines = source.split(/\r\n|\r|\n/);
  const lineCount = lines.length - (lines.at(-1) === "" ? 1 : 0);
  if (new TextEncoder().encode(source).length > MAX_MERMAID_LENGTH || lineCount > MAX_MERMAID_LINES)
    return "도식이 길어 원문으로 표시합니다.";
  if (!/^(?:flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|architecture-beta)\b/.test(source.trimStart()))
    return "지원하지 않는 Mermaid 도식은 원문으로 표시합니다.";
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(source))
    return "제어 문자가 있는 도식은 원문으로 표시합니다.";
  // Mermaid strict만으로는 설정·CSS를 제한할 수 없음 검증된 단색 선언만 예외로 허용함
  if (/%%\s*\{|^\s*---(?:\s|$)|@\s*\{|(?:^|[;\r\n])\s*(?:click|callback|link|links|style|classDef|linkStyle|cssClass)\b/im.test(lines.map(line => colorClass(line) ? "" : line).join("\n")) ||
    /(?:\b(?:https?|ftp|file|data|blob|javascript):|\/\/|url\s*\(|@import\b|@font-face\b|\b(?:-webkit-)?image-set\s*\(|\bcross-fade\s*\(|\bpaint\s*\(|\b(?:src|href|img|image|icon)\s*[:=]|\bfa:|!\[|<\s*\/?\s*[a-z!]|&#|&(?:lt|gt|amp|quot|apos);)/i.test(source))
    return "외부 자원이나 사용자 설정이 포함된 도식은 원문으로 표시합니다.";
  return /^\s*architecture-beta\b/.test(source) ? architectureIconError(source) : null;
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
 */
export function sanitizeMermaidSvg(svg: string): string {
  if (svg.length > 512 * 1024 || /<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(svg)) throw new Error("도식 SVG 크기 또는 선언 오류");
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  if (doc.querySelector("parsererror") || doc.documentElement.namespaceURI !== SVG_NS || doc.documentElement.localName !== "svg")
    throw new Error("도식 SVG 형식 오류");
  const ids = new Set<string>();
  const references: string[] = [];
  const elements = [doc.documentElement, ...Array.from(doc.documentElement.querySelectorAll("*"))];
  if (elements.length > 4000) throw new Error("도식 SVG 복잡도 초과");
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
  if (references.some((id) => !ids.has(id))) throw new Error("도식 SVG 참조 오류");
  // viewBox 치수를 SVG의 고유 크기로 유지해 작은 도식은 확대되지 않게 함
  // 본문보다 넓은 도식은 이미지의 max-width가 줄이고 높이도 같은 비율로 조정함
  const bounds = doc.documentElement.getAttribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
  if (!bounds || bounds.length !== 4 || bounds.some(value => !Number.isFinite(value)) || bounds[2] <= 0 || bounds[3] <= 0)
    throw new Error("도식 SVG 크기 오류");
  doc.documentElement.setAttribute("width", String(bounds[2]));
  doc.documentElement.setAttribute("height", String(bounds[3]));
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
 */
async function drainQueue(): Promise<void> {
  if (running) return;
  running = true;
  try {
    while (jobs.length) {
      const job = jobs.shift()!;
      if (job.signal.aborted) {
        job.signal.removeEventListener("abort", job.onAbort);
        job.source = "";
        continue;
      }
      let container: HTMLDivElement | null = null;
      try {
        const architecture = /^\s*architecture-beta\b/.test(job.source);
        const erDiagram = /^\s*erDiagram\b/.test(job.source);
        const fontSize = architecture ? ARCHITECTURE_LAYOUT.fontSize : MERMAID_FONT_SIZE;
        // 기준 배치와 어긋난 원고는 무거운 Mermaid 초기화·자동 배치 전에 거부
        const reference = architecture && /^\s*%% layout: /m.test(job.source)
          ? await import('./mermaid-reference-layout.ts') : null;
        reference?.validateReferenceLayout(job.source);
        if (job.signal.aborted) continue;
        const { default: mermaid } = await import("mermaid");
        if (architecture) {
          // Architecture에서만 로컬 아이콘 팩을 로딩하며 외부 아이콘 API에는 연결하지 않음
          const { default: icons } = await import("./architecture-icons.json", { with: { type: "json" } });
          mermaid.registerIconPacks([{ name: "ken", icons }]);
        }
        if (job.signal.aborted) continue;
        mermaid.initialize({ startOnLoad: false, securityLevel: "strict", htmlLabels: false,
          suppressErrorRendering: true, maxTextSize: MAX_MERMAID_LENGTH, maxEdges: MAX_MERMAID_EDGES,
          theme: job.theme === "dark" ? "dark" : "default",
          fontSize, themeVariables: { fontSize: `${fontSize}px` },
          flowchart: { subGraphTitleMargin: erDiagram ? ERD_GROUP_TITLE_MARGIN : { top: 0, bottom: 0 } },
          // 그룹과 교차 FK가 있는 ERD는 ELK로 배치하고 다른 도식의 배치는 유지함
          layout: erDiagram ? "elk" : "dagre", look: "classic",
          fontFamily: "Arial, sans-serif", arrowMarkerAbsolute: false,
          architecture: ARCHITECTURE_LAYOUT,
          secure: ["securityLevel", "startOnLoad", "maxTextSize", "maxEdges", "suppressErrorRendering", "theme",
            "themeVariables", "themeCSS", "htmlLabels", "fontFamily", "fontSize", "flowchart", "layout", "look", "arrowMarkerAbsolute", "architecture"] });
        container = document.createElement("div");
        container.style.cssText = "position:fixed;left:-100000px;top:0;opacity:0;pointer-events:none;z-index:-1";
        container.setAttribute("aria-hidden", "true");
        document.body.appendChild(container);
        const id = `ken_mermaid_${++sequence}_${crypto.randomUUID().replaceAll("-", "")}`;
        const result = await mermaid.render(id, mermaidThemeSource(job.source, job.theme), container);
        if (!job.signal.aborted) {
          let svg = sanitizeMermaidSvg(result.svg);
          const legend = architecture ? [] : legendItems(job.source);
          if (legend.length) svg = sanitizeMermaidSvg(appendLegend(svg, legend, job.theme));
          if (erDiagram) svg = scaleSvgSize(sanitizeMermaidSvg(alignErdGroupLabels(svg)), ERD_DISPLAY_SCALE);
          if (reference) {
            // 특정 원본 도식의 배치만 적용하며 구성·연결이 바뀌면 검증에서 중단함
            svg = sanitizeMermaidSvg(reference.applyReferenceLayout(svg, job.source, job.theme));
          }
          if (!job.signal.aborted) job.resolve(architecture
            ? sanitizeMermaidSvg(styleArchitectureSvg(svg, job.theme)) : svg);
        }
      } catch {
        if (!job.signal.aborted) job.reject(new Error("도식을 표시할 수 없습니다."));
      } finally {
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
 * 2. 도식 원문과 아이콘 허용 목록 검증
 * 3. 대기 중 취소 시 큐 제거·실패 전달
 * 4. 취소 구독 후 직렬 렌더 큐에 등록
 */
export function renderMermaid(source: string, theme: MermaidTheme, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    // 이미 취소된 요청은 큐에 넣지 않음
    if (signal.aborted) { reject(new DOMException("취소됨", "AbortError")); return; }
    // 직접 호출에서도 원문 제한과 로컬 아이콘 허용 목록 적용
    const sourceError = mermaidSourceError(source);
    if (sourceError) { reject(new Error(sourceError)); return; }
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
