import { Children, type ReactNode } from "react";

import "./markdown-details.css";

/** 원문 HTML 속성을 전달하지 않는 네이티브 접기 컨테이너. */
export function MarkdownDetails({ children }: { children?: ReactNode }) {
  const [summary, ...content] = Children.toArray(children);
  return <details className="markdown-details">{summary}<div className="markdown-details-content">{content}</div></details>;
}

/** 접기의 키보드 조작 가능한 제목. */
export function MarkdownSummary({ children }: { children?: ReactNode }) {
  return <summary>{children}</summary>;
}
