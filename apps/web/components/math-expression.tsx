"use client";

import { useEffect, useRef, useState } from "react";
import { isOversizeMath, readableMathFallback } from "@/lib/math-format";

type MathState = { key: string; kind: "ready" | "load-error" | "syntax-error" };

/** 단일 수식을 격리된 DOM에 MathML로 그리고 늦은 결과가 새 원문에 섞이지 않게 한다. */
export function MathExpression({ source, display }: { source: string; display: boolean }) {
  const target = useRef<HTMLSpanElement | null>(null);
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<MathState | null>(null);
  const key = `${display ? "block" : "inline"}\u0000${retry}\u0000${source}`;
  const current = state?.key === key ? state.kind : null;
  const oversized = isOversizeMath(source);
  const fallback = readableMathFallback(source);

  useEffect(() => {
    if (oversized || !source.trim()) return;
    const element = target.current;
    if (!element) return;
    let live = true;
    void import("katex").then(({ default: katex }) => {
      if (!live || !element.isConnected) return;
      try {
        element.replaceChildren();
        katex.render(source, element, { displayMode: display, output: "mathml", trust: false, throwOnError: false,
          maxExpand: 1000, maxSize: 10, strict: "ignore", macros: Object.create(null) });
        if (!live) return;
        if (element.querySelector(".katex-error, merror")) {
          element.replaceChildren();
          setState({ key, kind: "syntax-error" });
        } else setState({ key, kind: "ready" });
      } catch {
        element.replaceChildren();
        if (live) setState({ key, kind: "syntax-error" });
      }
    }).catch(() => { if (live) setState({ key, kind: "load-error" }); });
    return () => { live = false; element.replaceChildren(); };
  }, [display, key, oversized, source]);

  const contents = <>
    <span key={key} ref={target} className="math-rendered" hidden={current !== "ready"} />
    {current !== "ready" && <span className="math-fallback">{fallback || source}</span>}
    {oversized && <span className="math-notice">긴 수식은 원문으로 표시</span>}
    {current === "syntax-error" && <span className="math-notice math-error">수식 문법을 확인해 주세요. 원문: <code>{source}</code></span>}
    {current === "load-error" && <span className="math-notice math-error">수식 표시를 불러오지 못했습니다.
      {display ? <button type="button" onClick={() => setRetry((value) => value + 1)}>다시 시도</button> :
        <span> 화면을 새로고침해 다시 시도할 수 있습니다.</span>}</span>}
  </>;

  return display ? <div className="math-expression math-display" tabIndex={0} role="group" aria-label="수식, 가로로 스크롤 가능">
    {contents}</div> : <span className="math-expression math-inline">{contents}</span>;
}
