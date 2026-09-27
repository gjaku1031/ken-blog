"use client";

import { useState } from "react";
import type { CategoryNode } from "@/lib/api";

type Props = { nodes: CategoryNode[]; selected: number | null; busy: boolean;
  onSelect: (id: number) => void; onClose: () => void;
  onCreate: (parent: CategoryNode | null, name: string) => Promise<number | null> };

/** 세 단계 분류 트리를 원본 글쓰기의 작은 선택 팝오버로 표시한다. */
export function CategoryPicker({ nodes, selected, busy, onSelect, onClose, onCreate }: Props) {
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  const [adding, setAdding] = useState<number | "root" | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState("");

  /** 노드 선택과 하위 목록 펼치기를 같이 처리한다. */
  function select(node: CategoryNode) {
    onSelect(node.id);
    if (node.children.length) setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(node.id)) next.delete(node.id); else next.add(node.id);
      return next;
    });
  }

  /** 새 분류를 서버에 만들고 부모가 다시 읽은 목록을 표시하도록 한다. */
  async function create(parent: CategoryNode | null) {
    const trimmed = name.trim();
    if (!trimmed) { setError("분류 이름을 입력해 주세요."); return; }
    try { const id = await onCreate(parent, trimmed);
      if (id !== null && parent) setExpanded((previous) => new Set(previous).add(parent.id));
      setName(""); setAdding(null); setError(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "분류를 만들지 못했습니다."); }
  }

  /** 선택 팝오버 안의 트리 한 수준을 같은 배치로 재귀 렌더링한다. */
  function renderLevel(level: CategoryNode[], depth: number): React.ReactNode {
    return level.map((node) => <div key={node.id}>
      <button type="button" className={`editor-category-option depth-${depth}${selected === node.id ? " selected" : ""}`}
        onClick={() => select(node)} disabled={busy} aria-expanded={node.children.length ? expanded.has(node.id) : undefined}>
        <span className="editor-category-arrow">{node.children.length ? expanded.has(node.id) ? "⌄" : "›" : ""}</span>
        <span className="editor-category-folder" aria-hidden="true"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg></span><span className="editor-category-name">{node.name}</span>
        <span className="editor-category-count">{node.totalCount}</span>
      </button>
      {node.children.length > 0 && expanded.has(node.id) && renderLevel(node.children, depth + 1)}
      {expanded.has(node.id) && depth < 3 && renderAdd(node, depth + 1)}
    </div>);
  }

  /** 대·중·소 분류 생성 행의 입력을 Enter로 제출한다. */
  function renderAdd(parent: CategoryNode | null, depth: number): React.ReactNode {
    const key = parent?.id ?? "root";
    return adding === key ? <div className={`editor-category-add depth-${depth}`}>
      <input autoFocus aria-label="새 분류 이름" value={name} placeholder="새 분류 이름 · Enter" disabled={busy}
        onChange={(event) => setName(event.target.value)} onKeyDown={(event) => {
          if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); void create(parent); }
          if (event.key === "Escape") setAdding(null);
        }} />
    </div> : <button type="button" className={`editor-category-option editor-category-new depth-${depth}`}
      disabled={busy} onClick={() => { setAdding(key); setName(""); setError(""); }}>＋ 새 {depth === 1 ? "대" : depth === 2 ? "중" : "소"}분류</button>;
  }

  return <div className="editor-category-popover" role="dialog" aria-label="분류 고르기">
    <div className="editor-category-header"><strong>분류 고르기</strong><span>클릭해서 선택 · 대 / 중 / 소</span></div>
    <div className="editor-category-tree">{renderLevel(nodes, 1)}{renderAdd(null, 1)}</div>
    {error && <p role="alert" className="editor-category-error">{error}</p>}
    <div className="editor-category-footer"><button type="button" className="primary-button" onClick={onClose}>완료</button></div>
  </div>;
}
