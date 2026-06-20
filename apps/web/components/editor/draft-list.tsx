"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ApiFailure, apiFailureMessage } from "@/lib/api";
import { parseAdminCategories, parseDraftPage, type DraftPage, type DraftSummary } from "@/lib/editor-drafts";
import type { CategoryNode } from "@/lib/api";
import { useAuth } from "@/components/auth-provider";
import "./draft-list.css";

type ListState =
  | { kind: "idle" | "loading"; epoch: number; page: number }
  | { kind: "ready"; epoch: number; page: number; data: DraftPage; categories: Map<number, string> | null }
  | { kind: "error"; epoch: number; page: number; message: string };

const PAGE_SIZE = 10;
const MAX_PAGE = Math.floor(2_147_483_647 / PAGE_SIZE);

/** 정적 URL에는 0기반 페이지 번호 하나만 받고 API offset 한도까지 검사한다. */
function pageFromQuery(query: string): number | null {
  const params = new URLSearchParams(query);
  if ([...params.keys()].some((key) => key !== "page") || params.getAll("page").length > 1) return null;
  const raw = params.get("page");
  if (raw === null) return 0;
  if (!/^(0|[1-9]\d*)$/.test(raw)) return null;
  const page = Number(raw);
  return Number.isSafeInteger(page) && page <= MAX_PAGE ? page : null;
}

/** 시간대 표시 없는 서버 UTC LocalDateTime을 명시적 UTC instant로 바꾼다. */
function utcTime(value: string): { iso: string; label: string } | null {
  const iso = /(?:Z|[+-]\d{2}:\d{2})$/i.test(value) ? value : `${value}Z`;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const label = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(date);
  return { iso, label };
}

/** 유효하지 않은 시각에 잘못된 time 값을 싣지 않는다. */
function SavedAt({ value }: { value: string }) {
  const time = utcTime(value);
  return time ? <time className="draft-list-time" dateTime={time.iso}>{time.label}</time> :
    <span className="draft-list-time">저장 시각 확인 불가</span>;
}

/** 관리자 분류 트리를 실제 저장된 경로의 ID 조회표로 펼친다. */
function categoryPaths(tree: CategoryNode[]): Map<number, string> {
  const paths = new Map<number, string>();
  const visit = (nodes: CategoryNode[]) => {
    for (const node of nodes) { paths.set(node.id, node.path); visit(node.children); }
  };
  visit(tree);
  return paths;
}

/** 현재 페이지 주변의 번호 링크를 일곱 개 이내로 제한한다. */
function pageNumbers(page: number, totalPages: number): number[] {
  const count = Math.min(7, totalPages);
  const first = Math.max(0, Math.min(page - 3, totalPages - count));
  return Array.from({ length: count }, (_, index) => first + index);
}

/** 목록과 삭제 오류를 현재 입력·행을 유지하는 안내로 분리한다. */
function listError(error: unknown, deleting = false): string {
  if (error instanceof ApiFailure) {
    if (error.kind === "config") return "API 주소가 설정되지 않아 관리자 편집본을 불러올 수 없습니다.";
    if (deleting && error.status === 409) return "다른 저장이 먼저 완료되어 이 편집본을 삭제하지 않았습니다. 현재 목록을 유지합니다. 다시 조회한 뒤 확인해 주세요.";
    if (deleting && error.status === 404) return "편집본을 찾을 수 없습니다. 현재 목록을 유지합니다. 다시 조회해 주세요.";
    if (error.status === 403) return "관리자 권한 또는 요청 검증을 확인할 수 없습니다. 다시 로그인하거나 목록을 새로고침해 주세요.";
    if (error.status === 404) return "요청한 페이지를 찾을 수 없습니다. 주소를 확인해 주세요.";
  }
  return apiFailureMessage(error);
}

