import vowserLayout from "./vowser-architecture-layout.json" with { type: "json" };
import kenBlogLayout from "./ken-blog-architecture-layout.json" with { type: "json" };
import kenBlogSystemLayout from "./ken-blog-system-layout.json" with { type: "json" };
import vowserSystemLayout from "./vowser-system-layout.json" with { type: "json" };

/**
 * 게시글에서 선택할 수 있는 로컬 아키텍처 배치
 */
const REFERENCE_LAYOUTS = { "vowser-infrastructure": vowserLayout, "ken-blog-infrastructure": kenBlogLayout, "ken-blog-system": kenBlogSystemLayout, "vowser-system": vowserSystemLayout };

/**
 * 원고의 명시적 주석으로 기준 배치를 선택하며 누락·중복·미등록 이름은 거부함
 */
function referenceLayout(source: string) {
  const markers = [...source.matchAll(/^\s*%% layout: ([\w-]+)\s*$/gm)];
  const name = markers[0]?.[1];
  if (markers.length !== 1 || !Object.hasOwn(REFERENCE_LAYOUTS, name)) throw new Error("등록되지 않은 기준 배치입니다.");
  return REFERENCE_LAYOUTS[name as keyof typeof REFERENCE_LAYOUTS];
}

/**
 * SVG 도형을 생성하는 고정 네임스페이스
 */
const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * 원본의 열람·실행·배포·제어·DNS 연결 구분. 네 번째 값은 선 두께(px), 생략하면 1.5
 */
const EDGE_STYLES = {
  read: ["#2563eb", "#7aa7ff", "", "3"],
  runtime: ["#566675", "#b5c1ce", ""],
  delivery: ["#287d53", "#75cb9f", "7 4"],
  control: ["#8658a8", "#c19bdf", "3 4"],
  reference: ["#75828c", "#a2adb8", "4 5"],
} as const;

/**
 * 원고의 구성 요소·소속·그룹 문구·연결 선언이 원본 배치와 일치하는지 검증함
 *
 * 1. 등록 배치 선택 후 지원하는 선언만 읽음
 * 2. 그룹·연결 원문과 서비스 소속을 대조하여 고정 설명이 변경을 숨기지 않게 함
 * 3. 배치에서 표시할 서비스 이름 반환
 */
export function validateReferenceLayout(source: string): Map<string, string> {
  const layout = referenceLayout(source);
  // 원본이 사용하는 단방향 서비스 연결만 읽고 나머지 문법은 명시적으로 거부함
  const services = [...source.matchAll(/^\s*service (\w+)\([^\n]*?\)\[([^\]\n]+)\](?: in (\w+))?\s*$/gm)];
  const groups = [...source.matchAll(/^\s*group (\w+)(?:\([^\n]*?\))?\[[^\]\n]+\](?: in (\w+))?\s*$/gm)];
  const edges = [...source.matchAll(/^\s*(\w+)(\{group\})?:[TBLR]\s+-[^\n]*?>\s+[TBLR]:(\w+)(\{group\})?\s*$/gm)];
  const recognized = new Set([...services, ...groups, ...edges].map(match => match[0].trim()));
  if (source.split(/\r?\n/).map(line => line.trim()).some(line => line &&
    !/^(?:architecture-beta$|%%|align (?:row|column) \w+(?: \w+)*$)/.test(line) && !recognized.has(line)))
    throw new Error("기준 배치에서 지원하지 않는 구성 문법입니다.");

  /**
   * 순서와 무관하게 항목·중복 개수까지 일치하는지 비교함
   */
  const same = (actual: string[], expected: string[]) => actual.sort().join("\n") === expected.sort().join("\n");

  /**
   * 배치와 비교할 선언의 줄·공백 정규화
   */
  const declarations = (matches: RegExpMatchArray[]) => matches.map(match => match[0].trim().replace(/\s+/g, ' '));
  // 고정 한글 설명이 원고의 문구·아이콘·연결 방향 변경을 숨기지 않도록 원본 선언도 비교
  if (!same(declarations(groups), [...layout.sourceGroups]) || !same(declarations(edges), [...layout.sourceEdges]))
    throw new Error('원고와 기준 배치의 그룹 설명·연결 선언이 다릅니다.');
  if (!same(services.map(([, id, , parent]) => `${id}:${parent ?? ""}`), Object.entries(layout.members).map(([id, parent]) => `${id}:${parent}`)) ||
    !same(groups.map(([, id, parent]) => `${id}:${parent ?? ""}`), Object.entries(layout.parents).map(([id, parent]) => `${id}:${parent}`)) ||
    !same(edges.map(([, from, groupFrom, to, groupTo]) => `${from}${groupFrom ?? ""}>${to}${groupTo ?? ""}`),
      layout.edges.map(edge => `${edge.source}>${edge.target}${edge.groupTarget ? "{group}" : ""}`)))
    throw new Error("원고와 기준 배치의 구성·연결이 다릅니다.");
  return new Map(services.map(([, id, title]) => [id, title]));
}

/**
 * 검증된 Mermaid SVG의 로고를 유지하면서 프로젝트의 단일 화면 배치를 적용함
 *
 * 1. 원고와 기준 배치의 구성·연결 일치 검증
 * 2. 그룹 영역 및 서비스 좌표·이름 재배치
 * 3. 실행·배포·제어 연결을 원본의 경로로 표시
 * 4. 한 장에 들어오는 SVG 경계와 범례 설정
 */
