"use client";

import { useEffect, useLayoutEffect, useRef, useState, type DragEvent, type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent } from "react";
import { ApiFailure, apiFailureMessage, type CategoryNode, parseCategories } from "@/lib/api";
import { useAuth } from "../auth-provider";

type DropSide = "before" | "after";
type DraggedCategory = { id: number; parentId: number | null; name: string };
type DropTarget = { id: number; parentId: number | null; side: DropSide };

/** 선택한 부모 경로 아래에 만들 분류의 깊이별 이름을 표시한다. */
function childLabel(depth: number): string { return ["대분류", "중분류", "소분류"][depth] ?? "분류"; }

/** {@link CategoryRow}에 쓰는 원본 설계의 폴더 선 아이콘이다. */
function FolderIcon() { return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
  strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>; }

/** {@link CategoryRow}에서 접힘 상태를 표시하는 원본 설계의 화살표다. */
function ChevronIcon({ expanded }: { expanded: boolean }) { return <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
  stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"
  style={{ transform: expanded ? "rotate(90deg)" : undefined }}><path d="m9 6 6 6-6 6" /></svg>; }

/** {@link CategoryRow} 삭제 단추에 쓰는 원본 설계의 휴지통 선 아이콘이다. */
function TrashIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
  strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path
    d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" /></svg>; }

/** {@link CategoryRow}의 형제 집합을 서버가 반환한 순서 그대로 찾는다. */
function siblingsOf(nodes: CategoryNode[], parentId: number | null): CategoryNode[] | null {
  if (parentId === null) return nodes;
  for (const node of nodes) {
    if (node.id === parentId) return node.children;
    const nested = siblingsOf(node.children, parentId);
    if (nested) return nested;
  }
  return null;
}

/** {@link siblingsOf}가 찾은 형제 배열만 바꾸고 다른 깊이의 순서를 보존한다. */
function replaceSiblings(nodes: CategoryNode[], parentId: number | null, ordered: CategoryNode[]): CategoryNode[] {
  if (parentId === null) return ordered;
  return nodes.map((node) => node.id === parentId ? { ...node, children: ordered } :
    { ...node, children: replaceSiblings(node.children, parentId, ordered) });
}

type RowProps = {
  node: CategoryNode; siblings: CategoryNode[]; index: number; parentId: number | null; ancestors: string[];
  busy: boolean; draggingId: number | null; drop: DropTarget | null; flashId: number | null;
  onCreate: (parent: CategoryNode | null, name: string) => Promise<void>;
  onRemove: (node: CategoryNode) => Promise<void>;
  onMove: (id: number, parentId: number | null, targetId: number, side: DropSide) => void;
  onDragStart: (event: DragEvent<HTMLButtonElement>, node: CategoryNode, parentId: number | null) => void;
  onDragOver: (event: DragEvent<HTMLDivElement>, node: CategoryNode, parentId: number | null) => void;
  onDrop: (event: DragEvent<HTMLDivElement>, node: CategoryNode, parentId: number | null) => void;
  onDragEnd: () => void;
};

