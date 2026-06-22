"use client";

import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { remarkSafeDetails } from "../lib/markdown-details";
import { MarkdownDetails, MarkdownSummary } from "./markdown-details";

/** 실행 가능한 스킴과 프로토콜 상대 주소를 막고 안전한 글 링크만 남긴다. */
function safeUrl(value: string): string {
  const url = value.trim();
  if (/[\u0000-\u001f\u007f\\]/.test(url)) return "";
  if (url.startsWith("#") || (url.startsWith("/") && !url.startsWith("//"))) return url;
  if (/^(https?:|mailto:)/i.test(url)) return url;
  if (/^[^:/?#][^:]*$/.test(url)) return url;
  return "";
}

/** 명시적인 안전한 접기만 표시하고 다른 raw HTML과 이미지 자동 요청을 차단한 GFM 읽기 전용 렌더러. */
export function SafeMarkdown({ body }: { body: string }) {
  return <div className="markdown-body"><Markdown remarkPlugins={[remarkGfm, remarkSafeDetails]} skipHtml urlTransform={safeUrl}
    components={{
      /** 원문 HTML 속성 없이 접기 구조만 표시한다. */
      details({ children }) { return <MarkdownDetails>{children}</MarkdownDetails>; },
      /** 기본 키보드 조작과 접근성 의미를 가진 제목을 사용한다. */
      summary({ children }) { return <MarkdownSummary>{children}</MarkdownSummary>; },
      /** 허용된 링크만 열고 외부 주소는 새 탭 분리 속성을 적용한다. */
      a({ href, children }) {
        if (!href) return <span>{children}</span>;
        const external = /^https?:/i.test(href);
        return <a href={href} target={external ? "_blank" : undefined} rel={external ? "noopener noreferrer" : undefined}>{children}</a>;
      },
      /** 이미지 원본 주소를 자동 요청하지 않고 대체 텍스트만 표시한다. */
      img({ alt }) { return <span className="blocked-image" role="note">이미지는 공개 전달 기능 준비 후 표시됩니다{alt ? `: ${alt}` : "."}</span>; },
      /** GFM 할 일은 상태를 보여 주되 읽기 화면에서 편집할 수 없게 한다. */
      input({ type, checked }) { return <input type={type} checked={checked} disabled readOnly aria-label={checked ? "완료된 항목" : "미완료 항목"} />; },
      /** 긴 코드 블록에 키보드 초점을 허용하되 반복되는 랜드마크를 만들지 않는다. */
      pre({ node: _node, ...props }) { return <pre {...props} tabIndex={0} role="group" aria-label="코드 블록, 가로로 스크롤 가능" />; },
      /** 표 의미는 유지하고 가로로 긴 표에도 키보드 초점을 허용한다. */
      table({ node: _node, ...props }) { return <table {...props} tabIndex={0} />; },
    }}>{body}</Markdown></div>;
}