export function applyReferenceLayout(svg: string, source: string, theme: "light" | "dark"): string {
  // 검증된 입력을 별도 XML 문서에서 수정하며 화면 DOM에는 직접 삽입하지 않음
  const titles = validateReferenceLayout(source);
  const layout = referenceLayout(source);
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  const root = doc.documentElement;
  const groups = doc.querySelector(".architecture-groups")!;
  const edges = doc.querySelector(".architecture-edges")!;
  const prefix = root.id;
  const foreground = theme === "dark" ? "#e3e9ef" : "#263645";
  const muted = theme === "dark" ? "#bdc8d3" : "#586b7b";

  /**
   * 문서 내부에 SVG 요소를 만들고 고정값·숫자로 속성을 설정함
   */
  function element(tag: string, attrs: Record<string, string | number>, parent: Element): SVGElement {
    const node = doc.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
    parent.appendChild(node);
    return node;
  }

  /**
   * 연결선과 겹치지 않는 배경판을 가진 한 줄 설명 생성
   */
  function label(parent: Element, text: string, x: number, y: number, size: number, color = foreground, weight = 400, anchor = "start") {
    const group = element("g", {}, parent);
    element("rect", { class: "background", style: "stroke:none" }, group);
    const node = element("text", { x, y, "text-anchor": anchor,
      style: `font-size:${size}px;fill:${color};font-weight:${weight};font-family:Arial,sans-serif` }, group);
    node.textContent = text;
  }

  // 원본의 상위 영역부터 하위 영역 순서로 배경을 생성함
  groups.replaceChildren();
  for (const [id, values] of Object.entries(layout.groups)) {
    const [x, y, width, height, title] = values as [number, number, number, number, string];
    element("rect", { id: `${prefix}-group-${id}`, x, y, width, height }, groups);
    label(groups, title, x + 10, y + 20, 14, foreground, 600);
  }
  // 아이콘은 Mermaid가 생성한 로고를 그대로 사용하고 이름을 오른쪽에 붙임
  for (const [id, values] of Object.entries(layout.services)) {
    const [x, y, detail] = values as [number, number, string];
    const service = doc.querySelector(`[id$="-service-${id}"]`)!;
    service.setAttribute("transform", `translate(${x},${y})`);
    for (const child of Array.from(service.children)) if (child.querySelector("text")) child.remove();
    label(service, titles.get(id)!, 56, 20, 14, foreground, 600);
    label(service, detail, 56, 38, 11, muted);
  }
  // 긴 연결은 구역 바깥을 돌아가도록 하여 아이콘과 영역 이름을 관통하지 않게 함
  edges.replaceChildren();
  for (const edge of layout.edges) {
    const palette = EDGE_STYLES[edge.kind as keyof typeof EDGE_STYLES];
    const color = palette[theme === "dark" ? 1 : 0];
    const group = element("g", { "data-from": edge.source, "data-to": edge.target }, edges);
    element("path", { d: edge.points.map(([x, y], index) => `${index ? "L" : "M"}${x},${y}`).join(" "),
      style: `fill:none;stroke:${color};stroke-width:${palette[3] ?? "1.5"}px;stroke-dasharray:${palette[2] || "none"};stroke-linejoin:round` }, group);
    const [x, y] = edge.points.at(-1)!;
    const [previousX, previousY] = edge.points.at(-2)!;
    const angle = Math.atan2(y - previousY, x - previousX);
    const tailX = x - 7 * Math.cos(angle);
    const tailY = y - 7 * Math.sin(angle);
    element("polygon", { points: `${x},${y} ${tailX - 3 * Math.sin(angle)},${tailY + 3 * Math.cos(angle)} ${tailX + 3 * Math.sin(angle)},${tailY - 3 * Math.cos(angle)}`,
      style: `fill:${color};stroke:none` }, group);
    if (edge.label) label(group, edge.label, edge.at[0], edge.at[1], 11, color, 400, "middle");
  }
  // 범례는 오른쪽 아래 빈 영역의 상자 안에 선 종류별로 한 줄씩 배치함
  const legend = element("g", {}, root);
  const legendRow = 24, legendPad = 14, legendWidth = 250;
  const legendHeight = legendPad * 2 + 20 + layout.legend.length * legendRow;
  const legendX = layout.width - legendWidth, legendY = layout.height - legendHeight;
  element("rect", { x: legendX, y: legendY, width: legendWidth, height: legendHeight, rx: 6,
    style: `fill:none;stroke:${muted};stroke-width:1px;stroke-opacity:0.6` }, legend);
  label(legend, "범례", legendX + legendPad, legendY + legendPad + 10, 12, foreground, 600);
  layout.legend.forEach(({ title, kind }, index) => {
    const palette = EDGE_STYLES[kind as keyof typeof EDGE_STYLES];
    const color = palette[theme === "dark" ? 1 : 0];
    const y = legendY + legendPad + 20 + legendRow * index + legendRow / 2;
    element("path", { d: `M${legendX + legendPad},${y} h30`, style: `fill:none;stroke:${color};stroke-width:${palette[3] ?? "1.5"}px;stroke-dasharray:${palette[2] || "none"}` }, legend);
    label(legend, title, legendX + legendPad + 39, y + 4, 12, muted);
  });
  root.setAttribute("viewBox", `-16 -20 ${layout.width + 32} ${layout.height + 20}`);
  root.setAttribute("style", "max-width:100%;background:transparent");
  return new XMLSerializer().serializeToString(root);
}