/** {@link CategoryManager}의 한 행과 같은 부모 내 이동·하위 생성·삭제를 처리한다. */
function CategoryRow({ node, siblings, index, parentId, ancestors, busy, draggingId, drop, flashId,
  onCreate, onRemove, onMove, onDragStart, onDragOver, onDrop, onDragEnd }: RowProps) {
  const [expanded, setExpanded] = useState(false);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [deleting, setDeleting] = useState(false);
  const displayPath = [...ancestors, node.name].join(" › ");
  const parentName = ancestors.at(-1) ?? "상위 분류";
  const childProps = { busy, draggingId, drop, flashId, onCreate, onRemove, onMove, onDragStart, onDragOver, onDrop, onDragEnd };
  const activeDrop = drop?.id === node.id && drop.parentId === parentId ? drop.side : undefined;

  /** {@link onCreate}로 현재 경로에 이름 한 단계만 추가한다. */
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim() || busy) return;
    try { await onCreate(node, name.trim()); setName(""); setAdding(false); setExpanded(true); }
    catch { /* 오류는 상위 경고 영역에 표시한다. */ }
  }

  /** {@link onMove}로 손잡이의 Alt+방향키 이동을 수행한다. */
  function moveWithKey(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
    event.preventDefault();
    const offset = event.key === "ArrowUp" ? -1 : 1;
    const target = siblings[index + offset];
    if (target && !busy) onMove(node.id, parentId, target.id, offset < 0 ? "before" : "after");
  }

  return <li className={`category-admin-node${draggingId === node.id ? " is-dragging" : ""}${flashId === node.id ? " is-moved" : ""}`}
    data-category-id={node.id} data-drop-side={activeDrop}>
    <div className="category-admin-row" onDragOver={(event) => onDragOver(event, node, parentId)}
      onDrop={(event) => onDrop(event, node, parentId)}>
      <button className="category-order-handle" type="button" draggable={!busy} disabled={busy}
        aria-label={`${node.name} 순서 이동`} title="끌어서 순서 이동 · Alt+위/아래 방향키"
        onKeyDown={moveWithKey} onDragStart={(event) => onDragStart(event, node, parentId)} onDragEnd={onDragEnd}>
        <span aria-hidden="true">⠿</span></button>
      <button className="category-folder" type="button" aria-label={expanded ? `${node.name} 접기` : `${node.name} 펼치기`}
        aria-expanded={node.children.length ? expanded : undefined} onClick={() => setExpanded((value) => !value)}>
        <span className={node.children.length ? "" : "category-chevron-empty"}><ChevronIcon expanded={expanded} /></span>
        <FolderIcon /><span className="category-folder-name">{node.name}</span><span className="category-folder-count">{node.totalCount}</span></button>
      <button type="button" className="category-order-up" aria-label={`${node.name} 위로 이동`} title="위로 이동"
        disabled={busy || index === 0} onClick={() => onMove(node.id, parentId, siblings[index - 1].id, "before")}>↑</button>
      <button type="button" className="category-order-down" aria-label={`${node.name} 아래로 이동`} title="아래로 이동"
        disabled={busy || index === siblings.length - 1}
        onClick={() => onMove(node.id, parentId, siblings[index + 1].id, "after")}>↓</button>
      <button type="button" className="category-delete" aria-label={`${node.path} 분류 삭제`} title="분류 삭제"
        disabled={busy} onClick={() => setDeleting(true)}><TrashIcon /></button>
    </div>
    {deleting && <div className="inline-confirm" role="alertdialog" aria-label="분류 삭제 확인">
      <p className="inline-confirm-title">“{displayPath}” 분류를 삭제합니다.</p>
      {node.totalCount > 0 && <p>안에 있는 글 {node.totalCount}개는 “{parentName}”(으)로 옮겨집니다. 글은 지워지지 않습니다.</p>}
      {node.children.length > 0 && <p>하위 분류 {node.children.length}개도 함께 삭제됩니다.</p>}
      <div className="inline-confirm-actions"><button type="button" className="small-button" onClick={() => setDeleting(false)}>취소</button>
        <button type="button" className="small-button danger-button" disabled={busy}
          onClick={() => { void onRemove(node).then(() => setDeleting(false)).catch(() => undefined); }}>
          {node.totalCount > 0 ? "옮기고 삭제" : "삭제"}</button></div>
    </div>}
    {expanded && node.children.length > 0 && <ul data-category-parent={node.id}>{node.children.map((child, childIndex) =>
      <CategoryRow key={child.id} node={child} siblings={node.children} index={childIndex} parentId={node.id}
        ancestors={[...ancestors, node.name]} {...childProps} />)}</ul>}
    {expanded && node.depth < 3 && (adding ? <form className="category-inline-form" onSubmit={(event) => void create(event)}
      onKeyDown={(event) => { if (event.key === "Escape") { setAdding(false); setName(""); } }}>
      <input aria-label={`새 ${childLabel(node.depth)} 이름`} value={name} autoFocus disabled={busy}
        onChange={(event) => setName(event.target.value)} />
      <button type="submit" disabled={busy}>추가</button><button type="button" onClick={() => setAdding(false)}>취소</button></form> :
      <button type="button" className="category-add" disabled={busy} onClick={() => setAdding(true)}>+ 새 {childLabel(node.depth)}</button>)}
  </li>;
}

