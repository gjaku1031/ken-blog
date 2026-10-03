import type { Root } from "mdast";
import type { Element, ElementContent, Root as HtmlRoot, RootContent as HtmlNode, Text } from "hast";
import { toHast } from "mdast-util-to-hast";
import { toHtml } from "hast-util-to-html";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { unified } from "unified";
import katex from "katex";
import { parseAnnotationDocument } from "./markdown-details";
import { collectAttachmentIds, parseAttachmentId, parseImageAlt } from "./markdown-image";
import { collectWikiTitles, parseWikiMarkdown } from "./wiki-link-syntax";
import { readableMathFallback, isOversizeMath } from "./math-format";
import { highlightCode, resolveHighlightLanguage } from "./code-highlight";
import { mermaidSourceError } from "./mermaid-render";

/**
 * Pages 본문 생성에 사용하는 이미지·위키 주소 해석 계약
 */
export type RenderOptions = {
  /**
   * 첨부 ID의 공개 주소 해석기
   */
  attachmentUrl?: (id: number) => string | null;

  /**
   * 공개 이미지 헤더의 화면 기준 크기, 테마별 이미지 비율 예약
   */
  attachmentSize?: (id: number) => {
    /**
     * 화면 너비 픽셀
     */
    width: number;

    /**
     * 화면 높이 픽셀
     */
    height: number;
  } | null;

  /**
   * 위키 제목의 이동 주소 해석기
   */
  wikiUrl?: (title: string) => string | null
};

/**
 * 목차 항목
 */
export type TocItem = {
  /**
   * ID
   */
  id: string;

  /**
   * 표시 문구
   */
  label: string;

  /**
   * 분류 깊이
   */
  depth: number;

  /**
   * 행 번호
   */
  line: number
};

/**
 * 본문 HTML·목차·첨부·위키 렌더 결과
 */
export type RenderResult = {
  /**
   * 렌더된 HTML
   */
  html: string;

  /**
   * 목차 항목
   */
  headings: TocItem[];

  /**
   * 첨부 ID 목록
   */
  attachmentIds: number[];

  /**
   * 위키 대상 제목 목록
   */
  wikiTargets: string[]
};

/**
 * 위치를 가진 Markdown AST 노드
 */
type Positioned = {
  /**
   * 종류
   */
  type: string;

  /**
   * 노드 값
   */
  value?: string;

  /**
   * 분류 깊이
   */
  depth?: number;

  /**
   * 이미지 대체 텍스트
   */
  alt?: string;

  /**
   * 대상 URL
   */
  url?: string;

  /**
   * AST 렌더 보조 정보
   */
  data?: {
    /**
     * 변환할 HTML 태그명
     */
    hName?: string;

    /**
     * 변환할 HTML 속성
     */
    hProperties?: Record<string, unknown>;

    /**
     * 변환할 HTML 하위 노드
     */
    hChildren?: Array<{
      /**
       * 노드 값
       */
      value?: string
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
       * 행 번호
       */
      line: number
    }
  };

  /**
   * 하위 AST 노드
   */
  children?: Positioned[]
};

/**
 * 경로 이동·인코딩 변형 없는 내부 주소 검사
 */
const safeLocal = (url: string): boolean => /^\/(?!\/)[a-zA-Z0-9/_~.?=-]*$/.test(url) && !url.includes("..") && !url.includes("%") && !url.includes("\\");

/**
 * 일반 Markdown 상대 경로와 유니코드 앵커를 URL 파서로 검사함
 */
