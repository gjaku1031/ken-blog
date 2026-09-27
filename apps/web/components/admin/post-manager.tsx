"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ApiFailure, apiFailureMessage } from "@/lib/api";
import { readPinnedIds } from "@/lib/feed";
import { useAuth } from "../auth-provider";

type AdminRow = { id: number; title: string; slug: string; status: "DRAFT" | "PUBLISHED";
  visibility: "PUBLIC" | "PRIVATE"; section: "TECH" | "PROJECT_HOME" | "PROJECT_DOC" | "NOTE_CHAPTER";
  projectId: number | null; courseId: number | null; category: { path: string } | null;
  publishedAt: string | null; updatedAt: string; summary: string | null; viewCount: number | null; pinOrder: number | null };

/** 관리자 전체 글의 공통 열만 확인하고 섹션별 소속을 안전하게 읽는다. */
function parseRows(value: unknown): { items: AdminRow[]; totalPages: number } {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ApiFailure("response");
  const page = value as Record<string, unknown>;
  if (!Array.isArray(page.items) || !Number.isSafeInteger(page.totalPages)) throw new ApiFailure("response");
  return { totalPages: page.totalPages as number, items: page.items.map((entry) => {
    if (!entry || typeof entry !== "object") throw new ApiFailure("response");
    const item = entry as Record<string, unknown>;
    if (!Number.isSafeInteger(item.id) || typeof item.title !== "string" || typeof item.slug !== "string" ||
      (item.status !== "DRAFT" && item.status !== "PUBLISHED") ||
      (item.visibility !== "PUBLIC" && item.visibility !== "PRIVATE") ||
      !["TECH", "PROJECT_HOME", "PROJECT_DOC", "NOTE_CHAPTER"].includes(String(item.section)) ||
      typeof item.updatedAt !== "string") throw new ApiFailure("response");
    return { id: item.id as number, title: item.title, slug: item.slug, status: item.status,
      visibility: item.visibility, section: item.section as AdminRow["section"],
      projectId: item.projectId as number | null ?? null, courseId: item.courseId as number | null ?? null,
      category: item.category as { path: string } | null ?? null,
      publishedAt: item.publishedAt as string | null ?? null, updatedAt: item.updatedAt,
      summary: item.summary as string | null ?? null, viewCount: item.viewCount as number | null ?? null,
      pinOrder: item.pinOrder as number | null ?? null };
  }) };
}

/** 관리 필터가 모든 페이지의 실제 행을 기준으로 동작하도록 목록을 끝까지 읽는다. */
async function readRows(adminRead: (path: string, signal?: AbortSignal) => Promise<unknown>, signal: AbortSignal): Promise<AdminRow[]> {
  const rows: AdminRow[] = [];
  let page = 0; let totalPages = 1;
  do { const result = parseRows(await adminRead(`/api/v1/admin/posts?page=${page}&size=100`, signal));
    rows.push(...result.items); totalPages = result.totalPages; page += 1;
  } while (page < totalPages);
  return rows;
}

