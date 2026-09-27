"use client";

import Image from "next/image";
import { useEffect, useState, type FormEvent } from "react";
import { ApiFailure, apiFailureMessage } from "@/lib/api";
import { publicImageUrl } from "@/lib/profile";
import { normalizeBadge, parseStackBadges, type StackBadge } from "@/lib/stack-badges";
import { useAuth } from "../auth-provider";

/** OCI 기반 기술 뱃지의 추가·수정·삭제와 실제 프로젝트 사용 건수를 관리한다. */
export function StackManager() {
  const auth = useAuth();
  const [items, setItems] = useState<StackBadge[]>([]);
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [deleting, setDeleting] = useState<number | null>(null);
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const badges = parseStackBadges(await auth.adminRead("/api/v1/admin/stack-badges", controller.signal));
        if (!controller.signal.aborted) { setItems(badges); setError(""); }
      } catch (failure) { if (!controller.signal.aborted) setError(apiFailureMessage(failure)); }
    })();
    return () => controller.abort();
  }, [auth.adminRead, reload]);

  useEffect(() => { if (page > 0 && page * 10 >= items.length)
    setPage(Math.max(0, Math.ceil(items.length / 10) - 1)); }, [items.length, page]);

  /** {@link normalizeBadge} 결과와 이름을 함께 보내 레지스트리에 추가한다. */
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim() || !file) { setError("뱃지 이름과 이미지를 입력해 주세요."); return; }
    setBusy(true); setError(""); setMessage("");
    try {
      const fields = new FormData(); fields.set("name", name.trim()); fields.set("file", await normalizeBadge(file));
      await auth.adminForm("POST", "/api/v1/admin/stack-badges", fields);
      setName(""); setFile(null); setMessage("뱃지를 추가했습니다."); setReload((value) => value + 1);
    } catch (failure) { setError(failure instanceof ApiFailure && failure.status === 409 ?
      "이미 등록된 기술 스택 이름입니다." : apiFailureMessage(failure)); }
    finally { setBusy(false); }
  }

  /** 선택한 행의 이름만 수정하고 프로젝트 연결은 서버에서 유지한다. */
  async function rename(id: number) {
    if (!editName.trim()) { setError("뱃지 이름을 입력해 주세요."); return; }
    setBusy(true); setError("");
    try { await auth.adminWrite("PUT", `/api/v1/admin/stack-badges/${id}`, { name: editName.trim() });
      setEditing(null); setReload((value) => value + 1); }
    catch (failure) { setError(failure instanceof ApiFailure && failure.status === 409 ?
      "이미 등록된 기술 스택 이름입니다." : apiFailureMessage(failure)); }
    finally { setBusy(false); }
  }

  /** 이미지 교체는 서버 응답 후 목록 이미지를 새로 읽는다. */
  async function replaceImage(id: number, selected: File | null) {
    if (!selected) return;
    setBusy(true); setError("");
    try { const fields = new FormData(); fields.set("file", await normalizeBadge(selected));
      await auth.adminForm("POST", `/api/v1/admin/stack-badges/${id}/image`, fields); setReload((value) => value + 1); }
    catch (failure) { setError(apiFailureMessage(failure)); }
    finally { setBusy(false); }
  }

  /** 확인한 뱃지를 삭제한 뒤 프로젝트 참조 해제 결과를 새 목록으로 확인한다. */
  async function remove(id: number) {
    setBusy(true); setError("");
    try { await auth.adminWrite("DELETE", `/api/v1/admin/stack-badges/${id}`); setDeleting(null);
      setReload((value) => value + 1); }
    catch (failure) { setError(apiFailureMessage(failure)); }
    finally { setBusy(false); }
  }

  const rows = items.slice(page * 10, page * 10 + 10);
  return <><div className="admin-heading"><h1>기술 스택</h1><span>{items.length}개</span></div>
    <form className="stack-create card" onSubmit={(event) => void create(event)}>
      <label>이미지 · 64 × 64<input type="file" accept="image/*" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label>
      <label>이름<input value={name} onChange={(event) => setName(event.target.value)} placeholder="예: Spring Boot" /></label>
      <button type="submit" className="primary-button" disabled={busy}>뱃지 추가</button>
    </form>
    {error && <p role="alert" className="inline-error">{error} <button type="button" onClick={() => setReload((value) => value + 1)}>다시 조회</button></p>}
    {message && <p role="status">{message}</p>}
    <div className="admin-table-wrap card"><table className="admin-table"><thead><tr><th>뱃지</th><th>사용</th><th>관리</th></tr></thead><tbody>
      {rows.map((item) => <tr key={item.id}><td><div className="stack-cell">{publicImageUrl(item.imageUrl) && <Image
        src={publicImageUrl(item.imageUrl)!} alt="" width={36} height={36} unoptimized />}{editing === item.id ?
        <input aria-label={`${item.name} 이름 수정`} value={editName} onChange={(event) => setEditName(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void rename(item.id); }
            if (event.key === "Escape") setEditing(null); }} /> : item.name}</div></td>
        <td>{item.projectCount === null ? "—" : item.projectCount ? `프로젝트 ${item.projectCount}개` : "사용 안 함"}</td>
        <td className="admin-row-actions">{editing === item.id ? <><button type="button" onClick={() => setEditing(null)}>취소</button>
          <button type="button" onClick={() => void rename(item.id)} disabled={busy}>저장</button></> : deleting === item.id ? <>
          <span>{item.projectCount ? `${item.projectCount}개에서 빠집니다` : "삭제할까요?"}</span>
          <button type="button" onClick={() => setDeleting(null)}>취소</button><button type="button" className="danger-text" disabled={busy}
            onClick={() => void remove(item.id)}>삭제</button></> : <>
          <label className="file-button">이미지 교체<input type="file" accept="image/*" onChange={(event) => void replaceImage(item.id, event.target.files?.[0] ?? null)} /></label>
          <button type="button" onClick={() => { setEditing(item.id); setEditName(item.name); }}>이름 수정</button>
          <button type="button" onClick={() => setDeleting(item.id)}>삭제</button></>}</td></tr>)}
    </tbody></table>{!items.length && <p className="message-card">등록된 뱃지가 없습니다.</p>}</div>
    {items.length > 10 && <nav className="number-pager" aria-label="기술 스택 페이지">
      {Array.from({ length: Math.ceil(items.length / 10) }, (_, index) => <button key={index} type="button"
        aria-current={page === index ? "page" : undefined} onClick={() => setPage(index)}>{index + 1}</button>)}</nav>}
  </>;
}
