"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { remarkSafeDetails } from "../lib/markdown-details";
import { remarkMathSyntax } from "../lib/math-syntax";
import { remarkAnnotationSyntax, remarkResolveAnnotations } from "../lib/annotation-syntax";
import { parseAttachmentId, parseImageAlt } from "../lib/editor-image";
import { AttachmentImage, type AttachmentSource } from "./attachment-image";
import { MarkdownDetails, MarkdownSummary } from "./markdown-details";
import { CodeBlock } from "./code-block";
import { MathExpression } from "./math-expression";
import { MermaidBlock } from "./mermaid-block";
import { AnnotationReader, AnnotationReference } from "./annotation-reader";
import { useAuth } from "./auth-provider";
import { remarkEditorAnnotations, type EditorAnnotationReference } from "../lib/editor-annotation";
import { remarkWikiSyntax } from "../lib/wiki-link-syntax";
import { buildReadingDocument, type ReadingDocument } from "../lib/reading-document";
import type { TocItem } from "../lib/table-of-contents";
import { WikiLink, WikiLinkReader } from "./wiki-link-reader";
import { ApiFailure, apiFailureMessage } from "../lib/api";

const HeadingContext = createContext<ReadonlyMap<number, TocItem>>(new Map());
type HeadingProps = { node?: { position?: { start: { offset?: number } } }; children?: ReactNode };
type TodoLine = { line: number; checked: boolean };
type TodoAction = { enabled: boolean; busy: boolean; toggle: (line: number, done: boolean) => Promise<void> };
const TodoLineContext = createContext<TodoLine | null>(null);
const TodoActionContext = createContext<TodoAction | null>(null);
const TODO_MARKER = /^\s*(?:[-*+]|[0-9]+[.)])\s+\[([ xX])\]/;

/** {@link SafeMarkdown}의 파서가 찾은 목록 줄을 서버 원문 줄과 대조해 편집 가능한 할 일을 식별한다. */
function sourceTodoLine(lines: readonly string[], line: number | undefined): TodoLine | null {
  if (line === undefined || line < 1 || line > lines.length) return null;
  const marker = TODO_MARKER.exec(lines[line - 1]);
  return marker ? { line, checked: marker[1] !== " " } : null;
}

/** {@link SafeMarkdown}이 보내는 원문 전체의 UTF-8 SHA-256을 서버와 같은 소문자 16진수로 계산한다. */
async function bodySha256(body: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
  return Array.from(new Uint8Array(bytes), (value) => value.toString(16).padStart(2, "0")).join("");
}

/** {@link SafeMarkdown}의 수정 응답에서 새 원문과 충돌 검사 해시를 확인한다. */
function todoResponse(value: unknown): { body: string; bodySha256: string } {
  if (!value || typeof value !== "object" || !("body" in value) || !("bodySha256" in value) ||
    typeof value.body !== "string" || typeof value.bodySha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.bodySha256))
    throw new ApiFailure("response");
  return { body: value.body, bodySha256: value.bodySha256 };
}

/** {@link TodoLineContext}의 검증된 줄에만 관리자 수정 동작을 제공하고 실패하면 현재 표시를 유지한다. */
function TodoCheckbox({ type, checked }: { type?: string; checked?: boolean }) {
  const line = useContext(TodoLineContext);
  const action = useContext(TodoActionContext);
  const [error, setError] = useState("");
  const isChecked = checked === true;
  const editable = type === "checkbox" && action?.enabled === true && line !== null && line.checked === isChecked;
  return <><input type={type} checked={isChecked} disabled={!editable || action?.busy === true} readOnly={!editable}
    aria-label={isChecked ? "완료된 항목" : "미완료 항목"} onChange={() => {
      if (!editable || !action || !line) return;
      setError("");
      void action.toggle(line.line, !isChecked).catch((failure) => {
        if (failure instanceof DOMException && failure.name === "AbortError") return;
        setError(failure instanceof ApiFailure && failure.status === 409 ?
          "글이 변경되었습니다. 새로고침한 뒤 다시 시도해 주세요." : apiFailureMessage(failure));
      });
    }} />{error && <span className="inline-error" role="alert"> {error}</span>}</>;
}

