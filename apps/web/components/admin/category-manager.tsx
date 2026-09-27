"use client";

import { useEffect, useState, type FormEvent } from "react";
import { apiFailureMessage, type CategoryNode, parseCategories } from "@/lib/api";
import { useAuth } from "../auth-provider";

/** 선택한 부모 경로 아래에 만들 분류의 깊이별 이름을 표시한다. */
function childLabel(depth: number): string { return ["대분류", "중분류", "소분류"][depth] ?? "분류"; }

/** 트리 행에서 신규 하위 분류와 부모 이동 삭제 확인을 처리한다. */
function CategoryRow({ node, onCreate, onRemove }: { node: CategoryNode;
  onCreate: (parent: CategoryNode | null, name: string) => Promise<void>; onRemove: (node: CategoryNode) => Promise<void> }) {
  const [expanded, setExpanded] = useState(true);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [deleting, setDeleting] = useState(false);

  /** 현재 node의 경로에 이름 한 단계만 추가한다. */
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) return;
    try { await onCreate(node, name.trim()); setName(""); setAdding(false); setExpanded(true); }
    catch { /* 오류는 상위 경고 영역에 표시한다. */ }
  }

  return <li className="category-admin-node"><div className="category-admin-row">
    {node.children.length ? <button type="button" aria-label={expanded ? `${node.name} 접기` : `${node.name} 펼치기`}
      aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>{expanded ? "▾" : "▸"}</button> : <span className="category-indent" />}
    <span>{node.name}</span><span className="mono">{node.totalCount}</span>
    <button type="button" className="danger-text" aria-label={`${node.path} 분류 삭제`} onClick={() => setDeleting(true)}>삭제</button></div>
    {deleting && <div className="inline-confirm" role="alertdialog" aria-label="분류 삭제 확인"><p>“{node.path.replaceAll("/", " › ")}” 분류를 삭제합니다.
      {node.totalCount > 0 && <> 글 {node.totalCount}개는 상위 분류로 이동합니다.</>}
      {node.children.length > 0 && <> 하위 분류 {node.children.length}개도 삭제됩니다.</>}</p>
      <button type="button" className="small-button" onClick={() => setDeleting(false)}>취소</button>
      <button type="button" className="small-button danger-button" onClick={() => { void onRemove(node).then(() => setDeleting(false)).catch(() => undefined); }}>
        {node.totalCount > 0 ? "옮기고 삭제" : "삭제"}</button></div>}
    {expanded && node.children.length > 0 && <ul>{node.children.map((child) => <CategoryRow key={child.id} node={child}
      onCreate={onCreate} onRemove={onRemove} />)}</ul>}
    {expanded && node.depth < 3 && (adding ? <form className="category-inline-form" onSubmit={(event) => void create(event)}
      onKeyDown={(event) => { if (event.key === "Escape") { setAdding(false); setName(""); } }}>
      <input aria-label={`새 ${childLabel(node.depth)} 이름`} value={name} autoFocus onChange={(event) => setName(event.target.value)} />
      <button type="submit">추가</button><button type="button" onClick={() => setAdding(false)}>취소</button></form> :
      <button type="button" className="category-add" onClick={() => setAdding(true)}>+ 새 {childLabel(node.depth)}</button>)}
  </li>;
}

/** 저장된 빈 폴더까지 포함한 관리자 분류 트리를 조회·수정한다. */
export function CategoryManager() {
  const auth = useAuth();
  const [nodes, setNodes] = useState<CategoryNode[]>([]);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try { const result = parseCategories(await auth.adminRead("/api/v1/admin/categories", controller.signal));
        if (!controller.signal.aborted) { setNodes(result); setError(""); } }
      catch (failure) { if (!controller.signal.aborted) setError(apiFailureMessage(failure)); }
    })();
    return () => controller.abort();
  }, [auth.adminRead, reload]);

  /** 기존 API의 전체 경로 생성 계약으로 빈 분류도 등록한다. */
  async function create(parent: CategoryNode | null, child: string) {
    setError(""); setMessage("");
    try { await auth.adminWrite("POST", "/api/v1/admin/categories", { path: parent ? `${parent.path}/${child}` : child });
      setMessage("분류를 추가했습니다."); setReload((value) => value + 1); }
    catch (failure) { setError(apiFailureMessage(failure)); throw failure; }
  }

  /** 하위 분류와 글 이동은 서버 트랜잭션이 수행한 후에 트리를 다시 읽는다. */
  async function remove(node: CategoryNode) {
    setError(""); setMessage("");
    try { await auth.adminWrite("DELETE", `/api/v1/admin/categories/${node.id}`);
      setMessage("분류를 삭제하고 글을 상위 분류로 옮겼습니다."); setReload((value) => value + 1); }
    catch (failure) { setError(apiFailureMessage(failure)); throw failure; }
  }

  return <><h1>분류 관리</h1>{error && <p role="alert" className="inline-error">{error}
    <button type="button" onClick={() => setReload((value) => value + 1)}>다시 조회</button></p>}
    {message && <p role="status">{message}</p>}
    <div className="category-admin card"><ul>{nodes.map((node) => <CategoryRow key={node.id} node={node} onCreate={create} onRemove={remove} />)}</ul>
      {adding ? <form className="category-inline-form" onSubmit={(event) => { event.preventDefault(); void create(null, name.trim()).then(() => {
        setName(""); setAdding(false);
      }).catch(() => undefined); }}><input aria-label="새 대분류 이름" value={name} autoFocus
        onChange={(event) => setName(event.target.value)} required /><button type="submit">추가</button>
        <button type="button" onClick={() => setAdding(false)}>취소</button></form> :
        <button type="button" className="category-add" onClick={() => setAdding(true)}>+ 새 대분류</button>}
    </div></>;
}
