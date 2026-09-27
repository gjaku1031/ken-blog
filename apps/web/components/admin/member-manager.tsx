"use client";

import { useEffect, useState, type FormEvent } from "react";
import { ApiFailure, apiFailureMessage } from "@/lib/api";
import { useAuth } from "../auth-provider";

type Member = { id: number; name: string; email: string; role: "USER" | "ADMIN";
  createdAt: string; invitationStatus: string; self: boolean };
type MemberPage = { items: Member[]; page: number; size: number; totalElements: number };

/** 관리자 회원 페이지에서 예상한 최소 계정 필드를 확인한다. */
function parseMembers(value: unknown): MemberPage {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ApiFailure("response");
  const page = value as Record<string, unknown>;
  if (!Array.isArray(page.items) || !Number.isSafeInteger(page.page) || !Number.isSafeInteger(page.totalElements)) throw new ApiFailure("response");
  const items = page.items.map((entry) => {
    if (!entry || typeof entry !== "object") throw new ApiFailure("response");
    const item = entry as Record<string, unknown>;
    if (!Number.isSafeInteger(item.id) || typeof item.name !== "string" || typeof item.email !== "string" ||
      (item.role !== "USER" && item.role !== "ADMIN") || typeof item.createdAt !== "string" ||
      typeof item.invitationStatus !== "string" || typeof item.self !== "boolean") throw new ApiFailure("response");
    return item as Member;
  });
  return { items, page: page.page as number, size: page.size as number, totalElements: page.totalElements as number };
}

/** 실제 메일 전송 성공 때만 새 회원 발급을 성공으로 표시한다. */
export function MemberManager() {
  const auth = useAuth();
  const [page, setPage] = useState(0);
  const [data, setData] = useState<MemberPage | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", role: "USER" as "USER" | "ADMIN" });
  const [deleting, setDeleting] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try { const result = parseMembers(await auth.adminRead(`/api/v1/admin/members?page=${page}&size=10`, controller.signal));
        if (!controller.signal.aborted) { setData(result); setError(""); } }
      catch (failure) { if (!controller.signal.aborted) { setError(apiFailureMessage(failure)); setData(null); } }
    })();
    return () => controller.abort();
  }, [auth.adminRead, page, retry]);

  /** 계정 발급과 초대 메일이 함께 확정된 201 결과에서만 성공을 알린다. */
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.name.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      setError("이름과 올바른 이메일을 입력해 주세요."); return;
    }
    setBusy(true); setError(""); setMessage("");
    try {
      await auth.adminWrite("POST", "/api/v1/admin/members", { ...form, name: form.name.trim(), email: form.email.trim() });
      setMessage(`${form.name.trim()} 계정을 발급하고 초대 메일을 보냈습니다.`);
      setOpen(false); setForm({ name: "", email: "", role: "USER" });
      setPage(Math.floor((data?.totalElements ?? 0) / 10)); setRetry((value) => value + 1);
    } catch (failure) {
      setError(failure instanceof ApiFailure && failure.status === 503 ?
        "메일 발송 설정 또는 전송을 확인해 주세요. 계정 발급은 완료되지 않았습니다." : apiFailureMessage(failure));
    } finally { setBusy(false); }
  }

  /** 현재 계정은 삭제 버튼을 제공하지 않고 확인한 다른 계정만 삭제한다. */
  async function remove(id: number) {
    setBusy(true); setError(""); setMessage("");
    try { await auth.adminWrite("DELETE", `/api/v1/admin/members/${id}`); setDeleting(null);
      setMessage("계정을 삭제했습니다.");
      if (data && data.items.length === 1 && page > 0) setPage((current) => current - 1);
      else setRetry((value) => value + 1); }
    catch (failure) { setError(apiFailureMessage(failure)); }
    finally { setBusy(false); }
  }

  return <><div className="admin-heading"><h1>회원 관리</h1><span>{data?.totalElements ?? "—"}명</span>
    <button type="button" className="primary-button" onClick={() => setOpen((value) => !value)}>{open ? "닫기" : "+ 계정 발급"}</button></div>
    {open && <form className="member-create card" onSubmit={(event) => void create(event)}>
      <label>이름<input value={form.name} required onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} /></label>
      <label>이메일<input type="email" value={form.email} required onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} /></label>
      <label>역할<select value={form.role} onChange={(event) => setForm((current) => ({ ...current, role: event.target.value as typeof current.role }))}>
        <option value="USER">열람자</option><option value="ADMIN">관리자</option></select></label>
      <button type="button" className="small-button" onClick={() => setOpen(false)}>취소</button>
      <button type="submit" className="primary-button" disabled={busy}>발급하고 초대 메일 보내기</button>
    </form>}
    {error && <p role="alert" className="inline-error">{error} <button type="button" onClick={() => setRetry((value) => value + 1)}>다시 조회</button></p>}
    {message && <p role="status">{message}</p>}
    <div className="admin-table-wrap card"><table className="admin-table"><thead><tr><th>이름</th><th>이메일</th><th>역할</th><th>발급일</th><th>관리</th></tr></thead><tbody>
      {data?.items.map((item) => <tr key={item.id}><td>{item.name}</td><td className="mono">{item.email}</td>
        <td>{item.role === "ADMIN" ? "관리자" : "열람자"}</td><td>{item.createdAt.slice(0, 10)}</td>
        <td>{!item.self && (deleting === item.id ? <span className="admin-row-actions">계정을 삭제할까요?
          <button type="button" onClick={() => setDeleting(null)}>취소</button><button type="button" className="danger-text" disabled={busy}
            onClick={() => void remove(item.id)}>삭제</button></span> : <button type="button" onClick={() => setDeleting(item.id)}>삭제</button>)}</td></tr>)}
    </tbody></table>{data?.items.length === 0 && <p className="message-card">발급된 회원이 없습니다.</p>}</div>
    {data && data.totalElements > 10 && <nav className="number-pager" aria-label="회원 페이지">
      {Array.from({ length: Math.ceil(data.totalElements / 10) }, (_, index) => <button type="button" key={index}
        aria-current={page === index ? "page" : undefined} onClick={() => setPage(index)}>{index + 1}</button>)}</nav>}
  </>;
}