/** 제목 컴포넌트의 정체성을 유지해 비동기 링크 결과가 도착해도 목차 초점이 남는다. */
function ReadingH2({ node, children }: HeadingProps) {
  const item = useContext(HeadingContext).get(node?.position?.start.offset ?? -1);
  return <h2 id={item?.depth === 2 ? item.id : undefined} tabIndex={item?.depth === 2 ? -1 : undefined}>{children}</h2>;
}

/** 3단 제목에도 동일한 원문 위치 앵커를 적용한다. */
function ReadingH3({ node, children }: HeadingProps) {
  const item = useContext(HeadingContext).get(node?.position?.start.offset ?? -1);
  return <h3 id={item?.depth === 3 ? item.id : undefined} tabIndex={item?.depth === 3 ? -1 : undefined}>{children}</h3>;
}

/** 원문 위치의 열림·닫힘 fence와 정확한 소문자 mermaid 정보 문자열을 검사한다. */
function exactMermaidFence(body: string, start?: number, end?: number): boolean {
  if (start === undefined || end === undefined) return false;
  const lines = body.slice(start, end).split(/\r\n|\r|\n/);
  const opening = /^ {0,3}(`{3,}|~{3,})mermaid$/.exec(lines[0] ?? "");
  if (!opening) return false;
  let last = lines.length - 1;
  while (last > 0 && !lines[last].trim()) last--;
  const closing = /^ {0,3}(`+|~+)[ \t]*$/.exec(lines[last] ?? "");
  return !!closing && closing[1][0] === opening[1][0] && closing[1].length >= opening[1].length;
}

