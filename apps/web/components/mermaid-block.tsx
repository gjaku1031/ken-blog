"use client";

import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { mermaidSourceError, renderMermaid, type MermaidTheme } from "@/lib/mermaid-render";
import { useAuth } from "./auth-provider";
import { MediaOpenButton, MediaViewer } from "./media-viewer";

type RenderState = { key: string; status: "ready" | "error"; url: string; width: number; height: number };
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

/** 검사된 SVG의 viewBox에서 확대 창 크기를 읽고 긴 도식의 두 축을 같은 비율로 제한한다. */
function mermaidSvgSize(svg: string): { width: number; height: number } {
  const root = new DOMParser().parseFromString(svg, "image/svg+xml").documentElement;
  const viewBox = root.getAttribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
  const width = viewBox?.length === 4 ? viewBox[2] : Number.parseFloat(root.getAttribute("width") ?? "");
  const height = viewBox?.length === 4 ? viewBox[3] : Number.parseFloat(root.getAttribute("height") ?? "");
  const naturalWidth = Number.isFinite(width) && width > 0 ? width : 600;
  const naturalHeight = Number.isFinite(height) && height > 0 ? height : 400;
  const divisor = Math.max(1, naturalWidth / 10000, naturalHeight / 10000);
  return { width: naturalWidth / divisor, height: naturalHeight / divisor };
}

/** 빠른 흐름도를 본문과 확대 창에 동일한 구조로 표시한다. */
function SimpleFlowDiagram({ flow }: { flow: SimpleFlow }) {
  return <><div className="mermaid-simple" role="img" aria-label={flow.edgesText ||
    flow.nodes.map((node) => node.label).join(" → ")}>
    {flow.nodes.map((node, index) => <span className="mermaid-simple-part" key={node.id}>
      {index > 0 && <span className="mermaid-simple-arrow" aria-hidden="true"><span /><svg width="12" height="12"
        viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m9 6 6 6-6 6" /></svg></span>}
      <span className={`mermaid-simple-node${node.db ? " db" : ""}`}>{node.label}</span></span>)}</div>
    {flow.edgesText && <div className="mermaid-edges mono">{flow.edgesText}</div>}</>;
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
  const [openKey, setOpenKey] = useState<string | null>(null);
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

  /** 경로·계정·테마·원문이 바뀌면 이전 도식의 확대 상태를 지운다. */
  useEffect(() => setOpenKey(null), [key]);

  useEffect(() => {
    if (view !== "diagram" || sourceError || simpleFlow) return;
    const controller = new AbortController();
    let objectUrl = "";
    void renderMermaid(source, theme, controller.signal).then((svg) => {
      if (controller.signal.aborted) return;
      objectUrl = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
      setState({ key, status: "ready", url: objectUrl, ...mermaidSvgSize(svg) });
    }).catch(() => {
      if (!controller.signal.aborted) setState({ key, status: "error", url: "", width: 0, height: 0 });
    });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [key, source, sourceError, simpleFlow, theme, view]);

  return <div className="mermaid-block" role="group" aria-label="Mermaid 도식 블록">
    <div className="mermaid-heading"><span><span className="mono">mermaid</span> · {simpleFlow?.kind ?? kind}</span>
      {view === "diagram" && !sourceError && (simpleFlow || visible?.status === "ready") &&
        <MediaOpenButton label="Mermaid 도식 확대해서 보기" onClick={() => setOpenKey(key)} />}
      {view === "source" ? <button type="button" onClick={() => { setState(null); setView("diagram"); }}>다이어그램 보기</button> :
        <button type="button" onClick={() => { setOpenKey(null); setState(null); setView("source"); }}>소스 보기</button>}
      {visible?.status === "error" && !sourceError && <button type="button" onClick={() => setRetry((value) => value + 1)}>다시 시도</button>}
    </div>
    {simpleFlow && view === "diagram" ? <SimpleFlowDiagram flow={simpleFlow} /> : showSource ? <>
      {(sourceError || visible?.status === "error" || (view === "diagram" && !visible)) && <p className="mermaid-notice" role="status">
        {sourceError || (visible?.status === "error" ? "도식을 표시하지 못했습니다. 원문을 확인하거나 다시 시도해 주세요." :
          "도식을 그리는 중입니다. 그동안 원문을 표시합니다.")}</p>}
      <pre tabIndex={0} aria-label="Mermaid 원문, 가로로 스크롤 가능"><code>{source}</code></pre>
    </> : <div className="mermaid-preview" tabIndex={0} role="group" aria-label="Mermaid 도식, 가로로 스크롤 가능">
      {visible?.status === "ready" ? <img src={visible.url} alt="Mermaid 도식. 소스 보기에서 전체 관계를 텍스트로 확인할 수 있습니다." /> :
        <p className="mermaid-notice" role="status">도식을 그리는 중입니다. 소스 보기에서 원문을 확인할 수 있습니다.</p>}
    </div>}
    {view === "diagram" && !sourceError && openKey === key && simpleFlow &&
      <MediaViewer title="Mermaid 흐름도" maxFitScale={8} onClose={() => setOpenKey(null)}>
        <SimpleFlowDiagram flow={simpleFlow} />
      </MediaViewer>}
    {view === "diagram" && !sourceError && openKey === key && !simpleFlow && visible?.status === "ready" &&
      <MediaViewer title="Mermaid 도식" src={visible.url} width={visible.width} height={visible.height} maxFitScale={8}
        alt="Mermaid 도식. 소스 보기에서 전체 관계를 텍스트로 확인할 수 있습니다." onClose={() => setOpenKey(null)} />}
  </div>;
}
