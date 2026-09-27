"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ApiFailure, apiFailureMessage, parseCategories, type CategoryNode } from "@/lib/api";
import { categoryLabelPath } from "@/lib/category-label";
import { readPinnedIds } from "@/lib/feed";
import { useAuth } from "../auth-provider";

type AdminRow = { id: number; title: string; slug: string; status: "DRAFT" | "PUBLISHED";
  visibility: "PUBLIC" | "PRIVATE"; section: "TECH" | "PROJECT_HOME" | "PROJECT_DOC" | "NOTE_CHAPTER";
  projectId: number | null; courseId: number | null; category: { id: number; path: string; name: string } | null;
  projectName: string | null; courseName: string | null; courseField: string | null;
  documentOrder: number | null; chapterOrder: number | null;
  publishedAt: string | null; updatedAt: string; summary: string | null; viewCount: number | null; pinOrder: number | null };

/** {@link AdminRow}의 관리 글 공통 열과 실제 프로젝트·과목 표시 필드를 검증해 읽는다. */
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
      category: item.category as AdminRow["category"] ?? null,
      projectName: typeof item.projectName === "string" ? item.projectName : null,
      courseName: typeof item.courseName === "string" ? item.courseName : null,
      courseField: typeof item.courseField === "string" ? item.courseField : null,
      documentOrder: Number.isSafeInteger(item.documentOrder) ? item.documentOrder as number : null,
      chapterOrder: Number.isSafeInteger(item.chapterOrder) ? item.chapterOrder as number : null,
      publishedAt: item.publishedAt as string | null ?? null, updatedAt: item.updatedAt,
      summary: item.summary as string | null ?? null, viewCount: item.viewCount as number | null ?? null,
      pinOrder: item.pinOrder as number | null ?? null };
  }) };
}

/** {@link PostManager}가 대문을 제외한 글 관리 전 페이지의 실제 행을 모으도록 읽는다. */
async function readRows(adminRead: (path: string, signal?: AbortSignal) => Promise<unknown>, signal: AbortSignal): Promise<AdminRow[]> {
  const rows: AdminRow[] = [];
  let page = 0; let totalPages = 1;
  do { const result = parseRows(await adminRead(`/api/v1/admin/posts?page=${page}&size=100`, signal));
    rows.push(...result.items.filter((item) => item.section !== "PROJECT_HOME")); totalPages = result.totalPages; page += 1;
  } while (page < totalPages);
  return rows;
}