/** 실행 가능한 스킴과 프로토콜 상대 주소를 막고 안전한 글 링크만 남긴다. */
function safeUrl(value: string, key: string): string {
  const url = value.trim();
  if (key === "src") return parseAttachmentId(url) !== null ? url : "";
  if (/[\u0000-\u001f\u007f\\]/.test(url)) return "";
  if (url.startsWith("#") || (url.startsWith("/") && !url.startsWith("//"))) return url;
  if (/^(https?:|mailto:)/i.test(url)) return url;
  if (/^[^:/?#][^:]*$/.test(url)) return url;
  return "";
}

/** 문서 전체 주석 목록과 참조를 같은 원문·경로·계정 수명에 묶는다. */
function AnnotationDocument({ body, source, model, children }: { body: string; source?: AttachmentSource;
  model: ReadingDocument; children: ReactNode }) {
  const auth = useAuth();
  const pathname = usePathname();
  const sourceId = source?.kind === "post" ? `post:${source.postId}` : source?.kind ?? "none";
  const identity = `${pathname}\u0000${auth.epoch}\u0000${auth.status}\u0000${auth.user?.username ?? ""}\u0000${sourceId}\u0000${body}`;
  return <WikiLinkReader key={identity} titles={model.wiki.titles}>
    <AnnotationReader items={model.items} wikiLimits={model.wiki.annotationLimits}>{children}</AnnotationReader>
  </WikiLinkReader>;
}

/** {@link TodoCheckbox}의 관리자 수정 결과를 반영하고 raw HTML·자동 이미지를 차단하며 문서 모드에서 주석을 해석한다. */
export function SafeMarkdown({ body, source, annotationMode = "document", annotationRefs = [], reading }: {
  body: string; source?: AttachmentSource; annotationMode?: "document" | "literal" | "editor";
  annotationRefs?: readonly EditorAnnotationReference[]; reading?: ReadingDocument;
}) {
  const auth = useAuth();
  const sourceId = source?.kind === "post" ? source.postId : null;
  const identity = JSON.stringify([source?.kind ?? null, sourceId, annotationMode, body]);
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const requestRef = useRef<AbortController | null>(null);
  const pendingRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState({ identity, body });
  const currentBody = version.identity === identity ? version.body : body;
  useEffect(() => {
    setVersion({ identity, body });
    setBusy(false);
    return () => { requestRef.current?.abort(); requestRef.current = null; pendingRef.current = false; };
  }, [identity, body]);
  const lines = useMemo(() => currentBody.split("\n"), [currentBody]);
  const model = useMemo(() => annotationMode === "document" ?
    currentBody === body ? reading ?? buildReadingDocument(body) : buildReadingDocument(currentBody) : null,
  [annotationMode, reading, body, currentBody]);
  const headingIds = useMemo(() => new Map(model?.toc.map((item) => [item.offset, item])), [model]);
  /** {@link TodoCheckbox} 요청의 본문 해시를 계산하고 서버가 확정한 원문만 화면에 반영한다. */
  const toggleTodo = useCallback(async (line: number, done: boolean): Promise<void> => {
    if (sourceId === null || annotationMode !== "document" || auth.status !== "authenticated" ||
      auth.user?.role !== "ADMIN" || pendingRef.current) return;
    const controller = new AbortController();
    requestRef.current = controller;
    pendingRef.current = true;
    setBusy(true);
    try {
      const expectedBodySha256 = await bodySha256(currentBody);
      if (controller.signal.aborted || identityRef.current !== identity) return;
      const updated = todoResponse(await auth.adminWrite("PATCH", `/api/v1/admin/posts/${sourceId}/todo`,
        { line, done, expectedBodySha256 }, controller.signal));
      if (controller.signal.aborted || identityRef.current !== identity) return;
      if (await bodySha256(updated.body) !== updated.bodySha256) throw new ApiFailure("response");
      if (controller.signal.aborted || identityRef.current !== identity) return;
      setVersion({ identity, body: updated.body });
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        pendingRef.current = false;
        setBusy(false);
      }
    }
  }, [annotationMode, auth, currentBody, identity, sourceId]);
  const todoAction: TodoAction = { enabled: annotationMode === "document" && sourceId !== null &&
    auth.status === "authenticated" && auth.user?.role === "ADMIN", busy, toggle: toggleTodo };
  const markdown = <div className="markdown-body"><HeadingContext.Provider value={headingIds}><TodoActionContext.Provider value={todoAction}><Markdown
    remarkPlugins={annotationMode === "document" ?
      [remarkGfm, remarkMathSyntax, remarkWikiSyntax, remarkSafeDetails, remarkResolveAnnotations] :
      annotationMode === "editor" ?
      [remarkGfm, remarkMathSyntax, remarkAnnotationSyntax, remarkSafeDetails, [remarkEditorAnnotations, annotationRefs]] :
      [remarkGfm, remarkMathSyntax, remarkSafeDetails]}
    skipHtml urlTransform={safeUrl}
    components={{
      /** 최상위 제목만 원문 위치에 대응하는 안정적 목차 앵커를 받는다. */
      h2: ReadingH2,
      h3: ReadingH3,
      /** 모델이 검증한 숫자 인덱스만 현재 문서의 주석 링크로 바꾼다. */
      sup({ node, children, ...props }) {
        const classes = node?.properties.className;
        const index = node?.properties["data-annotation-index"];
        const occurrence = node?.properties["data-annotation-occurrence"];
        if (annotationMode !== "literal" && Array.isArray(classes) && classes.includes("ken-annotation-ref") &&
          typeof index === "string" && /^(0|[1-9]\d*)$/.test(index) &&
          typeof occurrence === "string" && /^(0|[1-9]\d*)$/.test(occurrence))
          return <AnnotationReference index={Number(index)} occurrence={Number(occurrence)} />;
        return <sup {...props}>{children}</sup>;
      },
      /** 원문 HTML 속성 없이 접기 구조만 표시한다. */
      details({ children }) { return annotationMode === "editor" ? <div className="markdown-details-editor">{children}</div> :
        <MarkdownDetails>{children}</MarkdownDetails>; },
      /** 기본 키보드 조작과 접근성 의미를 가진 제목을 사용한다. */
      summary({ children }) { return annotationMode === "editor" ? <strong>{children}</strong> : <MarkdownSummary>{children}</MarkdownSummary>; },
      /** 파서가 표시한 단일 텍스트 수식만 KaTeX에 전달한다. */
      span({ node, children }) {
        const classes = node?.properties.className;
        const math = Array.isArray(classes) && classes.includes("ken-math-inline") &&
          node?.children.length === 1 && node.children[0].type === "text" ? node.children[0].value : null;
        if (math !== null) return annotationMode === "editor" ? <span inert><MathExpression source={math} display={false} /></span> :
          <MathExpression source={math} display={false} />;
        const title = node?.properties["data-wiki-title"];
        const raw = node?.properties["data-wiki-raw"];
        if (annotationMode === "document" && Array.isArray(classes) && classes.includes("ken-wiki-link") &&
          typeof title === "string" && typeof raw === "string" &&
          node?.children.length === 1 && node.children[0].type === "text")
          return <WikiLink title={title} label={node.children[0].value} raw={raw} />;
        if (Array.isArray(classes) && classes.includes("ken-wiki-link") && typeof raw === "string")
          return <span>{raw}</span>;
        return <span>{children}</span>;
      },
      /** 독립 수식은 문단 밖의 블록으로 만들고 원문만 MathML 렌더러에 전달한다. */
      div({ node, children }) {
        const classes = node?.properties.className;
        const math = Array.isArray(classes) && classes.includes("ken-math-block") &&
          node?.children.length === 1 && node.children[0].type === "text" ? node.children[0].value : null;
        return math !== null ? annotationMode === "editor" ? <div inert><MathExpression source={math} display /></div> :
          <MathExpression source={math} display /> : <div>{children}</div>;
      },
      /** 단독 이미지의 폭과 정렬 래퍼를 문단 자리에 두어 유효한 HTML을 만든다. */
      p({ node, children }) {
        const standalone = node?.children.length === 1 && node.children[0].type === "element" && node.children[0].tagName === "img";
        return standalone ? <div className="attachment-paragraph">{children}</div> : <p>{children}</p>;
      },
      /** {@link TodoCheckbox}에 파서가 지정한 원문 목록 시작 줄을 전달한다. */
      li({ node, children, ...props }) {
        const todo = sourceTodoLine(lines, node?.position?.start.line);
        return <li {...props}><TodoLineContext.Provider value={todo}>{children}</TodoLineContext.Provider></li>;
      },
      /** 허용된 링크만 열고 외부 주소는 새 탭 분리 속성을 적용한다. */
      a({ href, children }) {
        if (annotationMode === "editor") return <span>{children}</span>;
        if (!href) return <span>{children}</span>;
        const external = /^https?:/i.test(href);
        return <a href={href} target={external ? "_blank" : undefined} rel={external ? "noopener noreferrer" : undefined}>{children}</a>;
      },
      /** 엄격한 첨부 이미지 AST만 허용된 content API로 읽고 나머지는 대체 안내로 표시한다. */
      img({ alt, src }) {
        const id = parseAttachmentId(typeof src === "string" ? src : "");
        const metadata = parseImageAlt(alt ?? "");
        if (id === null || !metadata || !source) return <span className="blocked-image" role="note">지원하지 않는 이미지{alt ? `: ${alt}` : "."}</span>;
        const image = <AttachmentImage image={{ attachmentId: id, ...metadata }} source={source} />;
        return annotationMode === "editor" ? <span inert>{image}</span> : image;
      },
      /** GFM 입력은 {@link TodoCheckbox}에서 관리자 권한과 원문 줄을 확인한다. */
      input({ type, checked }) { return <TodoCheckbox type={type} checked={checked} />; },
      /** HAST 코드의 실제 텍스트와 언어만 읽어 강조하고 변환 불가 구조는 원문을 남긴다. */
      pre({ node, ...props }) {
        const codeNode = node?.children.find((child) => child.type === "element" && child.tagName === "code");
        if (!codeNode || codeNode.type !== "element" || !codeNode.children.every((child) => child.type === "text"))
          return <pre {...props} tabIndex={0} role="group" aria-label="코드 블록, 가로로 스크롤 가능" />;
        const code = codeNode.children.map((child) => child.type === "text" ? child.value : "").join("");
        const className = codeNode.properties.className;
        const classes = Array.isArray(className) ? className.filter((item): item is string => typeof item === "string") : [];
        const language = classes.find((item) => item.startsWith("language-"))?.slice(9);
        if (language === "mermaid" && exactMermaidFence(currentBody, node?.position?.start?.offset, node?.position?.end?.offset))
          return annotationMode === "editor" ? <div inert><MermaidBlock source={code} /></div> : <MermaidBlock source={code} />;
        return annotationMode === "editor" ? <div inert><CodeBlock code={code} language={language} /></div> :
          <CodeBlock code={code} language={language} />;
      },
      /** 표 의미는 유지하고 가로로 긴 표에도 키보드 초점을 허용한다. */
      table({ node: _node, ...props }) { return <table {...props} tabIndex={annotationMode === "editor" ? -1 : 0} />; },
    }}>{currentBody}</Markdown></TodoActionContext.Provider></HeadingContext.Provider></div>;
  return annotationMode === "document" && model ?
    <AnnotationDocument body={currentBody} source={source} model={model}>{markdown}</AnnotationDocument> : markdown;
}
