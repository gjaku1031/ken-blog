"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { mermaidSourceError, renderMermaid, type MermaidTheme } from "@/lib/mermaid-render";
import { useAuth } from "./auth-provider";

type RenderState = { key: string; status: "ready" | "error"; url: string };

/** 문서 테마 변경을 현재 도식에 반영하며 설정은 렌더 작업마다 독립적으로 선택한다. */
function useDocumentTheme(): MermaidTheme {
  const [theme, setTheme] = useState<MermaidTheme>("light");
  useEffect(() => {
    const update = () => setTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);
  return theme;
}

/** 도식 원문을 항상 제공하고 현재 경로·계정·테마에 맞는 SVG 이미지에만 렌더 결과를 표시한다. */
export function MermaidBlock({ source }: { source: string }) {
  const pathname = usePathname();
  const auth = useAuth();
  const theme = useDocumentTheme();
  const [view, setView] = useState<"diagram" | "source">("diagram");
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<RenderState | null>(null);
  const sourceError = mermaidSourceError(source);
  const kind = /^(?:flowchart|graph)\b/.test(source.trimStart()) ? "흐름도" :
    /^sequenceDiagram\b/.test(source.trimStart()) ? "시퀀스" :
    /^classDiagram\b/.test(source.trimStart()) ? "클래스" :
    /^stateDiagram(?:-v2)?\b/.test(source.trimStart()) ? "상태" :
    /^erDiagram\b/.test(source.trimStart()) ? "ER" : "도식";
  const key = `${pathname}\u0000${auth.epoch}\u0000${auth.status}\u0000${theme}\u0000${retry}\u0000${source}`;
  const visible = state?.key === key && view === "diagram" ? state : null;
  const showSource = view === "source" || sourceError !== null || visible?.status !== "ready";

  useEffect(() => {
    if (view !== "diagram" || sourceError) return;
    const controller = new AbortController();
    let objectUrl = "";
    void renderMermaid(source, theme, controller.signal).then((svg) => {
      if (controller.signal.aborted) return;
      objectUrl = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
      setState({ key, status: "ready", url: objectUrl });
    }).catch(() => {
      if (!controller.signal.aborted) setState({ key, status: "error", url: "" });
    });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [key, source, sourceError, theme, view]);

  return <div className="mermaid-block" role="group" aria-label="Mermaid 도식 블록">
    <div className="mermaid-heading"><span>Mermaid {kind}</span>
      <button type="button" aria-pressed={view === "diagram"} onClick={() => { if (view === "source") { setState(null); setView("diagram"); } }}>다이어그램 보기</button>
      <button type="button" aria-pressed={view === "source"} onClick={() => { if (view === "diagram") { setState(null); setView("source"); } }}>소스 보기</button>
      {visible?.status === "error" && !sourceError && <button type="button" onClick={() => setRetry((value) => value + 1)}>다시 시도</button>}
    </div>
    {showSource ? <>
      {(sourceError || visible?.status === "error" || (view === "diagram" && !visible)) && <p className="mermaid-notice" role="status">
        {sourceError || (visible?.status === "error" ? "도식을 표시하지 못했습니다. 원문을 확인하거나 다시 시도해 주세요." :
          "도식을 그리는 중입니다. 그동안 원문을 표시합니다.")}</p>}
      <pre tabIndex={0} aria-label="Mermaid 원문, 가로로 스크롤 가능"><code>{source}</code></pre>
    </> : <div className="mermaid-preview" tabIndex={0} role="group" aria-label="Mermaid 도식, 가로로 스크롤 가능">
      {visible?.status === "ready" ? <img src={visible.url} alt="Mermaid 도식. 소스 보기에서 전체 관계를 텍스트로 확인할 수 있습니다." /> :
        <p className="mermaid-notice" role="status">도식을 그리는 중입니다. 소스 보기에서 원문을 확인할 수 있습니다.</p>}
    </div>}
  </div>;
}
