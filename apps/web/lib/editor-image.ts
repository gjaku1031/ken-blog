import type { Root } from "mdast";
import { parseAnnotationDocument } from "./markdown-details";

/** 내부 첨부 이미지의 대체 설명·상대 너비·정렬과 선택적 다크 테마 첨부를 담는 편집 값. */
export type ImageData = {
  attachmentId: number; darkAttachmentId?: number; caption: string; width: number; align: "left" | "center" | "right";
};

/** 이미지 설명에서 읽어 들인 메타데이터; 설명은 대체 텍스트와 캡션에 함께 사용한다. */
export type ImageAlt = Pick<ImageData, "caption" | "width" | "align" | "darkAttachmentId">;

type ImageNode = {
  type: string; url?: string; alt?: string; identifier?: string; children?: ImageNode[];
};

const attachmentUrl = /^attachment:([1-9]\d*)$/;
const metadata = /^([\s\S]*)\|w=(20|[2-9]\d|100)\|a=(left|center|right)$/;
const pairedMetadata = /^([\s\S]*)\|dark=([1-9]\d*)\|w=(20|[2-9]\d|100)\|a=(left|center|right)$/;
const markdownPunctuation = /[!"#$%'()*+,\-./:;=?@\[\]^_`{|}~]/;

/** 정확한 내부 주소의 양수 안전 정수 ID만 허용하며 외부 URL·인코딩 변형은 거부한다. */
export function parseAttachmentId(url: string): number | null {
  const match = attachmentUrl.exec(url);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/**
 * remark가 해석한 alt의 오른쪽에 있는 정확한 메타 suffix만 읽는다.
 * 선택적 dark ID는 양수 안전 정수만 허용하며 중복·잘못된 dark 메타는 거부한다.
 * 구분자 없는 기존 설명은 기본 100%/가운데, 모호한 pipe·잘못된 메타는 `null`로 둔다.
 */
export function parseImageAlt(alt: string): ImageAlt | null {
  if (!alt.includes("|")) return { caption: alt, width: 100, align: "center" };
  if (alt.includes("|dark=")) {
    const paired = pairedMetadata.exec(alt);
    if (!paired || paired[1].includes("|dark=")) return null;
    const darkAttachmentId = Number(paired[2]);
    if (!Number.isSafeInteger(darkAttachmentId) || darkAttachmentId <= 0) return null;
    return { caption: paired[1], darkAttachmentId, width: Number(paired[3]), align: paired[4] as ImageData["align"] };
  }
  const match = metadata.exec(alt);
  if (!match) return null;
  return { caption: match[1], width: Number(match[2]), align: match[3] as ImageData["align"] };
}

/**
 * 새 이미지 블록은 언제나 명시적 메타 suffix로 출력한다.
 * 설명의 Markdown 구분자와 HTML 문자 참조를 이스케이프하여 다시 읽을 때 같은 설명을 얻는다.
 */
export function serializeImageBlock(image: ImageData): string {
  const caption = Array.from(image.caption.replace(/\r\n?|\n/g, " "), (character) => {
    if (character === "&") return "&amp;";
    if (character === "<") return "&lt;";
    if (character === ">") return "&gt;";
    if (character === "\\" || markdownPunctuation.test(character)) return `\\${character}`;
    return character;
  }).join("");
  const dark = image.darkAttachmentId === undefined ? "" : `|dark=${image.darkAttachmentId}`;
  return `![${caption}${dark}|w=${image.width}|a=${image.align}](attachment:${image.attachmentId})`;
}

/** CommonMark 참조 정의의 대소문자와 연속 공백을 같은 키로 맞춘다. */
function referenceKey(identifier: string): string { return identifier.trim().replace(/\s+/g, " ").toLowerCase(); }

/** 코드·Mermaid fence·수식·주석의 가짜 이미지 문법을 건너뛰며 안전 접기 안의 정의를 찾는다. */
function walk(node: ImageNode, visit: (node: ImageNode) => void): void {
  visit(node);
  if (node.type === "code" || node.type === "mermaid" || node.type === "inlineCode" ||
    node.type === "html" || node.type.startsWith("kenMath") || node.type.startsWith("kenAnnotation")) return;
  for (const child of node.children ?? []) walk(child, visit);
}

/**
 * 실제로 표시 가능한 내부 Markdown 이미지 노드만 모아 서버의 전체 연결 선언에 사용한다.
 * 읽기와 같은 안전 접기·주석 변환 후 imageReference 정의를 풀며, 코드·Mermaid·수식·주석·일반 링크 목적지·차단된 HTML은 세지 않는다.
 * 링크 안에 들어 있는 실제 이미지 노드는 읽기 화면에도 표시되므로 포함한다.
 *
 * @return 중복을 제거한 첨부 ID 오름차순 목록; 100개 상한은 저장 UI가 검사한다.
 */
export function collectAttachmentIds(body: string): number[] {
  const root = parseAnnotationDocument(body).root as Root;
  const tree = root as unknown as ImageNode;
  const definitions = new Map<string, string>();
  walk(tree, (node) => {
    if (node.type === "definition" && node.identifier && node.url) {
      const key = referenceKey(node.identifier);
      if (!definitions.has(key)) definitions.set(key, node.url);
    }
  });
  const ids = new Set<number>();
  walk(tree, (node) => {
    if (node.type !== "image" && node.type !== "imageReference") return;
    const url = node.type === "imageReference" ? definitions.get(referenceKey(node.identifier ?? "")) : node.url;
    const id = url ? parseAttachmentId(url) : null;
    const alt = parseImageAlt(node.alt ?? "");
    if (id !== null && alt !== null) {
      ids.add(id);
      if (alt.darkAttachmentId !== undefined) ids.add(alt.darkAttachmentId);
    }
  });
  return [...ids].sort((left, right) => left - right);
}