function safeLink(url: string): boolean {
  if (!url || /[\u0000-\u0020\u007f<>"'\\]/u.test(url) || url.startsWith("//")) return false;
  try {
    const parsed = new URL(url, "https://ken-blog.invalid/current/");
    if (parsed.protocol === "mailto:") return /^[^\s<>"'\\@]+@[^\s<>"'\\@]+$/u.test(url.slice(7));
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    return /^[a-z][a-z\d+.-]*:/i.test(url) || parsed.origin === "https://ken-blog.invalid";
  } catch { return false; }
}

/**
 * 내부 주소 또는 HTTPS 이미지 주소 검사
 */
const safeImage = (url: string): boolean => safeLocal(url) || /^https:\/\/[^\s<>"'\\]+$/i.test(url);

/**
 * HTML 요소 노드 생성
 */
const element = (tagName: string, properties: Element["properties"], children: ElementContent[] = []): Element => ({ type: "element", tagName, properties, children });

/**
 * HTML 텍스트 노드 생성
 */
const textNode = (value: string): Text => ({ type: "text", value });

/**
 * 제목의 독자 표시 텍스트를 기존 앵커 규칙으로 변환함
 */
function headingText(node: Positioned): string {
  if (node.type.startsWith("kenAnnotation") || node.type === "image") return "";
  if (node.type === "kenWikiLink") return node.data?.hChildren?.map((item) => item.value ?? "").join("") ?? "";
  if (node.type === "kenMathInline") return readableMathFallback(node.value ?? "");
  if (node.type === "text" || node.type === "inlineCode") return node.value ?? "";
  return (node.children ?? []).map(headingText).join("");
}

/**
 * Markdown AST의 블록을 순회해 안정적인 제목 앵커를 확정함
 */
function headingsOf(root: Root): TocItem[] {
  const counts = new Map<string, number>();
  const used = new Set<string>();
  const result: TocItem[] = [];

  /**
   * 현재 노드와 하위 노드 순회
   */
  const visit = (node: Positioned): void => {
    if (node.type === "heading" && (node.depth === 2 || node.depth === 3) && node.position) {
      const label = headingText(node).replace(/\s+/gu, " ").trim() || "제목";
      const normalized = label.normalize("NFKC").toLocaleLowerCase("und").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "");
      const base = Array.from(normalized).slice(0, 80).join("").replace(/-+$/g, "") || "section";
      let count = (counts.get(base) ?? 0) + 1;
      let id = `section-${base}${count > 1 ? `-${count}` : ""}`;
      while (used.has(id)) { count++; id = `section-${base}-${count}`; }
      counts.set(base, count); used.add(id);
      result.push({ id, label, depth: node.depth, line: node.position.start.line });
    }
    for (const child of node.children ?? []) visit(child);
  };
  for (const node of root.children as Positioned[]) visit(node);
  return result;
}

/**
 * 주석·링크·코드 속성을 HTML로 옮기기 전에 출처와 허용 주소를 검사함
 *
 * 1. 원문 행 기준 제목·목차 대응 준비
 * 2. 첨부 주소·대체 이미지·캡션을 허용 규칙에 맞게 조립
 * 3. 본문 주석의 참조·복귀 링크 조립
 * 4. 수식 크기를 제한하고 신뢰 기능을 끈 KaTeX로 변환
 * 5. Mermaid 검증 또는 코드 강조·복사 버튼 구성
 * 6. 본문 하위 노드에 변환 적용
 */
async function decorate(tree: HtmlRoot, options: RenderOptions, headings: TocItem[], wiki: Set<string>, annotations: Array<{
  /**
   * 문서 내 순번
   */
  index:number;

  /**
   * 표시 문구
   */
  label:string;

  /**
   * 본문 내용
   */
  content:string;

  /**
   * 참조 순번 목록
   */
  refs:number[]
}>): Promise<void> {
  // 원문 행 기준 제목·목차 대응 준비
  const headingByLine = new Map(headings.map((item) => [item.line, item]));

  /**
   * 현재 노드와 하위 노드 순회
   */
  const visit = async (node: HtmlNode, parent?: Element): Promise<void> => {
    if (node.type !== "element") return;
    const tag = node.tagName;
    if (tag === "h2" || tag === "h3") {
      const item = node.position?.start.line ? headingByLine.get(node.position.start.line) : undefined;
      if (item?.depth === Number(tag[1])) node.properties.id = item.id;
    }
    if (tag === "a") {
      const href = String(node.properties.href ?? "");
      if (!safeLink(href)) { node.tagName = "span"; node.properties = {}; }
      else if (/^https?:\/\//i.test(href)) { node.properties.target = "_blank"; node.properties.rel = ["noopener", "noreferrer"]; }
    }
    if (tag === "input") {
      if (String(node.properties.type ?? "") === "checkbox") node.properties = {
        type: "checkbox", checked: node.properties.checked === true, disabled: true,
      };
      else { node.tagName = "span"; node.properties = {}; node.children = []; }
    }
    // 첨부 주소·대체 이미지·캡션을 허용 규칙에 맞게 조립
    if (tag === "img") {
      const id = parseAttachmentId(String(node.properties.src ?? ""));
      const metadata = parseImageAlt(String(node.properties.alt ?? ""));
      const light = id && metadata ? options.attachmentUrl?.(id) : null;
      const dark = metadata?.darkAttachmentId ? options.attachmentUrl?.(metadata.darkAttachmentId) : null;
      if (!id || !metadata || !light || !safeImage(light) || (metadata.darkAttachmentId && (!dark || !safeImage(dark)))) {
        node.tagName = "span"; node.properties = { className: ["blocked-image"], role: "note" };
        node.children = [textNode("지원하지 않는 이미지")];
      } else {
        const size = options.attachmentSize?.(id);
        const darkSize = metadata.darkAttachmentId ? options.attachmentSize?.(metadata.darkAttachmentId) : null;
        node.properties = { src: light, alt: metadata.caption, loading: "lazy", decoding: "async",
          ...(size ? { width: size.width, height: size.height, dataLightWidth: size.width, dataLightHeight: size.height } : {}),
          ...(darkSize ? { dataDarkWidth: darkSize.width, dataDarkHeight: darkSize.height } : {}),
          dataDarkSrc: dark ?? "", dataWidth: String(metadata.width), dataAlign: metadata.align,
          className: ["ken-attachment"] };
        if (parent?.tagName === "p" && parent.children.length === 1) {
          parent.tagName = "figure"; parent.properties.className = ["attachment-figure"];
          parent.properties.dataWidth = String(metadata.width); parent.properties.dataAlign = metadata.align;
          parent.properties.style = `width:${metadata.width}%`;
          if (metadata.caption) parent.children.push(element("figcaption", {}, [textNode(metadata.caption)]));
        }
      }
    }
    if (tag === "span" && String(node.properties.className ?? "").includes("ken-wiki-link")) {
      const title = String(node.properties.dataWikiTitle ?? node.properties["data-wiki-title"] ?? "");
      const target = title ? options.wikiUrl?.(title) : null;
      if (target && safeLink(target)) { node.tagName = "a"; node.properties = { href: target, className: ["ken-wiki-link"], dataWikiTitle: title }; wiki.add(title); }
      else { node.properties = { className: ["ken-wiki-unresolved"], dataWikiTitle: title }; if (title) wiki.add(title); }
    }
    // 본문 주석의 참조·복귀 링크 조립
    if (tag === "sup" && String(node.properties.className ?? "").includes("ken-annotation-ref")) {
      const index = Number(node.properties.dataAnnotationIndex ?? node.properties["data-annotation-index"]);
      const occurrence = Number(node.properties.dataAnnotationOccurrence ?? node.properties["data-annotation-occurrence"]);
      if (Number.isSafeInteger(index) && annotations[index] && Number.isSafeInteger(occurrence)) {
        node.properties = { className: ["ken-annotation-ref"], dataAnnotationIndex: String(index),
          id: `annotation-ref-${occurrence}` };
        node.children = [element("a", { href: `#annotation-${index}`, ariaLabel: `주석 ${annotations[index].label}` }, node.children)];
      } else node.properties = {};
    }
    // 수식 크기를 제한하고 신뢰 기능을 끈 KaTeX로 변환
    if ((tag === "span" || tag === "div") && String(node.properties.className ?? "").includes("ken-math-")) {
      const source = node.children.map((child) => child.type === "text" ? child.value : "").join("");
      const display = tag === "div";
      if (!isOversizeMath(source)) {
        try {
          // KaTeX의 trust=false는 TeX의 URL·HTML 기능을 사용하지 않음
          const html = katex.renderToString(source, { displayMode: display, throwOnError: false, trust: false, strict: "ignore", output: "htmlAndMathml" });
          node.properties = { className: [display ? "ken-math-block" : "ken-math-inline"], dataKatexHtml: html };
          node.children = [];
        } catch { node.children = [textNode(source)]; }
      }
    }
    // Mermaid 검증 또는 코드 강조·복사 버튼 구성
    if (tag === "pre") {
      const code = node.children[0];
      if (code?.type === "element" && code.tagName === "code") {
        const source = code.children.map((child) => child.type === "text" ? child.value : "").join("");
        const language = (Array.isArray(code.properties.className) ? code.properties.className : []).find((part) => typeof part === "string" && part.startsWith("language-"))?.slice(9);
        const mermaidError = language === "mermaid" ? mermaidSourceError(source) : null;
        if (language === "mermaid" && mermaidError) {
          node.tagName = "div";
          node.properties = { className: ["ken-mermaid-error"] };
          node.children = [element("p", { role: "alert" }, [textNode(mermaidError)]), element("pre", {}, [textNode(source)])];
        } else if (language === "mermaid") {
          node.tagName = "div"; node.properties = { className: ["ken-mermaid"], dataMermaidSource: source };
          node.children = [element("button", { type: "button", className: ["mermaid-source-toggle"] }, [textNode("원문 보기")]), element("pre", { className: ["mermaid-source"] }, [textNode(source)]), element("div", { className: ["mermaid-diagram"] })];
        } else {
          node.properties.className = ["ken-code"];
          if (language) node.properties.dataLanguage = language;
          const known = resolveHighlightLanguage(language);
          if (known) {
            try {
              const result = await highlightCode(source, known);
              const spans: ElementContent[] = [];
              result.tokens.forEach((line, index) => {
                line.forEach((token) => spans.push(element("span", { style: /^#[0-9a-f]{6}$/i.test(token.color ?? "") ? `color:${token.color}` : "" }, [textNode(token.content)])));
                if (index < result.breaks.length) spans.push(textNode(result.breaks[index]));
              });
              code.children = spans;
            } catch { /* 원문 코드 유지 */ }
          }
          node.children.push(element("button", { type: "button", className: ["code-copy"] }, [textNode("복사")]));
        }
      }
    }
    for (const child of [...node.children]) await visit(child, node);
  };
  // 본문 하위 노드에 변환 적용
  for (const child of tree.children) await visit(child);
}

/**
 * 원문 크기를 검사하고 공용 AST·첨부·위키·목차 정보를 한 번 수집
 */
export function prepareMarkdown(source: string) {
  if (typeof source !== "string") throw new TypeError("Markdown 원문이 필요합니다.");
  if (new TextEncoder().encode(source).byteLength > 1024 * 1024) throw new RangeError("Markdown 원문이 1 MiB를 넘습니다.");
  // 문서 경계에서 줄바꿈을 통일하여 모든 파서의 위치 기준을 일치시킴
  const parsed = parseAnnotationDocument(source.replace(/\r\n?/g, "\n"));
  return { parsed, headings: headingsOf(parsed.root), attachmentIds: collectAttachmentIds(parsed.root),
    wikiTargets: collectWikiTitles(parsed.root, parsed.items).titles };
}

/**
 * 같은 AST를 재사용하여 공개 첨부·위키 주소를 반영한 본문 생성
 */
export async function renderPreparedMarkdown(prepared: ReturnType<typeof prepareMarkdown>, options: RenderOptions = {}): Promise<RenderResult> {
  const { parsed, headings, attachmentIds } = prepared;
  const wikiTargets = new Set(prepared.wikiTargets);
  const tree = toHast(parsed.root, { allowDangerousHtml: false }) as HtmlRoot;
  await decorate(tree, options, headings, wikiTargets, parsed.items);
  const schema = { ...defaultSchema, clobberPrefix: "", tagNames: [...(defaultSchema.tagNames ?? []), "figure", "figcaption", "button", "details", "summary"], attributes: { ...defaultSchema.attributes,
    "*": ["className", "id", "title", "dataWidth", "dataAlign", "dataDarkSrc", "dataLanguage", "dataMermaidSource", "dataAnnotationIndex", "dataWikiTitle", "dataKatexHtml", "role", "ariaLabel", "tabIndex"],
    a: ["href", "target", "rel", "className", "ariaLabel", "dataAnnotationReturn"], img: ["src", "alt", "loading", "decoding", "className", "dataDarkSrc", "width", "height", "dataLightWidth", "dataLightHeight", "dataDarkWidth", "dataDarkHeight"], span: ["className", "style", "id", "role", "tabIndex", "ariaLabel", "dataAnnotationIndex", "dataKatexHtml"],
    figure: ["className", "style", "dataWidth", "dataAlign"], input: ["type", "checked", "disabled"], button: ["type", "className"], th: ["align"], td: ["align"] },
    protocols: { ...defaultSchema.protocols, href: ["http", "https", "mailto"], src: ["http", "https"] } };

  /**
   * 출처 검증·정화 후 HTML 직렬화
   */
  const serialize = async (input: HtmlRoot): Promise<string> => {
    const sanitized = await unified().use(rehypeSanitize, schema).run(input) as HtmlRoot;
  // dataKatexHtml은 신뢰된 KaTeX 출력만 담고 사용자 HTML 속성에서 유래하지 않음
  const inserts = new Map<string, string>();
  let serial = 0;

  /**
   * 최종 HTML 노드의 렌더 속성 정리
   */
  const finalize = (node: HtmlNode) => {
    if (node.type !== "element") return;
    const math = node.properties.dataKatexHtml;
    if (typeof math === "string") {
      const marker = `KENBLOG_KATEX_${serial++}_${Math.random().toString(36).slice(2)}`;
      inserts.set(marker, math); node.children = [textNode(marker)]; delete node.properties.dataKatexHtml;
    }
    for (const child of node.children) finalize(child);
  };
    sanitized.children.forEach(finalize);
    let html = toHtml(sanitized);
    for (const [marker, value] of inserts) html = html.replace(marker, value);
    return html;
  };
  let html = await serialize(tree);
  if (parsed.items.length) {
    const notes = await Promise.all(parsed.items.map(async (item) => {
      const noteTree = toHast(parseWikiMarkdown(item.content), { allowDangerousHtml: false }) as HtmlRoot;
      const paragraph = noteTree.children[0];
      // 유효 주석은 한 문단임 불명확한 구조는 원문 텍스트로만 남김
      let content: string;
      if (noteTree.children.length !== 1 || paragraph.type !== "element" || paragraph.tagName !== "p") {
        content = `<span class="ken-annotation-content">${escapeHtml(item.content)}</span>`;
      } else {
        paragraph.tagName = "span"; paragraph.properties = { className: ["ken-annotation-content"] };
        await decorate(noteTree, options, [], wikiTargets, []);
        content = await serialize(noteTree);
      }
      const first = item.refs[0];
      return `<li id="annotation-${item.index}"><a href="#annotation-ref-${first}" data-annotation-return="1" aria-label="주석 ${escapeHtml(item.label)} 본문으로 돌아가기">${escapeHtml(item.label)}</a> ${content}</li>`;
    }));
    html += `<section class="ken-annotations"><h2>주석</h2><ol role="list">${notes.join("")}</ol></section>`;
  }
  return { html, headings, attachmentIds, wikiTargets: [...wikiTargets] };
}

/**
 * 단일 문서의 파싱과 최종 HTML 생성을 한 번에 수행
 */
export async function renderMarkdown(source: string, options: RenderOptions = {}): Promise<RenderResult> {
  return renderPreparedMarkdown(prepareMarkdown(source), options);
}

/**
 * HTML 텍스트 위치에서만 쓰는 문자 이스케이프
 */
function escapeHtml(value: string): string { return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!); }