/** 실제 서버 편집본을 ADMIN 세대에 묶어 조회·페이지 이동·조건부 삭제한다. */
export function DraftList() {
  const router = useRouter();
  const query = useSearchParams().toString();
  const page = useMemo(() => pageFromQuery(query), [query]);
  const auth = useAuth();
  const { status, user, epoch, adminRead, adminWrite } = auth;
  const [reload, setReload] = useState(0);
  const [list, setList] = useState<ListState>({ kind: "idle", epoch, page: page ?? 0 });
  const [deleting, setDeleting] = useState<number | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const deletion = useRef<AbortController | null>(null);
  const epochNow = useRef(epoch);
  epochNow.current = epoch;
  const admin = status === "authenticated" && user?.role === "ADMIN";
  const configured = Boolean(process.env.NEXT_PUBLIC_API_BASE_URL?.trim());

  /** 로그인·페이지 전환 뒤에는 삭제 상태와 이전 목록을 버리고 응답을 폐기한다. */
  useEffect(() => {
    setDeleting(null);
    setDeleteError("");
    setList({ kind: "idle", epoch, page: page ?? 0 });
    return () => {
      deletion.current?.abort();
      deletion.current = null;
    };
  }, [epoch, page]);

  /** 세션 세대와 요청 페이지가 바뀌면 이전 목록을 렌더하지 않고 새 요약만 읽는다. */
  useEffect(() => {
    if (!admin || page === null || !configured) return;
    const controller = new AbortController();
    let active = true;
    setList({ kind: "loading", epoch, page });
    setDeleteError("");
    void (async () => {
      try {
        const [draftResult, categoryResult] = await Promise.allSettled([
          adminRead(`/api/v1/admin/editor-drafts?page=${page}&size=${PAGE_SIZE}`, controller.signal),
          adminRead("/api/v1/admin/categories", controller.signal),
        ]);
        if (draftResult.status === "rejected") throw draftResult.reason;
        const data = parseDraftPage(draftResult.value);
        const categories = categoryResult.status === "fulfilled" ? categoryPaths(parseAdminCategories(categoryResult.value)) : null;
        if (active && !controller.signal.aborted && epochNow.current === epoch) setList({ kind: "ready", epoch, page, data, categories });
      } catch (error) {
        if (active && !controller.signal.aborted && epochNow.current === epoch) {
          setList({ kind: "error", epoch, page, message: listError(error) });
        }
      }
    })();
    return () => { active = false; controller.abort(); };
  }, [admin, adminRead, configured, epoch, page, reload]);

  /** 다른 관리자 삭제로 현재 페이지가 사라졌으면 실제 마지막 페이지로 이동한다. */
  useEffect(() => {
    if (list.kind !== "ready" || list.epoch !== epoch || list.page !== page || page === null) return;
    const last = Math.max(0, list.data.totalPages - 1);
    if (page > last) router.replace(`/admin/drafts/?page=${last}`);
  }, [epoch, list, page, router]);

  /** 서버 revision을 조건으로 편집본만 지우며 충돌 때 현재 행을 보존한다. */
  async function removeDraft(item: DraftSummary) {
    if (deletion.current || !admin || page === null) return;
    if (!window.confirm(`「${item.title || "제목 없는 편집본"}」 임시저장을 삭제할까요? 공개 원본 글은 삭제되지 않습니다.`)) return;
    const requestEpoch = epoch;
    const controller = new AbortController();
    deletion.current = controller;
    setDeleting(item.id);
    setDeleteError("");
    try {
      await adminWrite("DELETE", `/api/v1/admin/editor-drafts/${item.id}?revision=${item.revision}`, undefined, controller.signal);
      if (controller.signal.aborted || epochNow.current !== requestEpoch) return;
      if (list.kind === "ready" && list.epoch === requestEpoch && list.page === page && page > 0 &&
        page > Math.max(0, Math.ceil(Math.max(0, list.data.totalElements - 1) / PAGE_SIZE) - 1)) {
        const last = Math.max(0, Math.ceil(Math.max(0, list.data.totalElements - 1) / PAGE_SIZE) - 1);
        router.replace(`/admin/drafts/?page=${last}`);
      } else {
        setReload((count) => count + 1);
      }
    } catch (error) {
      if (!controller.signal.aborted && epochNow.current === requestEpoch) setDeleteError(listError(error, true));
    } finally {
      if (deletion.current === controller) deletion.current = null;
      if (epochNow.current === requestEpoch) setDeleting(null);
    }
  }

  const loginTarget = page === null ? "/admin/drafts/" : `/admin/drafts/?page=${page}`;
  const current = list.epoch === epoch && list.page === page ? list : null;
  const data = current?.kind === "ready" ? current.data : null;
  const categoryMap = current?.kind === "ready" ? current.categories : null;

  return <div className="draft-list-shell">
    <div className="draft-list-heading">
      <div><p className="eyebrow">관리 · 글쓰기</p><h1>임시저장 글</h1>
        <p className="draft-list-subtitle">게시글 원문과 분리해 수동 저장한 편집본</p></div>
      {admin && <Link className="primary-button" href="/write/">새 글 작성</Link>}
    </div>
    {page === null ? <div className="message-card card" role="alert">페이지 주소가 올바르지 않습니다. 0 이상의 페이지 번호 하나만 사용할 수 있습니다.
      <p><Link href="/admin/drafts/">첫 페이지로 이동</Link></p></div> :
      !configured ? <div className="message-card card" role="status">공개 API 주소가 아직 설정되지 않아 관리자 편집본을 불러올 수 없습니다.</div> :
      status === "checking" ? <div className="message-card card" role="status">관리자 세션을 확인하고 있습니다…</div> :
      status === "error" ? <div className="message-card card" role="alert">관리자 세션을 확인할 수 없습니다.
        <p><button type="button" className="small-button" onClick={() => void auth.refresh()}>다시 확인</button></p></div> :
      status === "guest" ? <div className="message-card card" role="status">임시저장 글을 보려면 관리자 로그인이 필요합니다.
        <p><Link className="primary-button" href={`/login/?returnTo=${encodeURIComponent(loginTarget)}`}>로그인</Link></p></div> :
      !admin ? <div className="message-card card" role="alert">관리자 권한이 없는 계정입니다. 임시저장 목록을 볼 수 없습니다.</div> :
      current?.kind === "error" ? <div className="message-card card" role="alert"><p>{current.message}</p>
        <button type="button" className="small-button" onClick={() => setReload((count) => count + 1)}>다시 조회</button></div> :
      !data ? <div className="message-card card" role="status">임시저장 글을 불러오고 있습니다…</div> : <>
        <div className="draft-list-total"><strong>임시저장 {data.totalElements.toLocaleString("ko-KR")}건</strong><span>10개씩 보기 · {data.page + 1}페이지</span></div>
        {deleteError && <div className="draft-list-alert" role="alert">{deleteError} <button type="button" onClick={() => setReload((count) => count + 1)}>다시 조회</button></div>}
        {data.items.length === 0 ? <div className="message-card card draft-list-empty"><h2>저장된 편집본이 없습니다</h2>
          <p>{data.totalElements > 0 ? "이 페이지에는 글이 없습니다. 앞 페이지로 이동해 주세요." : "새 글을 작성하고 수동 저장하면 이곳에 표시됩니다."}</p>
          {page > 0 && <Link className="small-button" href={`/admin/drafts/?page=${page - 1}`}>앞 페이지</Link>}
        </div> : <div className="draft-list-card card"><div className="draft-list-columns" aria-hidden="true">
          <span>제목</span><span>분류</span><span>저장</span><span>동작</span></div>
          <ul className="draft-list-items" aria-label="임시저장 편집본">
          {data.items.map((item) => <li className="draft-list-item" key={item.id}>
            <div className="draft-list-main"><Link className="draft-list-title" href={`/write/?draftId=${item.id}`}>{item.title || "제목 없는 편집본"}</Link>
              <div className="draft-list-meta"><span>{item.postId === null ? "새 글" : "기존 글 수정"}</span>
                <span>{item.visibility === "PUBLIC" ? "전체 공개 예정" : "회원 공개 예정"}</span></div></div>
            <span className="draft-list-category">{item.categoryId === null ? "미분류" :
              categoryMap === null ? "분류 확인 불가" : categoryMap.get(item.categoryId) ?? "삭제된 분류"}</span>
            <SavedAt value={item.updatedAt} />
            <div className="draft-list-actions"><Link href={`/write/?draftId=${item.id}`}>이어쓰기</Link>
              <button type="button" disabled={deleting !== null} onClick={() => void removeDraft(item)}
                aria-label={`${item.title || "제목 없는 편집본"} 임시저장 삭제`}>{deleting === item.id ? "삭제 중…" : "삭제"}</button></div>
          </li>)}
        </ul></div>}
        {data.totalPages > 1 && <nav className="draft-list-pagination" aria-label="임시저장 페이지">
          {page > 0 && <Link href={`/admin/drafts/?page=${page - 1}`}>이전</Link>}
          {pageNumbers(page, data.totalPages).map((number) => <Link key={number} href={`/admin/drafts/?page=${number}`}
            aria-current={number === page ? "page" : undefined} aria-label={`${number + 1}페이지`}>{number + 1}</Link>)}
          {page + 1 < data.totalPages && <Link href={`/admin/drafts/?page=${page + 1}`}>다음</Link>}
        </nav>}
      </>}
  </div>;
}