/** {@link CategoryRow}를 통해 저장된 빈 폴더까지 포함한 관리자 분류 트리를 조회·수정한다. */
export function CategoryManager() {
  const auth = useAuth();
  const [nodes, setNodes] = useState<CategoryNode[]>([]);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [drop, setDrop] = useState<DropTarget | null>(null);
  const [flashId, setFlashId] = useState<number | null>(null);
  const busyRef = useRef(false);
  const draggedRef = useRef<DraggedCategory | null>(null);
  const ghostRef = useRef<HTMLElement | null>(null);
  const treeRef = useRef<HTMLDivElement | null>(null);
  const beforeMoveRef = useRef<Map<number, DOMRect> | null>(null);
  const restoreFocusRef = useRef<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try { const result = parseCategories(await auth.adminRead("/api/v1/admin/categories", controller.signal));
        if (!controller.signal.aborted) { setNodes(result); setError(""); } }
      catch (failure) { if (!controller.signal.aborted) setError(apiFailureMessage(failure)); }
    })();
    return () => controller.abort();
  }, [auth.adminRead, reload]);

  useEffect(() => {
    if (flashId === null) return;
    const timer = window.setTimeout(() => setFlashId(null), 850);
    return () => window.clearTimeout(timer);
  }, [flashId]);

  useEffect(() => {
    /** {@link endDrag}로 트리 밖에 놓기·Escape·창 전환·화면 이탈을 정리한다. */
    function cancelDrag(event: globalThis.KeyboardEvent | Event) {
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      endDrag();
    }
    window.addEventListener("keydown", cancelDrag);
    window.addEventListener("blur", cancelDrag);
    window.addEventListener("drop", cancelDrag);
    window.addEventListener("dragend", cancelDrag);
    return () => {
      window.removeEventListener("keydown", cancelDrag);
      window.removeEventListener("blur", cancelDrag);
      window.removeEventListener("drop", cancelDrag);
      window.removeEventListener("dragend", cancelDrag);
      ghostRef.current?.remove();
    };
  }, []);

  useEffect(() => {
    if (busy || restoreFocusRef.current === null) return;
    const id = restoreFocusRef.current;
    restoreFocusRef.current = null;
    treeRef.current?.querySelector<HTMLElement>(`[data-category-id="${id}"] > .category-admin-row > .category-order-handle`)?.focus();
  }, [busy]);

  useLayoutEffect(() => {
    const before = beforeMoveRef.current;
    beforeMoveRef.current = null;
    if (!before || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    treeRef.current?.querySelectorAll<HTMLElement>(".category-admin-node[data-category-id]").forEach((item) => {
      const previous = before.get(Number(item.dataset.categoryId));
      const row = item.querySelector<HTMLElement>(":scope > .category-admin-row");
      if (!previous || !row) return;
      const current = row.getBoundingClientRect();
      const deltaY = previous.top - current.top;
      if (Math.abs(deltaY) < 1 || Math.abs(deltaY) > 600) return;
      row.animate([{ transform: `translateY(${deltaY}px)` }, { transform: "translateY(0)" }],
        { duration: 180, easing: "ease-out" });
    });
  }, [nodes]);

  /** {@link move}의 전후 행 위치를 짧게 보간할 수 있도록 현재 좌표를 기억한다. */
  function rememberPositions() {
    const positions = new Map<number, DOMRect>();
    treeRef.current?.querySelectorAll<HTMLElement>(".category-admin-node[data-category-id]").forEach((item) => {
      const row = item.querySelector<HTMLElement>(":scope > .category-admin-row");
      if (row) positions.set(Number(item.dataset.categoryId), row.getBoundingClientRect());
    });
    beforeMoveRef.current = positions;
  }

  /** 기존 API의 전체 경로 생성 계약으로 빈 분류도 등록한다. */
  async function create(parent: CategoryNode | null, child: string) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(""); setMessage("");
    try { await auth.adminWrite("POST", "/api/v1/admin/categories", { path: parent ? `${parent.path}/${child}` : child });
      setMessage("분류를 추가했습니다.");
      try { setNodes(parseCategories(await auth.adminRead("/api/v1/admin/categories"))); }
      catch { setMessage("분류를 추가했지만 목록을 다시 확인하지 못했습니다. 새로고침해 확인해 주세요."); } }
    catch (failure) { setError(apiFailureMessage(failure)); throw failure; }
    finally { busyRef.current = false; setBusy(false); }
  }

  /** 하위 분류와 글 이동은 서버 트랜잭션이 수행한 후에 트리를 다시 읽는다. */
  async function remove(node: CategoryNode) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(""); setMessage("");
    try { await auth.adminWrite("DELETE", `/api/v1/admin/categories/${node.id}`);
      setMessage("분류를 삭제하고 글을 상위 분류로 옮겼습니다.");
      try { setNodes(parseCategories(await auth.adminRead("/api/v1/admin/categories"))); }
      catch { setMessage("분류를 삭제했지만 목록을 다시 확인하지 못했습니다. 새로고침해 확인해 주세요."); } }
    catch (failure) { setError(apiFailureMessage(failure)); throw failure; }
    finally { busyRef.current = false; setBusy(false); }
  }

  /** {@link move}에서 같은 부모의 대상 위치만 찾아 삽입 순서를 계산한다. */
  function reordered(siblings: CategoryNode[], id: number, targetId: number, side: DropSide): CategoryNode[] {
    const moving = siblings.find((item) => item.id === id);
    if (!moving) return siblings;
    const without = siblings.filter((item) => item.id !== id);
    const targetIndex = without.findIndex((item) => item.id === targetId);
    if (targetIndex < 0) return siblings;
    const result = [...without];
    result.splice(targetIndex + (side === "after" ? 1 : 0), 0, moving);
    return result;
  }

  /** {@link CategoryRow}의 이동을 낙관적으로 표시하고 서버 전체 형제 순서로 확정한다. */
  async function move(id: number, parentId: number | null, targetId: number, side: DropSide) {
    if (busyRef.current || id === targetId) return;
    const current = siblingsOf(nodes, parentId);
    if (!current) return;
    const next = reordered(current, id, targetId, side);
    if (next === current || next.every((item, index) => item.id === current[index].id)) return;
    if (document.activeElement instanceof HTMLElement &&
      document.activeElement.closest(".category-admin-row")?.parentElement?.dataset.categoryId === String(id)) {
      restoreFocusRef.current = id;
    }
    busyRef.current = true; setBusy(true); setError(""); setMessage("");
    rememberPositions();
    setNodes(replaceSiblings(nodes, parentId, next));
    setFlashId(id);
    try {
      await auth.adminWrite("PUT", "/api/v1/admin/categories/order", {
        parentId, categoryIds: next.map((item) => item.id)
      });
      setMessage("분류 순서를 저장했습니다.");
      try { setNodes(parseCategories(await auth.adminRead("/api/v1/admin/categories"))); }
      catch { setMessage("분류 순서는 저장했지만 다시 확인하지 못했습니다. 새로고침해 확인해 주세요."); }
    } catch (failure) {
      rememberPositions();
      setNodes(nodes);
      setFlashId(null);
      setError(failure instanceof ApiFailure && failure.status === 409
        ? "다른 변경으로 분류 구성이 달라졌습니다. 다시 조회한 뒤 순서를 옮겨 주세요."
        : apiFailureMessage(failure));
    } finally { busyRef.current = false; setBusy(false); }
  }

  /** {@link CategoryRow} 손잡이의 드래그 시작 시 내부 항목만 식별하는 미리보기를 만든다. */
  function startDrag(event: DragEvent<HTMLButtonElement>, node: CategoryNode, parentId: number | null) {
    if (busyRef.current) { event.preventDefault(); return; }
    draggedRef.current = { id: node.id, parentId, name: node.name };
    setDraggingId(node.id);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-ken-category-order", String(node.id));
    event.dataTransfer.setData("text/plain", node.name);
    const ghost = document.createElement("div");
    ghost.className = "category-order-ghost";
    ghost.textContent = `⠿  ${node.name}`;
    document.body.appendChild(ghost);
    event.dataTransfer.setDragImage(ghost, 16, 16);
    ghostRef.current = ghost;
    window.setTimeout(() => { if (ghostRef.current === ghost) ghost.style.left = "-10000px"; }, 0);
  }

  /** {@link startDrag}에서 만든 내부 드래그 상태와 미리보기를 정리한다. */
  function endDrag() {
    draggedRef.current = null;
    setDraggingId(null); setDrop(null);
    ghostRef.current?.remove();
    ghostRef.current = null;
  }

  /** {@link CategoryRow} 위쪽·아래쪽 절반을 같은 부모의 삽입 후보로 표시한다. */
  function dragOver(event: DragEvent<HTMLDivElement>, node: CategoryNode, parentId: number | null) {
    const dragged = draggedRef.current;
    if (!dragged || busyRef.current) return;
    if (dragged.parentId !== parentId) { event.stopPropagation(); setDrop(null); return; }
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    const bounds = event.currentTarget.getBoundingClientRect();
    const side = event.clientY < bounds.top + bounds.height / 2 ? "before" : "after";
    setDrop((previous) => previous?.id === node.id && previous.parentId === parentId && previous.side === side
      ? previous : { id: node.id, parentId, side });
  }

  /** {@link dragOver}가 표시한 형제 위치에만 내부 항목을 놓는다. */
  function dropOn(event: DragEvent<HTMLDivElement>, node: CategoryNode, parentId: number | null) {
    const dragged = draggedRef.current;
    if (!dragged) return;
    if (dragged.parentId !== parentId) { event.preventDefault(); event.stopPropagation(); endDrag(); return; }
    event.preventDefault();
    event.stopPropagation();
    const bounds = event.currentTarget.getBoundingClientRect();
    const side = event.clientY < bounds.top + bounds.height / 2 ? "before" : "after";
    endDrag();
    void move(dragged.id, parentId, node.id, side);
  }

  const rowProps = { busy, draggingId, drop, flashId, onCreate: create, onRemove: remove, onMove: move,
    onDragStart: startDrag, onDragOver: dragOver, onDrop: dropOn, onDragEnd: endDrag };

  return <><div className="admin-heading"><h1>분류 관리</h1></div>{error && <p role="alert" className="inline-error">{error}
    <button type="button" disabled={busy} onClick={() => setReload((value) => value + 1)}>다시 조회</button></p>}
    {message && <p role="status">{message}</p>}
    <div className="category-admin card" ref={treeRef}
      onDragOver={(event) => {
        if (!draggedRef.current) return;
        const row = event.target instanceof Element ? event.target.closest(".category-admin-row") : null;
        if (!row || !treeRef.current?.contains(row)) setDrop(null);
      }}
      onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDrop(null); }}>
      <ul data-category-parent="root">{nodes.map((node, index) =>
      <CategoryRow key={node.id} node={node} siblings={nodes} index={index} parentId={null} ancestors={[]} {...rowProps} />)}</ul>
      {adding ? <form className="category-inline-form" onSubmit={(event) => { event.preventDefault(); void create(null, name.trim()).then(() => {
        setName(""); setAdding(false);
      }).catch(() => undefined); }}><input aria-label="새 대분류 이름" value={name} autoFocus disabled={busy}
        onChange={(event) => setName(event.target.value)} required /><button type="submit" disabled={busy}>추가</button>
        <button type="button" onClick={() => setAdding(false)}>취소</button></form> :
        <button type="button" className="category-add" disabled={busy} onClick={() => setAdding(true)}>+ 새 대분류</button>}
    </div></>;
}
