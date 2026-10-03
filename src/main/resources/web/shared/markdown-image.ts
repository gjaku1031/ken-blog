import type { Root } from "mdast";
import { parseAnnotationDocument } from "./markdown-details";

/**
 * 이미지 설명에서 읽은 대체 텍스트·너비·정렬·선택적 다크 테마 이미지
 */
export type ImageAlt = {
  /**
   * 다크 테마 첨부 ID
   */
  darkAttachmentId?: number;

  /**
   * 이미지 설명
   */
  caption: string;

  /**
   * 이미지 너비 비율
   */
  width: number;

  /**
   * 이미지 정렬
   */
  align: "left" | "center" | "right";
};

/**
 * 이미지 참조·위치 정보를 가진 AST 노드
 */
type ImageNode = {
  /**
   * 종류
   */
  type: string;

  /**
   * 대상 URL
   */
  url?: string;

  /**
   * 이미지 대체 텍스트
   */
  alt?: string;

  /**
   * 참조 정의 식별자
   */
  identifier?: string;

  /**
   * 하위 AST 노드
   */
  children?: ImageNode[];
};

/**
 * 내부 첨부 주소 패턴
 */
const attachmentUrl = /^attachment:([1-9]\d*)$/;

/**
 * 이미지 너비·정렬 메타데이터 패턴
 */
const metadata = /^([\s\S]*)\|w=(20|[2-9]\d|100)\|a=(left|center|right)$/;

/**
 * 다크 이미지·너비·정렬 메타데이터 패턴
 */
const pairedMetadata = /^([\s\S]*)\|dark=([1-9]\d*)\|w=(20|[2-9]\d|100)\|a=(left|center|right)$/;

/**
 * 정확한 내부 주소의 양수 안전 정수 ID만 허용하며 외부 URL·인코딩 변형은 거부함
 */
export function parseAttachmentId(url: string): number | null {
  const match = attachmentUrl.exec(url);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/**
 * remark가 해석한 alt의 오른쪽에 있는 정확한 메타 suffix만 읽음
 *
 * 선택적 dark ID는 양수 안전 정수만 허용하며 중복·잘못된 dark 메타는 거부함
 *
 * 구분자 없는 기존 설명은 기본 100%/가운데, 모호한 pipe·잘못된 메타는 `null`로 둠
 *
 * 1. 메타데이터 없는 설명은 기본 너비·정렬 적용
 * 2. 다크 이미지 ID를 먼저 검사하고 중복 메타데이터 거부
 * 3. 일반 너비·정렬 접미사 검사
 */
export function parseImageAlt(alt: string): ImageAlt | null {
  // 메타데이터 없는 설명은 기본 너비·정렬 적용
  if (!alt.includes("|")) return { caption: alt, width: 100, align: "center" };
  // 다크 이미지 ID를 먼저 검사하고 중복 메타데이터 거부
  if (alt.includes("|dark=")) {
    const paired = pairedMetadata.exec(alt);
    if (!paired || paired[1].includes("|dark=")) return null;
    const darkAttachmentId = Number(paired[2]);
    if (!Number.isSafeInteger(darkAttachmentId) || darkAttachmentId <= 0) return null;
    return { caption: paired[1], darkAttachmentId, width: Number(paired[3]), align: paired[4] as ImageAlt["align"] };
  }
  // 일반 너비·정렬 접미사 검사
  const match = metadata.exec(alt);
  if (!match) return null;
  return { caption: match[1], width: Number(match[2]), align: match[3] as ImageAlt["align"] };
}

/**
 * CommonMark 참조 정의의 대소문자와 연속 공백을 같은 키로 맞춤
 */
function referenceKey(identifier: string): string { return identifier.trim().replace(/\s+/g, " ").toLowerCase(); }

/**
 * 코드·Mermaid fence·수식·주석의 가짜 이미지 문법을 건너뛰며 안전 접기 안의 정의를 찾음
 */
function walk(node: ImageNode, visit: (node: ImageNode) => void): void {
  visit(node);
  if (node.type === "code" || node.type === "mermaid" || node.type === "inlineCode" ||
    node.type === "html" || node.type.startsWith("kenMath") || node.type.startsWith("kenAnnotation")) return;
  for (const child of node.children ?? []) walk(child, visit);
}

/**
 * 실제로 표시 가능한 내부 Markdown 이미지 노드만 모아 Pages 빌드의 이미지 다운로드에 사용함
 *
 * 읽기와 같은 안전 접기·주석 변환 후 imageReference 정의를 풀며, 코드·Mermaid·수식·주석·일반 링크 목적지·차단된 HTML은 세지 않음
 *
 * 링크 안에 들어 있는 실제 이미지 노드는 읽기 화면에도 표시되므로 포함함
 *
 * 1. 읽기 화면과 동일한 문법으로 문서 파싱
 * 2. 참조형 이미지 주소의 최초 정의 수집
 * 3. 실제 이미지와 유효 다크 대체 이미지 ID 수집
 * 4. 중복 제거 후 ID 오름차순 반환
 *
 * @return 중복을 제거한 첨부 ID 오름차순 목록
 */
export function collectAttachmentIds(body: string | Root): number[] {
  // 읽기 화면과 동일한 문법으로 문서 파싱
  const root = typeof body === "string" ? parseAnnotationDocument(body).root : body;
  const tree = root as unknown as ImageNode;
  // 참조형 이미지 주소의 최초 정의 수집
  const definitions = new Map<string, string>();
  walk(tree, (node) => {
    if (node.type === "definition" && node.identifier && node.url) {
      const key = referenceKey(node.identifier);
      if (!definitions.has(key)) definitions.set(key, node.url);
    }
  });
  // 실제 이미지와 유효 다크 대체 이미지 ID 수집
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
  // 중복 제거 후 ID 오름차순 반환
  return [...ids].sort((left, right) => left - right);
}
