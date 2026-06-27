"use client";

import { useEffect, useState, type ReactNode } from "react";
import { highlightCode, resolveHighlightLanguage, type CodeToken, type HighlightedCode } from "@/lib/code-highlight";

const MAX_CODE_LENGTH = 20_000;
const MAX_CODE_LINES = 500;
type Result = { key: string; tokens: HighlightedCode | null; failed: boolean };

/** 고정 테마의 토큰을 문자열 React 노드로만 표시하고 원본 줄바꿈을 보존한다. */
function tokenLines(lines: CodeToken[][], breaks: string[]): ReactNode {
  return lines.map((line, lineIndex) => <span key={lineIndex} className="code-token-line">{line.map((token, tokenIndex) =>
    <span key={tokenIndex} style={{ color: token.color, fontStyle: token.fontStyle && token.fontStyle & 1 ? "italic" : undefined,
      fontWeight: token.fontStyle && token.fontStyle & 2 ? 700 : undefined,
      textDecorationLine: token.fontStyle && token.fontStyle & 4 ? "underline" : undefined }}>{token.content}</span>)}{breaks[lineIndex] ?? ""}</span>);
}

/** 코드 원문을 먼저 표시하고 허용 언어·크기에 한해 Shiki 결과로 바꾼다. */
export function CodeBlock({ code, language }: { code: string; language?: string }) {
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const supported = resolveHighlightLanguage(language);
  const lines = code.split(/\r\n|\r|\n/);
  const lineCount = lines.length - (lines.at(-1) === "" ? 1 : 0);
  const tooLarge = code.length > MAX_CODE_LENGTH || lineCount > MAX_CODE_LINES;
  const key = `${language ?? ""}\u0000${retry}\u0000${code}`;
  const visible = result?.key === key ? result : null;
  const label = language?.trim().slice(0, 60) || "텍스트";

  useEffect(() => {
    if (!supported || tooLarge || !code) return;
    let live = true;
    void highlightCode(code, supported).then((tokens) => {
      if (live) setResult({ key, tokens, failed: false });
    }).catch(() => { if (live) setResult({ key, tokens: null, failed: true }); });
    return () => { live = false; };
  }, [code, key, supported, tooLarge]);

  return <div className="code-block" role="group" aria-label={`${label} 코드 블록`}>
    <div className="code-block-heading"><span>{label}</span>
      {tooLarge ? <span>긴 코드는 원문으로 표시</span> : !supported && language ? <span>구문 강조 미지원</span> : null}
      {visible?.failed && <button type="button" onClick={() => setRetry((value) => value + 1)}>강조 다시 시도</button>}
    </div>
    <pre tabIndex={0} aria-label={`${label} 코드, 가로로 스크롤 가능`}><code>
      {visible?.tokens ? tokenLines(visible.tokens.tokens, visible.tokens.breaks) : code}
    </code></pre>
  </div>;
}
