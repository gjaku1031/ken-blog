"use client";

import { useEffect, useRef, useState } from "react";
import type { CategoryNode } from "@/lib/api";

type Props = { nodes: CategoryNode[]; selected: number | null; busy: boolean;
  onSelect: (id: number) => void; onClose: () => void;
  onPendingChange: (pending: boolean) => void;
  onCreate: (parent: CategoryNode | null, name: string) => Promise<number | null> };

/** 세 단계 분류 트리를 원본 글쓰기의 작은 선택 팝오버로 표시한다. */
export function CategoryPicker({ nodes, selected, busy, onSelect, onClose, onCreate, onPendingChange }: Props) {
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  const [adding, setAdding] = useState<number | "root" | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [focusCreated, setFocusCreated] = useState<number | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const creating = useRef(false);
  const locked = busy || creating.current;

  useEffect(() => {
    if (focusCreated === null) return;
    const target = root.current?.querySelector<HTMLButtonElement>(`[data-category-id="${focusCreated}"]`);
    if (target) { target.focus(); setFocusCreated(null); }
  }, [focusCreated, nodes]);

  /** 대·중분류는 자식이 아직 없어도 펼쳐 새 하위 분류 행을 보여 준다. */
  function select(node: CategoryNode) {
    if (locked) return;
    onSelect(node.id);
    if (node.depth < 3) setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(node.id)) next.delete(node.id); else next.add(node.id);
      return next;
    });
  }

  /** {@link CategoryPicker}에서 중복 Enter를 막고 새 분류 선택·부모 확장을 완료한다. */
  async function create(parent: CategoryNode | null) {
    if (locked) return;
    const trimmed = name.trim().replace(/ +/g, " ");
    if (!trimmed) { setError("분류 이름을 입력해 주세요."); return; }
    if ([...trimmed].length > 60 || !/^[\p{L}\p{N}]+(?:[ -][\p{L}\p{N}]+)*$/u.test(trimmed)) {
      setError("분류 이름은 글자·숫자와 단일 공백·하이픈으로 1~60자까지 입력해 주세요."); return;
    }
    creating.current = true; onPendingChange(true); setError("");
    try {
      const id = await onCreate(parent, trimmed);
      if (id === null) { setError("분류를 만들지 못했습니다. 다시 시도해 주세요."); return; }
      if (parent) setExpanded((previous) => new Set(previous).add(parent.id));
      setName(""); setAdding(null); setFocusCreated(id); setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "분류를 만들지 못했습니다."); }
    finally { creating.current = false; onPendingChange(false); }
  }

  /** 선택 팝오버 안의 트리 한 수준을 같은 배치로 재귀 렌더링한다. */
  function renderLevel(level: CategoryNode[], depth: number): React.ReactNode {
    return level.map((node) => <div key={node.id}>
      <button type="button" data-category-id={node.id} className={`editor-category-option depth-${depth}${selected === node.id ? " selected" : ""}`}
        onClick={() => select(node)} disabled={locked} aria-expanded={node.depth < 3 ? expanded.has(node.id) : undefined}>
        <span className="editor-category-arrow">{node.depth < 3 ? expanded.has(node.id) ? "⌄" : "›" : ""}</span>
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
      <input autoFocus aria-label="새 분류 이름" value={name} placeholder="새 분류 이름 · Enter" disabled={locked}
        onChange={(event) => setName(event.target.value)} onKeyDown={(event) => {
          if (event.key === "Enter" && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); void create(parent); }
          if (event.key === "Escape" && !locked) setAdding(null);
        }} />
    </div> : <button type="button" className={`editor-category-option editor-category-new depth-${depth}`}
      disabled={locked} onClick={() => { setAdding(key); setName(""); setError(""); }}>＋ 새 {depth === 1 ? "대" : depth === 2 ? "중" : "소"}분류</button>;
  }

  return <div ref={root} className="editor-category-popover" role="dialog" aria-label="분류 고르기">
    <div className="editor-category-header"><strong>분류 고르기</strong><span>클릭해서 선택 · 대 / 중 / 소</span></div>
    <div className="editor-category-tree">{renderLevel(nodes, 1)}{renderAdd(null, 1)}</div>
    {error && <p role="alert" className="editor-category-error">{error}</p>}
    <div className="editor-category-footer"><button type="button" className="primary-button" disabled={locked} onClick={onClose}>완료</button></div>
  </div>;
}
