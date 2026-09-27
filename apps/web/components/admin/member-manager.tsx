"use client";

import { useEffect, useState, type FormEvent } from "react";
import { ApiFailure, apiFailureMessage } from "@/lib/api";
import { useAuth } from "../auth-provider";

type Member = { id: number; displayName: string; username: string; role: "USER" | "ADMIN";
  createdAt: string; invitationStatus: string; self: boolean };
type MemberPage = { items: Member[]; page: number; size: number; totalElements: number };
type IssuedInvite = { displayName: string; username: string; url: string };

/** 관리자 회원 페이지에서 예상한 최소 계정 필드를 확인한다. */
function parseMembers(value: unknown): MemberPage {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ApiFailure("response");
  const page = value as Record<string, unknown>;
  if (!Array.isArray(page.items) || !Number.isSafeInteger(page.page) || !Number.isSafeInteger(page.totalElements)) throw new ApiFailure("response");
  const items = page.items.map((entry) => {
    if (!entry || typeof entry !== "object") throw new ApiFailure("response");
    const item = entry as Record<string, unknown>;
    if (!Number.isSafeInteger(item.id) || typeof item.displayName !== "string" || typeof item.username !== "string" ||
      (item.role !== "USER" && item.role !== "ADMIN") || typeof item.createdAt !== "string" ||
      typeof item.invitationStatus !== "string" || typeof item.self !== "boolean") throw new ApiFailure("response");
    return item as Member;
  });
  return { items, page: page.page as number, size: page.size as number, totalElements: page.totalElements as number };
}

/** 한 번만 돌아오는 초대 URL이 GitHub Pages와 fragment 토큰을 가리키는지 확인한다. */
function parseIssuedInvite(value: unknown): IssuedInvite {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ApiFailure("response");
  const result = value as Record<string, unknown>;
  if (typeof result.inviteUrl !== "string" || !result.member || typeof result.member !== "object" ||
    Array.isArray(result.member)) throw new ApiFailure("response");
  const member = result.member as Record<string, unknown>;
  let url: URL;
  try { url = new URL(result.inviteUrl); } catch { throw new ApiFailure("response"); }
  if (url.origin !== "https://gjaku1031.github.io" || url.pathname !== "/ken-blog/invite/" || url.search ||
    !/^#token=[A-Za-z0-9_-]{43}$/.test(url.hash) || typeof member.displayName !== "string" ||
    typeof member.username !== "string") throw new ApiFailure("response");
  return { displayName: member.displayName, username: member.username, url: url.toString() };
}

/** 발급한 계정과 한 번만 반환되는 링크를 이 화면에서만 표시한다. */
export function MemberManager() {
  const auth = useAuth();
  const [page, setPage] = useState(0);
  const [data, setData] = useState<MemberPage | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ displayName: "", username: "", role: "USER" as "USER" | "ADMIN" });
  const [deleting, setDeleting] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [invites, setInvites] = useState<IssuedInvite[]>([]);
  const [copyMessage, setCopyMessage] = useState("");
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

  /** 일회용 링크가 포함된 201 응답에서만 계정 발급을 성공으로 표시한다. */
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.displayName.trim() || form.displayName.trim().length > 100 || !/^[a-z][a-z0-9_-]{2,63}$/.test(form.username)) {
      setError("이름과 3~64자의 영문 소문자 계정명을 입력해 주세요."); return;
    }
    setBusy(true); setError(""); setMessage("");
    try {
      const issued = parseIssuedInvite(await auth.adminWrite("POST", "/api/v1/admin/members",
        { ...form, displayName: form.displayName.trim(), username: form.username.trim() }));
      setInvites((current) => [...current, issued]);
      setMessage(`${issued.displayName} 계정을 발급했습니다. 초대 링크를 지금 복사해 전달해 주세요.`);
      setOpen(false); setForm({ displayName: "", username: "", role: "USER" });
      setPage(0); setRetry((value) => value + 1);
    } catch (failure) {
      setError(failure instanceof ApiFailure && failure.status === 503 ?
        "초대 링크 주소 설정을 확인해 주세요. 계정은 발급되지 않았습니다." : apiFailureMessage(failure));
    } finally { setBusy(false); }
  }

  /** 발급 직후 메모리에만 있는 일회용 URL을 클립보드로 복사한다. */
  async function copyInvite(invite: IssuedInvite) {
    try { await navigator.clipboard.writeText(invite.url); setCopyMessage(`${invite.displayName} 초대 링크를 복사했습니다.`); }
    catch { setCopyMessage("자동 복사할 수 없습니다. 링크 입력칸을 선택해 직접 복사해 주세요."); }
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
      <label>이름<input value={form.displayName} required maxLength={100}
        onChange={(event) => setForm((current) => ({ ...current, displayName: event.target.value }))} /></label>
      <label>계정명<input value={form.username} required maxLength={64} pattern="[a-z][a-z0-9_-]{2,63}"
        autoComplete="off" onChange={(event) => setForm((current) => ({ ...current, username: event.target.value }))} /></label>
      <label>역할<select value={form.role} onChange={(event) => setForm((current) => ({ ...current, role: event.target.value as typeof current.role }))}>
        <option value="USER">열람자</option><option value="ADMIN">관리자</option></select></label>
      <button type="button" className="small-button" onClick={() => setOpen(false)}>취소</button>
      <button type="submit" className="primary-button" disabled={busy}>계정 발급·초대 링크 만들기</button>
    </form>}
    {error && <p role="alert" className="inline-error">{error} <button type="button" onClick={() => setRetry((value) => value + 1)}>다시 조회</button></p>}
    {message && <p role="status">{message}</p>}
    {invites.length > 0 && <section className="issued-invites card" aria-label="이번 화면에서 발급한 초대 링크">
      <h2>초대 링크</h2><p>이 링크는 화면을 떠나면 다시 확인할 수 없습니다. 필요한 링크를 지금 복사해 주세요.</p>
      {invites.map((invite) => <div className="issued-invite" key={invite.url}><label>{invite.displayName} · {invite.username}
        <input type="text" readOnly value={invite.url} onFocus={(event) => event.target.select()} /></label>
        <button type="button" className="small-button" onClick={() => void copyInvite(invite)}>링크 복사</button></div>)}
      {copyMessage && <p role="status">{copyMessage}</p>}</section>}
    <div className="admin-table-wrap card"><table className="admin-table"><thead><tr><th>이름</th><th>계정명</th><th>역할</th><th>발급일</th><th>관리</th></tr></thead><tbody>
      {data?.items.map((item) => <tr key={item.id}><td>{item.displayName}</td><td className="mono">{item.username}</td>
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