/** {@link readRows} 결과로 전체 글 필터, 핀, 편집본 이동, 실제 삭제 API를 관리한다. */
export function PostManager() {
  const router = useRouter();
  const filterQuery = useSearchParams().get("filter");
  const auth = useAuth();
  const [rows, setRows] = useState<AdminRow[]>([]);
  const [categoryTree, setCategoryTree] = useState<CategoryNode[]>([]);
  const filter: "ALL" | "PUBLIC" | "PRIVATE" = filterQuery === "public" ? "PUBLIC" :
    filterQuery === "private" ? "PRIVATE" : "ALL";
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
    void Promise.allSettled([readRows(auth.adminRead, controller.signal),
      auth.adminRead("/api/v1/admin/categories", controller.signal)]).then(([postResult, categoryResult]) => {
      if (postResult.status === "rejected") throw postResult.reason;
      if (!controller.signal.aborted) {
        setRows(postResult.value);
        if (categoryResult.status === "fulfilled") setCategoryTree(parseCategories(categoryResult.value));
        setLoading(false);
      }
    }).catch((failure) => { if (!controller.signal.aborted) { setError(apiFailureMessage(failure)); setLoading(false); } });
    return () => controller.abort();
  }, [auth.adminRead, retry]);

  const filtered = useMemo(() => rows.filter((item) => filter === "ALL" || item.visibility === filter), [rows, filter]);
  const visible = filtered.slice(page * 10, page * 10 + 10);
  const totalPages = Math.ceil(filtered.length / 10);
  const pageNumbers = Array.from({ length: Math.min(7, totalPages) }, (_, index) =>
    Math.max(0, Math.min(page - 3, totalPages - Math.min(7, totalPages))) + index);
  /** {@link AdminRow}의 실제 분류·과목·프로젝트 이름과 순서를 표의 보조 줄로 표시한다. */
  const description = (item: AdminRow): string => item.section === "TECH" ?
    [item.category ? categoryLabelPath(categoryTree, item.category.id) ?? item.category.name : null,
      item.projectName].filter(Boolean).join(" · ") :
    item.section === "PROJECT_DOC" ? [item.projectName, item.documentOrder ? `문서 ${item.documentOrder}` : null].filter(Boolean).join(" · ") :
      [[item.courseField, item.courseName].filter(Boolean).join(" › ") || "Notes",
        item.chapterOrder ? `${item.chapterOrder}강` : null].filter(Boolean).join(" · ");

  useEffect(() => {
    if (page > 0 && page >= totalPages) setPage(Math.max(0, totalPages - 1));
  }, [page, totalPages]);

  useEffect(() => { setPage(0); }, [filter]);

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

  return <><div className="admin-heading with-filters"><h1>글 관리</h1>
    <nav className="admin-filter" aria-label="공개 범위 필터">{(["ALL", "PUBLIC", "PRIVATE"] as const).map((value) =>
      <button key={value} type="button" aria-pressed={filter === value} onClick={() => router.replace(value === "ALL" ?
        "/admin/posts/" : `/admin/posts/?filter=${value.toLowerCase()}`)}>
        {{ ALL: "전체", PUBLIC: "공개", PRIVATE: "나만 보기" }[value]}
        <span className="filter-count">{value === "ALL" ? rows.length : rows.filter((item) => item.visibility === value).length}</span></button>)}
      <Link href="/admin/drafts/">임시저장</Link></nav><Link className="primary-button" href="/write/">새 글 작성</Link></div>
    {loading && <p role="status">글을 불러오고 있습니다…</p>}
    {error && <p role="alert" className="inline-error">{error} <button type="button" onClick={() => setRetry((value) => value + 1)}>다시 조회</button></p>}
    {message && <p role="status">{message}</p>}
    <div className="admin-table-wrap card"><table className="admin-table post-admin-table"><colgroup><col /><col style={{ width: 84 }} />
      <col style={{ width: 112 }} /><col style={{ width: 108 }} /><col style={{ width: 72 }} />
      <col style={{ width: 184 }} /></colgroup><thead><tr>
      <th>제목</th><th>섹션</th><th>공개</th><th>날짜</th><th>조회</th><th>관리</th></tr></thead><tbody>
      {visible.map((item) => <tr key={item.id}><td><div className="post-title">{item.title}</div><small>{description(item)}</small></td>
        <td className="post-section">{item.section === "TECH" ? "Tech" : item.section === "NOTE_CHAPTER" ? "Notes" : "Projects"}</td>
        <td>{item.status === "PUBLISHED" ? <span className="post-visibility"><button type="button" role="switch" aria-checked={item.visibility === "PUBLIC"}
          className="visibility-toggle" disabled={busy !== null} aria-label={`${item.title} 전체 공개`}
          onClick={() => void visibility(item)} /><span>{item.visibility === "PUBLIC" ? "공개" : "나만 보기"}</span></span> : "미출간"}</td>
        <td className="post-date">{(item.publishedAt ?? item.updatedAt).slice(0, 10).replaceAll("-", ".")}</td>
        <td className="post-views">{item.viewCount?.toLocaleString("ko-KR") ?? "—"}</td>
        <td className="admin-row-actions">{deleting === item.id ? <>삭제할까요? <button type="button" onClick={() => setDeleting(null)}>취소</button>
          <button type="button" className="danger-text" disabled={busy !== null} onClick={() => void remove(item)}>삭제</button></> : <>
          {(item.section === "TECH" || item.section === "NOTE_CHAPTER" || item.section === "PROJECT_DOC") && item.status === "PUBLISHED" &&
            <button type="button" disabled={busy !== null} onClick={() => void pin(item)}>{item.pinOrder == null ? "핀 고정" : "핀 해제"}</button>}
          <Link href={`/write/?postId=${item.id}`}>수정</Link><button type="button" onClick={() => setDeleting(item.id)}>삭제</button></>}</td></tr>)}
    </tbody></table>{!loading && !filtered.length && <p className="message-card">해당하는 글이 없습니다.</p>}
    {filtered.length > 10 && <nav className="number-pager" aria-label="글 관리 페이지">
      <span className="pager-count">{page * 10 + 1}–{Math.min((page + 1) * 10, filtered.length)} / {filtered.length}편</span>
      <button type="button" aria-label="이전 페이지" disabled={page === 0} onClick={() => setPage((current) => current - 1)}>‹</button>
      {pageNumbers.map((index) => <button key={index} type="button"
        aria-current={page === index ? "page" : undefined} onClick={() => setPage(index)}>{index + 1}</button>)}
      <button type="button" aria-label="다음 페이지" disabled={page + 1 >= totalPages} onClick={() => setPage((current) => current + 1)}>›</button></nav>}</div>
  </>;
}
