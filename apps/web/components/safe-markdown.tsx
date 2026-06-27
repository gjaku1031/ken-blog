"use client";

import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { remarkSafeDetails } from "../lib/markdown-details";
import { parseAttachmentId, parseImageAlt } from "../lib/editor-image";
import { AttachmentImage, type AttachmentSource } from "./attachment-image";
import { MarkdownDetails, MarkdownSummary } from "./markdown-details";
import { CodeBlock } from "./code-block";

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

/** 명시적인 안전한 접기만 표시하고 다른 raw HTML과 이미지 자동 요청을 차단한 GFM 읽기 전용 렌더러. */
export function SafeMarkdown({ body, source }: { body: string; source?: AttachmentSource }) {
  return <div className="markdown-body"><Markdown remarkPlugins={[remarkGfm, remarkSafeDetails]} skipHtml urlTransform={safeUrl}
    components={{
      /** 원문 HTML 속성 없이 접기 구조만 표시한다. */
      details({ children }) { return <MarkdownDetails>{children}</MarkdownDetails>; },
      /** 기본 키보드 조작과 접근성 의미를 가진 제목을 사용한다. */
      summary({ children }) { return <MarkdownSummary>{children}</MarkdownSummary>; },
      /** 단독 이미지의 폭과 정렬 래퍼를 문단 자리에 두어 유효한 HTML을 만든다. */
      p({ node, children }) {
        const standalone = node?.children.length === 1 && node.children[0].type === "element" && node.children[0].tagName === "img";
        return standalone ? <div className="attachment-paragraph">{children}</div> : <p>{children}</p>;
      },
      /** 허용된 링크만 열고 외부 주소는 새 탭 분리 속성을 적용한다. */
      a({ href, children }) {
        if (!href) return <span>{children}</span>;
        const external = /^https?:/i.test(href);
        return <a href={href} target={external ? "_blank" : undefined} rel={external ? "noopener noreferrer" : undefined}>{children}</a>;
      },
      /** 엄격한 첨부 이미지 AST만 허용된 content API로 읽고 나머지는 대체 안내로 표시한다. */
      img({ alt, src }) {
        const id = parseAttachmentId(typeof src === "string" ? src : "");
        const metadata = parseImageAlt(alt ?? "");
        if (id === null || !metadata || !source) return <span className="blocked-image" role="note">지원하지 않는 이미지{alt ? `: ${alt}` : "."}</span>;
        return <AttachmentImage image={{ attachmentId: id, ...metadata }} source={source} />;
      },
      /** GFM 할 일은 상태를 보여 주되 읽기 화면에서 편집할 수 없게 한다. */
      input({ type, checked }) { return <input type={type} checked={checked} disabled readOnly aria-label={checked ? "완료된 항목" : "미완료 항목"} />; },
      /** HAST 코드의 실제 텍스트와 언어만 읽어 강조하고 변환 불가 구조는 원문을 남긴다. */
      pre({ node, ...props }) {
        const codeNode = node?.children.find((child) => child.type === "element" && child.tagName === "code");
        if (!codeNode || codeNode.type !== "element" || !codeNode.children.every((child) => child.type === "text"))
          return <pre {...props} tabIndex={0} role="group" aria-label="코드 블록, 가로로 스크롤 가능" />;
        const code = codeNode.children.map((child) => child.type === "text" ? child.value : "").join("");
        const className = codeNode.properties.className;
        const classes = Array.isArray(className) ? className.filter((item): item is string => typeof item === "string") : [];
        const language = classes.find((item) => item.startsWith("language-"))?.slice(9);
        return <CodeBlock code={code} language={language} />;
      },
      /** 표 의미는 유지하고 가로로 긴 표에도 키보드 초점을 허용한다. */
      table({ node: _node, ...props }) { return <table {...props} tabIndex={0} />; },
    }}>{body}</Markdown></div>;
}
