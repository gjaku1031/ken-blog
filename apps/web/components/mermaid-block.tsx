"use client";

import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { mermaidSourceError, renderMermaid, type MermaidTheme } from "@/lib/mermaid-render";
import { useAuth } from "./auth-provider";

type RenderState = { key: string; status: "ready" | "error"; url: string };
type SimpleFlow = { kind: string; nodes: { id: string; label: string; db: boolean }[]; edgesText: string };

/** 원본의 {@link MermaidBlock} 가로 흐름도에 쓰인 단순 노드·간선 문법만 식별한다. */
function parseSimpleFlow(source: string): SimpleFlow | null {
  const lines = source.trim().split(/\r\n|\r|\n/).map((line) => line.trim()).filter(Boolean);
  if (!/^(?:flowchart|graph)\s+LR$/.test(lines[0] ?? "")) return null;
  const nodes = new Map<string, { id: string; label: string; db: boolean }>();
  const edges: [string, string][] = [];
  const register = (token: string): string | null => {
    const match = /^([A-Za-z0-9_]+)(?:\[\(([^\]\n]+)\)\]|\[([^\]\n]+)\]|\(([^)\n]+)\))?$/.exec(token.trim());
    if (!match) return null;
    const id = match[1];
    const previous = nodes.get(id);
    const label = match[2] ?? match[3] ?? match[4] ?? previous?.label ?? id;
    nodes.set(id, { id, label, db: match[2] !== undefined || previous?.db === true });
    return id;
  };
  for (const line of lines.slice(1)) {
    const parts = line.split(/\s*--?>\s*/);
    if (parts.length < 2 || parts.some((part) => !part)) return null;
    let from = register(parts[0]);
    if (!from) return null;
    for (const part of parts.slice(1)) {
      const to = register(part);
      if (!to) return null;
      edges.push([from, to]); from = to;
    }
  }
  if (!edges.length || nodes.size > 16 || nodes.size !== edges.length + 1 ||
    edges.some(([from, to], index) => from === to || index > 0 && from !== edges[index - 1][1])) return null;
  return { kind: lines[0], nodes: [...nodes.values()], edgesText: "" };
}

/** 문서 테마 변경을 현재 도식에 반영하며 설정은 렌더 작업마다 독립적으로 선택한다. {@link useDocumentTheme} */
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

/** 도식 원문을 항상 제공하고 현재 경로·계정·테마에 맞는 SVG 이미지에만 렌더 결과를 표시한다. {@link MermaidBlock} */
export function MermaidBlock({ source }: { source: string }) {
  const pathname = usePathname();
  const auth = useAuth();
  const theme = useDocumentTheme();
  const [view, setView] = useState<"diagram" | "source">("diagram");
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<RenderState | null>(null);
  const sourceError = mermaidSourceError(source);
  const simpleFlow = useMemo(() => sourceError ? null : parseSimpleFlow(source), [source, sourceError]);
  const kind = /^(?:flowchart|graph)\b/.test(source.trimStart()) ? "흐름도" :
    /^sequenceDiagram\b/.test(source.trimStart()) ? "시퀀스" :
    /^classDiagram\b/.test(source.trimStart()) ? "클래스" :
    /^stateDiagram(?:-v2)?\b/.test(source.trimStart()) ? "상태" :
    /^erDiagram\b/.test(source.trimStart()) ? "ER" : "도식";
  const key = `${pathname}\u0000${auth.epoch}\u0000${auth.status}\u0000${theme}\u0000${retry}\u0000${source}`;
  const visible = state?.key === key && view === "diagram" ? state : null;
  const showSource = view === "source" || sourceError !== null || visible?.status !== "ready";

  useEffect(() => {
    if (view !== "diagram" || sourceError || simpleFlow) return;
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
  }, [key, source, sourceError, simpleFlow, theme, view]);

  return <div className="mermaid-block" role="group" aria-label="Mermaid 도식 블록">
    <div className="mermaid-heading"><span><span className="mono">mermaid</span> · {simpleFlow?.kind ?? kind}</span>
      {view === "source" ? <button type="button" onClick={() => { setState(null); setView("diagram"); }}>다이어그램 보기</button> :
        <button type="button" onClick={() => { setState(null); setView("source"); }}>소스 보기</button>}
      {visible?.status === "error" && !sourceError && <button type="button" onClick={() => setRetry((value) => value + 1)}>다시 시도</button>}
    </div>
    {simpleFlow && view === "diagram" ? <><div className="mermaid-simple" role="img" aria-label={simpleFlow.edgesText ||
      simpleFlow.nodes.map((node) => node.label).join(" → ")}>
      {simpleFlow.nodes.map((node, index) => <span className="mermaid-simple-part" key={node.id}>
        {index > 0 && <span className="mermaid-simple-arrow" aria-hidden="true"><span /><svg width="12" height="12"
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m9 6 6 6-6 6" /></svg></span>}
        <span className={`mermaid-simple-node${node.db ? " db" : ""}`}>{node.label}</span></span>)}</div>
      {simpleFlow.edgesText && <div className="mermaid-edges mono">{simpleFlow.edgesText}</div>}</> : showSource ? <>
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