/** 전체 글의 권한·섹션 필터, 핀, 편집본 이동, 실제 삭제 API를 관리한다. */
export function PostManager() {
  const auth = useAuth();
  const [rows, setRows] = useState<AdminRow[]>([]);
  const [filter, setFilter] = useState<"ALL" | "PUBLIC" | "PRIVATE">("ALL");
  const [page, setPage] = useState(0);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    void readRows(auth.adminRead, controller.signal).then((result) => {
      if (!controller.signal.aborted) { setRows(result); setLoading(false); }
    }).catch((failure) => { if (!controller.signal.aborted) { setError(apiFailureMessage(failure)); setLoading(false); } });
    return () => controller.abort();
  }, [auth.adminRead, retry]);

  const filtered = useMemo(() => rows.filter((item) => filter === "ALL" || item.visibility === filter), [rows, filter]);
  const visible = filtered.slice(page * 10, page * 10 + 10);
  const totalPages = Math.ceil(filtered.length / 10);
  const pageNumbers = Array.from({ length: Math.min(7, totalPages) }, (_, index) =>
    Math.max(0, Math.min(page - 3, totalPages - Math.min(7, totalPages))) + index);

  useEffect(() => {
    if (page > 0 && page >= totalPages) setPage(Math.max(0, totalPages - 1));
  }, [page, totalPages]);

  /** 모든 출간 글의 공개 범위를 {@link AdminRow} 소속에 관계없이 갱신한다. */
  async function visibility(item: AdminRow) {
    setBusy(item.id); setError("");
    try { await auth.adminWrite("PATCH", `/api/v1/admin/content/${item.id}/visibility`, {
      visibility: item.visibility === "PUBLIC" ? "PRIVATE" : "PUBLIC" }); setRetry((value) => value + 1); }
    catch (failure) { setError(apiFailureMessage(failure)); }
    finally { setBusy(null); }
  }

  /** Tech·Notes의 실제 핀 목록을 변경하고 새 관리 목록을 읽는다. */
  async function pin(item: AdminRow) {
    setBusy(item.id); setError("");
    try { const credentials = await auth.readCredentials(); const ids = await readPinnedIds(credentials);
      const index = ids.indexOf(item.id); if (index < 0) ids.push(item.id); else ids.splice(index, 1);
      await auth.adminWrite("PUT", "/api/v1/admin/pins", { postIds: ids }); setRetry((value) => value + 1); }
    catch (failure) { setError(apiFailureMessage(failure)); }
    finally { setBusy(null); }
  }

  /** 소속별 삭제 경로를 선택해 부모 관계를 우회하지 않는다. */
  async function remove(item: AdminRow) {
    const path = item.section === "TECH" ? `/api/v1/admin/posts/${item.id}` :
      item.section === "PROJECT_HOME" && item.projectId ? `/api/v1/admin/projects/${item.projectId}` :
        item.section === "PROJECT_DOC" && item.projectId ? `/api/v1/admin/projects/${item.projectId}/documents/${item.id}` :
          item.section === "NOTE_CHAPTER" && item.courseId ? `/api/v1/admin/courses/${item.courseId}/chapters/${item.id}` : null;
    if (!path) { setError("글의 소속 정보를 확인할 수 없습니다."); return; }
    setBusy(item.id); setError("");
    try { await auth.adminWrite("DELETE", path); setDeleting(null); setMessage("글을 삭제했습니다.");
      setRetry((value) => value + 1); }
    catch (failure) { setError(apiFailureMessage(failure)); }
    finally { setBusy(null); }
  }

  return <><div className="admin-heading"><h1>글 관리</h1><Link className="primary-button" href="/write/">새 글 작성</Link></div>
    <nav className="admin-filter" aria-label="공개 범위 필터">{(["ALL", "PUBLIC", "PRIVATE"] as const).map((value) =>
      <button key={value} type="button" aria-pressed={filter === value} onClick={() => { setFilter(value); setPage(0); }}>
        {{ ALL: "전체", PUBLIC: "공개", PRIVATE: "비공개" }[value]} {value === "ALL" ? rows.length : rows.filter((item) => item.visibility === value).length}</button>)}
      <Link href="/admin/drafts/">임시저장</Link></nav>
    {loading && <p role="status">글을 불러오고 있습니다…</p>}
    {error && <p role="alert" className="inline-error">{error} <button type="button" onClick={() => setRetry((value) => value + 1)}>다시 조회</button></p>}
    {message && <p role="status">{message}</p>}
    <div className="admin-table-wrap card"><table className="admin-table post-admin-table"><thead><tr>
      <th>제목</th><th>섹션</th><th>공개</th><th>날짜</th><th>조회</th><th>관리</th></tr></thead><tbody>
      {visible.map((item) => <tr key={item.id}><td><strong>{item.title}</strong><small>{item.category?.path ??
        (item.section === "PROJECT_DOC" ? "프로젝트 문서" : item.section === "NOTE_CHAPTER" ? "Notes 회차" : "")}</small></td>
        <td>{item.section === "TECH" ? "Tech" : item.section === "NOTE_CHAPTER" ? "Notes" : "Projects"}</td>
        <td>{item.status === "PUBLISHED" ? <button type="button" role="switch" aria-checked={item.visibility === "PUBLIC"}
          className="visibility-toggle" disabled={busy !== null} aria-label={`${item.title} 전체 공개`}
          onClick={() => void visibility(item)}>{item.visibility === "PUBLIC" ? "공개" : "비공개"}</button> : "미출간"}</td>
        <td className="mono">{(item.publishedAt ?? item.updatedAt).slice(0, 10)}</td><td>{item.viewCount?.toLocaleString("ko-KR") ?? "—"}</td>
        <td className="admin-row-actions">{deleting === item.id ? <>삭제할까요? <button type="button" onClick={() => setDeleting(null)}>취소</button>
          <button type="button" className="danger-text" disabled={busy !== null} onClick={() => void remove(item)}>삭제</button></> : <>
          {(item.section === "TECH" || item.section === "NOTE_CHAPTER") && item.status === "PUBLISHED" &&
            <button type="button" disabled={busy !== null} onClick={() => void pin(item)}>{item.pinOrder == null ? "핀 고정" : "핀 해제"}</button>}
          <Link href={`/write/?postId=${item.id}`}>수정</Link><button type="button" onClick={() => setDeleting(item.id)}>삭제</button></>}</td></tr>)}
    </tbody></table>{!loading && !filtered.length && <p className="message-card">해당하는 글이 없습니다.</p>}</div>
    {filtered.length > 10 && <nav className="number-pager" aria-label="글 관리 페이지">
      <span className="pager-count">총 {filtered.length}편 · {page * 10 + 1}–{Math.min((page + 1) * 10, filtered.length)}</span>
      <button type="button" disabled={page === 0} onClick={() => setPage((current) => current - 1)}>이전</button>
      {pageNumbers.map((index) => <button key={index} type="button"
        aria-current={page === index ? "page" : undefined} onClick={() => setPage(index)}>{index + 1}</button>)}
      <button type="button" disabled={page + 1 >= totalPages} onClick={() => setPage((current) => current + 1)}>다음</button></nav>}
  </>;
}
