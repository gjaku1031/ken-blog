/**
 * 외부 조회 없이 번들에서 제공하는 Architecture 아이콘 이름
 */
export const ARCHITECTURE_ICONS = [
  "git", "github", "github-actions", "spring", "mysql", "kotlin", "playwright", "fastapi", "neo4j", "redis",
  "cloudwatch", "eventbridge", "lambda", "fargate", "route53", "rds", "docker", "caddy", "proxmox", "disk", "user",
  "ecr", "alb", "vpn",
] as const;

/**
 * Architecture 서비스의 실제 로고 크기(px); 글자 배치 너비와 별도로 조절함
 */
export const ARCHITECTURE_ICON_SIZE = 36;

/**
 * 긴 제품명이 잘리지 않도록 실제 로고보다 넓은 배치 영역 사용
 */
export const ARCHITECTURE_LAYOUT = {
  seed: 24, iconSize: 48, fontSize: 13, nodeSeparation: 70, idealEdgeLengthMultiplier: 2.3, padding: 28,
};

/**
 * Mermaid가 자체 제공하는 Architecture 아이콘 이름
 */
const BUILTIN_ICONS = new Set(["cloud", "database", "disk", "internet", "server"]);

/**
 * 등록된 로컬 팩과 기본 아이콘만 허용하여 누락·외부 팩 요청을 차단함
 */
export function architectureIconError(source: string): string | null {
  for (const [, icon] of source.matchAll(/\(([^()]*)\)/g)) {
    if (!BUILTIN_ICONS.has(icon) && !ARCHITECTURE_ICONS.some(name => icon === `ken:${name}`))
      return "등록되지 않은 아키텍처 아이콘은 원문으로 표시합니다.";
  }
  return null;
}

/**
 * 그룹별 밝은 배경·경계·어두운 배경 색상
 */
const GROUP_COLORS = [
  ["#eef4ff", "#7195d2", "#17263f"], ["#edf8f3", "#59a78b", "#162e29"], ["#fff5e6", "#d49a45", "#31281b"],
  ["#f4efff", "#a48ad1", "#28213b"], ["#fceef3", "#c77898", "#33202c"],
] as const;

/**
 * 그룹 배경을 연결선 뒤에 배치하고 로고를 테마와 독립적인 흰 타일에 표시함
 *
 * 입력은 공통 SVG 검증을 통과해야 하며, 글자 측정용 DOM은 동기 처리 후 해제함
 *
 * 1. 그룹 배경과 이름의 그리기 순서를 분리하고 팔레트 적용
 * 2. 로고에 흰 타일과 기본 경로 색상 적용
 * 3. 숨긴 SVG에서 글자 크기를 측정하고 이름 배경 생성
 * 4. SVG 직렬화 후 측정 DOM 해제
 */
export function styleArchitectureSvg(svg: string, theme: "light" | "dark"): string {
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  const groups = doc.querySelector(".architecture-groups");
  if (!groups) return svg;
  // 그룹 배경만 선 뒤로 옮기고 그룹 이름은 선 위에 유지함
  const backgrounds = doc.createElementNS("http://www.w3.org/2000/svg", "g");
  groups.parentNode!.insertBefore(backgrounds, groups.parentNode!.firstChild);
  const usedColors = new Set<number>();
  for (const rect of groups.querySelectorAll<SVGRectElement>("rect[id]")) {
    const groupId = rect.id.split("-group-").at(-1) ?? "";
    let index = Array.from(groupId).reduce((sum, char) => sum + char.charCodeAt(0), 0) % GROUP_COLORS.length;
    while (usedColors.size < GROUP_COLORS.length && usedColors.has(index)) index = (index + 1) % GROUP_COLORS.length;
    usedColors.add(index);
    const [fill, stroke, darkFill] = GROUP_COLORS[index];
    rect.style.fill = theme === "dark" ? darkFill : fill;
    rect.style.stroke = stroke;
    rect.style.strokeWidth = "1.5px";
    rect.setAttribute("rx", "12");
    backgrounds.appendChild(rect);
  }
  // 로고의 검은 부분과 currentColor가 다크 배경에 묻히지 않도록 고정 바탕 제공
  for (const icon of doc.querySelectorAll<SVGSVGElement>(".architecture-service svg, .architecture-groups svg")) {
    // fill을 생략한 로고 경로도 바깥 Mermaid의 밝은 글자 색을 상속하지 않음
    icon.style.fill = "#263238";
    icon.style.color = "#263238";
    const size = Number(icon.getAttribute("width"));
    const renderedSize = icon.closest(".architecture-service") ? ARCHITECTURE_ICON_SIZE : size;
    const inset = (size - renderedSize) / 2;
    icon.setAttribute("x", String(inset));
    icon.setAttribute("y", String(inset));
    icon.setAttribute("width", String(renderedSize));
    icon.setAttribute("height", String(renderedSize));
    const tile = doc.createElementNS("http://www.w3.org/2000/svg", "rect");
    tile.setAttribute("x", String(inset - 4));
    tile.setAttribute("y", String(inset - 4));
    tile.setAttribute("width", String(Number(icon.getAttribute("width")) + 8));
    tile.setAttribute("height", String(Number(icon.getAttribute("height")) + 8));
    tile.setAttribute("rx", "8");
    tile.setAttribute("fill", "#ffffff");
    tile.setAttribute("stroke", "#dce3ec");
    icon.parentNode!.insertBefore(tile, icon);
  }
  // 검증된 SVG의 실제 글자 크기를 측정하여 연결선이 이름을 관통하지 않게 배경을 채움
  const measure = document.createElement("div");
  measure.style.cssText = "position:fixed;left:-100000px;top:0;opacity:0;pointer-events:none";
  measure.setAttribute("aria-hidden", "true");
  const root = doc.documentElement;
  measure.append(root);
  document.body.append(measure);
  try {
    const regions = Array.from(backgrounds.querySelectorAll("rect")).map(rect => ({
      bounds: rect.getBoundingClientRect(), fill: rect.style.fill,
    })).sort((a, b) => a.bounds.width * a.bounds.height - b.bounds.width * b.bounds.height);
    for (const label of root.querySelectorAll<SVGTextElement>("text")) {
      const bounds = label.getBoundingClientRect();
      const x = bounds.x + bounds.width / 2;
      const y = bounds.y + bounds.height / 2;
      const fill = regions.find(({ bounds: box }) => x >= box.left && x <= box.right && y >= box.top && y <= box.bottom)?.fill
        ?? (theme === "dark" ? "#1c1f23" : "#ffffff");
      const box = label.getBBox();
      const plate = label.parentElement?.querySelector<SVGRectElement>(":scope > rect.background");
      if (!plate) continue;
      plate.setAttribute("x", String(box.x - 3));
      plate.setAttribute("y", String(box.y - 1));
      plate.setAttribute("width", String(box.width + 6));
      plate.setAttribute("height", String(box.height + 2));
      plate.style.fill = fill;
    }
    return new XMLSerializer().serializeToString(root);
  } finally {
    measure.remove();
  }
}
