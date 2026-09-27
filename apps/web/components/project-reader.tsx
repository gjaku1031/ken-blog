"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ApiFailure, apiFailureMessage, apiJson, parsePostDetail, recordPostView, type PostDetail } from "@/lib/api";
import { buildReadingDocument } from "@/lib/reading-document";
import { formatProjectPeriod, parseProjectDetail, parseRelatedTechPage, projectStatusLabel,
  validProjectSlug, type ProjectDetail, type ProjectDocument, type RelatedTech } from "@/lib/projects";
import { useAuth } from "./auth-provider";
import { SafeMarkdown } from "./safe-markdown";
import { TableOfContents } from "./table-of-contents";
import { PostBacklinks } from "./post-backlinks";
import type { ReadingDocument } from "@/lib/reading-document";
import { PublicAnalytics } from "./public-analytics";
import { publicImageUrl } from "@/lib/profile";

type ProjectState = { status: "loading" | "ready" | "error"; detail: ProjectDetail | null; error: string };
type DocumentState = { slug: string; status: "loading" | "ready" | "error"; post: PostDetail | null; error: string };

/** 기존 본문 렌더러의 주석·위키·목차·첨부 권한을 Post ID로 재사용한다. */
function ProjectBody({ body, postId, reading }: { body: string; postId: number; reading: ReadingDocument }) {
  return <><SafeMarkdown body={body} source={{ kind: "post", postId }} reading={reading} />
  </>;
}

/** slug 수명 동안 부모와 왼쪽 탐색을 유지하고 선택 문서만 별도 요청으로 교체한다. */
function ProjectShell({ slug, documentSlug }: { slug: string; documentSlug: string | null }) {
  const auth = useAuth();
  const router = useRouter();
  const [state, setState] = useState<ProjectState>({ status: "loading", detail: null, error: "" });
  const [retry, setRetry] = useState(0);
  const [document, setDocument] = useState<DocumentState>({ slug: "", status: "loading", post: null, error: "" });
  const [documentRetry, setDocumentRetry] = useState(0);
  const [related, setRelated] = useState<RelatedTech[]>([]);
  const [relatedPage, setRelatedPage] = useState(0);
  const [relatedTotalPages, setRelatedTotalPages] = useState(1);
  const [relatedLoading, setRelatedLoading] = useState(false);
  const [relatedError, setRelatedError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<"project" | "document" | null>(null);
  const [orderRows, setOrderRows] = useState<Array<{ id: number; title: string }> | null>(null);
  const [orderBusy, setOrderBusy] = useState(false);
  const [adminError, setAdminError] = useState("");
  const relatedController = useRef<AbortController | null>(null);
  const relatedBusy = useRef(false);
  const viewed = useRef(new Set<number>());
  const [viewCounts, setViewCounts] = useState<Record<number, number>>({});
  const reading = useMemo(() => {
    const detail = state.detail;
    if (state.status !== "ready" || !detail || detail.locked) return null;
    const source = documentSlug ? document.slug === documentSlug && document.status === "ready" && !document.post?.locked ?
      document.post?.body : null : detail.home.body;
    return source ? buildReadingDocument(source) : null;
  }, [state, documentSlug, document]);

  useEffect(() => () => { relatedController.current?.abort(); relatedBusy.current = false; }, []);
  useEffect(() => { setConfirmDelete(null); setOrderRows(null); setAdminError(""); }, [documentSlug]);

  /** 전체 DOC 목록을 관리자 API에서 읽어 숨긴 초안 문서도 순서 저장에 포함한다. */
  async function startOrder(projectId: number) {
    setOrderBusy(true); setAdminError("");
    try {
      const value = await auth.adminRead(`/api/v1/admin/projects/${projectId}`);
      if (!value || typeof value !== "object" || !("documents" in value) || !Array.isArray(value.documents))
        throw new ApiFailure("response");
      const rows = value.documents.map((entry) => { const row = entry as { id?: unknown; title?: unknown; order?: unknown };
        if (!Number.isSafeInteger(row.id) || typeof row.title !== "string" || !Number.isSafeInteger(row.order))
          throw new ApiFailure("response");
        return { id: row.id as number, title: row.title, order: row.order as number }; });
      setOrderRows(rows.sort((left, right) => left.order - right.order).map(({ id, title }) => ({ id, title })));
    } catch (failure) { setAdminError(apiFailureMessage(failure)); }
    finally { setOrderBusy(false); }
  }

  /** 현재 관리자 전체 목록의 ID 순서를 프로젝트 전용 경로로 저장한다. */
  async function saveOrder(projectId: number) {
    if (!orderRows) return;
    setOrderBusy(true); setAdminError("");
    try { await auth.adminWrite("PUT", `/api/v1/admin/projects/${projectId}/documents/order`, {
      postIds: orderRows.map((item) => item.id) }); setOrderRows(null); setRetry((value) => value + 1); }
    catch (failure) { setAdminError(apiFailureMessage(failure)); }
    finally { setOrderBusy(false); }
  }

  /** 프로젝트 또는 선택 문서를 소속별 전용 삭제 경로로 삭제한다. */
  async function remove(projectId: number, documentId?: number) {
    setOrderBusy(true); setAdminError("");
    try { await auth.adminWrite("DELETE", documentId ? `/api/v1/admin/projects/${projectId}/documents/${documentId}` :
      `/api/v1/admin/projects/${projectId}`); setConfirmDelete(null);
      if (documentId) { router.replace(`/project/?slug=${encodeURIComponent(slug)}`); setRetry((value) => value + 1); }
      else router.replace("/projects/"); }
    catch (failure) { setAdminError(apiFailureMessage(failure)); }
    finally { setOrderBusy(false); }
  }

  useEffect(() => {
    const id = documentSlug ? document.slug === documentSlug && document.status === "ready" && !document.post?.locked ?
      document.post?.id : null : state.status === "ready" && state.detail && !state.detail.locked ? state.detail.home.id : null;
    if (!id || viewed.current.has(id)) return;
    viewed.current.add(id);
    void recordPostView(id).then((count) => setViewCounts((current) => ({ ...current, [id]: count }))).catch(() => undefined);
  }, [documentSlug, document, state]);

  useEffect(() => {
    if (auth.status === "checking") return;
    const controller = new AbortController();
    let live = true;
    setState({ status: "loading", detail: null, error: "" });
    void (async () => {
      try {
        const credentials = await auth.readCredentials(controller.signal);
        const detail = parseProjectDetail(await apiJson<unknown>(`/api/v1/projects/${encodeURIComponent(slug)}`,
          credentials, controller.signal));
        if (!live) return;
        if (detail.project.slug !== slug) throw new ApiFailure("response");
        setState({ status: "ready", detail, error: "" });
        if (!detail.locked) { setRelated(detail.relatedTech); setRelatedPage(0);
          setRelatedTotalPages(Math.ceil(detail.relatedTechCount / 5)); }
      } catch (failure) {
        if (!live || controller.signal.aborted) return;
        if (failure instanceof ApiFailure && failure.status === 401) void auth.refresh();
        setState({ status: "error", detail: null, error: apiFailureMessage(failure) });
      }
    })();
    return () => { live = false; controller.abort(); };
  }, [auth.status, auth.readCredentials, auth.refresh, slug, retry]);

  useEffect(() => {
    if (!documentSlug || state.status !== "ready" || !state.detail || state.detail.locked) return;
    const controller = new AbortController();
    let live = true;
    setDocument({ slug: documentSlug, status: "loading", post: null, error: "" });
    void (async () => {
      try {
        const credentials = await auth.readCredentials(controller.signal);
        const value = await apiJson<unknown>(`/api/v1/posts/${encodeURIComponent(documentSlug)}`,
          credentials, controller.signal);
        const post = parsePostDetail(value);
        if (post.section !== "PROJECT_DOC" || post.projectSlug !== slug || post.slug !== documentSlug)
          throw new ApiFailure("response");
        if (live) setDocument({ slug: documentSlug, status: "ready", post, error: "" });
      } catch (failure) {
        if (!live || controller.signal.aborted) return;
        if (failure instanceof ApiFailure && failure.status === 401) void auth.refresh();
        setDocument({ slug: documentSlug, status: "error", post: null, error: apiFailureMessage(failure) });
      }
    })();
    return () => { live = false; controller.abort(); };
  }, [auth.readCredentials, auth.refresh, documentSlug, state.status, state.detail, slug, documentRetry]);

  /** 처음 5개 뒤의 관련 Tech 글은 요청한 페이지만 이어서 읽는다. */
  async function moreRelated() {
    if (relatedBusy.current || relatedPage + 1 >= relatedTotalPages) return;
    const page = relatedPage + 1;
    const controller = new AbortController();
    relatedController.current = controller; relatedBusy.current = true;
    setRelatedLoading(true); setRelatedError("");
    try {
      const credentials = await auth.readCredentials(controller.signal);
      const result = parseRelatedTechPage(await apiJson<unknown>(
        `/api/v1/projects/${encodeURIComponent(slug)}/related-posts?page=${page}&size=5`, credentials, controller.signal), page);
      if (controller.signal.aborted) return;
      setRelated((previous) => [...previous, ...result.items]);
      setRelatedPage(page); setRelatedTotalPages(result.totalPages);
    } catch (failure) {
      if (controller.signal.aborted) return;
      if (failure instanceof ApiFailure && failure.status === 401) void auth.refresh();
      setRelatedError(apiFailureMessage(failure));
    } finally {
      if (relatedController.current === controller) relatedController.current = null;
      relatedBusy.current = false;
      if (!controller.signal.aborted) setRelatedLoading(false);
    }
  }

  if (state.status === "loading") return <main id="main-content" className="page-container project-page" role="status">
    프로젝트를 불러오고 있습니다…</main>;
  if (state.status === "error" || !state.detail) return <main id="main-content" className="page-container project-page">
    <Link href="/projects/" className="back-link">← Projects</Link><p role="alert">{state.error}</p>
    <button type="button" className="small-button" onClick={() => setRetry((value) => value + 1)}>다시 시도</button></main>;
  const detail = state.detail;
  if (detail.locked) return <main id="main-content" className="page-container project-page">
    <Link href="/projects/" className="back-link">← Projects</Link><div className="locked-post card project-locked">
      <h1>{detail.project.name}</h1><p>로그인이 필요한 프로젝트입니다.</p>
      <Link className="primary-button" href={`/login/?returnTo=${encodeURIComponent(`/project/?slug=${slug}${documentSlug ? `&doc=${documentSlug}` : ""}`)}`}>
        로그인</Link></div></main>;

  const selected = documentSlug ? detail.documents.find((item) => item.slug === documentSlug) : null;
  const visibleDocument = documentSlug && document.slug === documentSlug && document.status === "ready" ? document.post : null;
  const documents = [...detail.documents].sort((left, right) => left.order - right.order || left.id - right.id);
  const selectedIndex = documentSlug ? documents.findIndex((item) => item.slug === documentSlug) : -1;
  const toDocument = (item: ProjectDocument) => `/project/?slug=${encodeURIComponent(slug)}&doc=${encodeURIComponent(item.slug)}`;

  return <main id="main-content" className="page-container project-page project-layout">
    {detail.project.visibility === "PUBLIC" && (!documentSlug || visibleDocument && !visibleDocument.locked) &&
      <PublicAnalytics virtualPath={documentSlug ? `/project/${slug}/docs/${documentSlug}` : `/project/${slug}`} />}
    <aside className="project-sidebar" aria-label="프로젝트 탐색">
      <Link href="/projects/" className="back-link">← Projects</Link>
      <h2>{detail.project.name}</h2>
      <nav aria-label="프로젝트 문서"><Link href={`/project/?slug=${encodeURIComponent(slug)}`}
        aria-current={!documentSlug ? "page" : undefined}>대문</Link>
        <ol>{documents.map((item, index) => <li key={item.id}><Link href={toDocument(item)}
          aria-current={documentSlug === item.slug ? "page" : undefined}>{index + 1}. {item.title}
          {item.visibility === "PRIVATE" && <span> · 비공개</span>}</Link></li>)}</ol></nav>
      {auth.status === "authenticated" && auth.user?.role === "ADMIN" && <Link className="project-add-document"
        href={`/write/?section=project-doc&projectId=${detail.project.id}`}>+ 문서 추가</Link>}
      {auth.user?.role === "ADMIN" && (orderRows ? <div className="project-order card"><strong>문서 순서</strong>
        <ol>{orderRows.map((item, position) => <li key={item.id}><span>{item.title}</span>
          <button type="button" disabled={position === 0 || orderBusy} aria-label={`${item.title} 위로`} onClick={() => setOrderRows((current) => {
            if (!current) return current; const next = [...current]; [next[position - 1], next[position]] = [next[position], next[position - 1]]; return next;
          })}>▲</button><button type="button" disabled={position === orderRows.length - 1 || orderBusy} aria-label={`${item.title} 아래로`}
            onClick={() => setOrderRows((current) => { if (!current) return current; const next = [...current];
              [next[position], next[position + 1]] = [next[position + 1], next[position]]; return next; })}>▼</button></li>)}</ol>
        <button type="button" className="small-button" onClick={() => setOrderRows(null)}>취소</button>
        <button type="button" className="primary-button" disabled={orderBusy} onClick={() => void saveOrder(detail.project.id)}>순서 저장</button>
      </div> : <button type="button" className="project-order-link" disabled={orderBusy}
        onClick={() => void startOrder(detail.project.id)}>문서 순서</button>)}
      {adminError && <p role="alert" className="inline-error">{adminError}</p>}
      {detail.relatedTechCount > 0 && <section className="project-related"><h3>관련 글 · Tech {detail.relatedTechCount}</h3>
        <ul>{related.map((item) => <li key={item.id}><Link href={`/post/?slug=${encodeURIComponent(item.slug)}`}>
          {item.title}</Link><time>{item.publishedDate}</time></li>)}</ul>
        {relatedPage + 1 < relatedTotalPages && <button type="button" className="small-button" disabled={relatedLoading}
          onClick={() => void moreRelated()}>{relatedLoading ? "불러오는 중…" : "더 보기"}</button>}
        {related.length > 5 && <button type="button" className="small-button" onClick={() => {
          relatedController.current?.abort(); relatedController.current = null; relatedBusy.current = false; setRelatedLoading(false);
          setRelated(detail.relatedTech); setRelatedPage(0); setRelatedError("");
        }}>접기</button>}
        {relatedError && <p role="alert">{relatedError} <button type="button" className="small-button"
          onClick={() => void moreRelated()}>다시 시도</button></p>}
      </section>}
      {reading && reading.toc.length > 0 && <TableOfContents items={reading.toc} />}
    </aside>
    <article className="project-main card">
      {!documentSlug ? <>
        <div className="project-overline">Projects {detail.project.visibility === "PRIVATE" ? "· 비공개" : ""}
          {auth.status === "authenticated" && auth.user?.role === "ADMIN" && <Link
            href={`/write/?postId=${detail.home.id}`}>대문 수정</Link>}
          {auth.user?.role === "ADMIN" && <button type="button" onClick={() => setConfirmDelete("project")}>프로젝트 삭제</button>}</div>
        <h1>{detail.project.name}</h1>
        <div className="project-meta"><span className={`project-status project-status-${detail.project.status.toLowerCase()}`}>
          <span aria-hidden="true" />{projectStatusLabel(detail.project.status)}</span>
          <span className="mono">{formatProjectPeriod(detail.project.startPeriod, detail.project.endPeriod, detail.project.status)}</span>
          {viewCounts[detail.home.id] !== undefined && <span>조회 {viewCounts[detail.home.id].toLocaleString("ko-KR")}</span>}</div>
        {detail.project.overview && <p className="project-overview">{detail.project.overview}</p>}
        {detail.project.stackBadges.length > 0 && <div className="stack-badges">{detail.project.stackBadges.map((badge) => <span key={badge.id}>
          {publicImageUrl(badge.imageUrl) && <Image src={publicImageUrl(badge.imageUrl)!} alt="" width={22} height={22} unoptimized />}
          {badge.name}</span>)}</div>}
        {reading && <ProjectBody body={detail.home.body} postId={detail.home.id} reading={reading} />}
        <PostBacklinks slug={detail.home.slug} />
        {confirmDelete === "project" && <div className="inline-confirm" role="alertdialog" aria-label="프로젝트 삭제 확인">
          <p>“{detail.project.name}” 프로젝트와 소속 문서를 삭제합니다.</p>
          <button type="button" className="small-button" onClick={() => setConfirmDelete(null)}>취소</button>
          <button type="button" className="small-button danger-button" disabled={orderBusy}
            onClick={() => void remove(detail.project.id)}>삭제</button></div>}
      </> : <>
        <div className="project-overline">Projects · <Link href={`/project/?slug=${encodeURIComponent(slug)}`}>
          {detail.project.name}</Link>{visibleDocument?.publishedDate ? ` · ${visibleDocument.publishedDate}` : ""}
          {visibleDocument && viewCounts[visibleDocument.id] !== undefined ? ` · 조회 ${viewCounts[visibleDocument.id].toLocaleString("ko-KR")}` : ""}
          {auth.status === "authenticated" && auth.user?.role === "ADMIN" && visibleDocument && <Link
            href={`/write/?postId=${visibleDocument.id}`}>수정</Link>}
          {auth.user?.role === "ADMIN" && visibleDocument && <button type="button" onClick={() => setConfirmDelete("document")}>삭제</button>}</div>
        {(!visibleDocument || document.status !== "ready") && (document.slug !== documentSlug || document.status === "loading") &&
          <p role="status">문서를 불러오고 있습니다…</p>}
        {document.slug === documentSlug && document.status === "error" && <p role="alert">{document.error} <button
          type="button" className="small-button" onClick={() => setDocumentRetry((value) => value + 1)}>다시 시도</button></p>}
        {visibleDocument && <><h1>{visibleDocument.title}</h1>
          {visibleDocument.locked ? <div className="locked-post"><p>이 문서는 로그인 후 읽을 수 있습니다.</p>
            <Link href={`/login/?returnTo=${encodeURIComponent(toDocument(selected ?? {
              id: visibleDocument.id, title: visibleDocument.title, slug: documentSlug, order: 1,
              publishedDate: "", visibility: "PRIVATE", locked: true }))}`}>로그인</Link></div> :
            <>{reading && <ProjectBody body={visibleDocument.body ?? ""} postId={visibleDocument.id} reading={reading} />}
              <PostBacklinks key={documentSlug} slug={documentSlug} /></>}
          {confirmDelete === "document" && <div className="inline-confirm" role="alertdialog" aria-label="문서 삭제 확인">
            <p>“{visibleDocument.title}” 문서를 삭제합니다.</p><button type="button" className="small-button" onClick={() => setConfirmDelete(null)}>취소</button>
            <button type="button" className="small-button danger-button" disabled={orderBusy}
              onClick={() => void remove(detail.project.id, visibleDocument.id)}>삭제</button></div>}
          {selectedIndex >= 0 && <nav className="project-document-neighbors" aria-label="이전·다음 문서">
            {documents[selectedIndex - 1] && <Link href={toDocument(documents[selectedIndex - 1])}>← 이전 문서 · {documents[selectedIndex - 1].title}</Link>}
            {documents[selectedIndex + 1] && <Link href={toDocument(documents[selectedIndex + 1])}>다음 문서 · {documents[selectedIndex + 1].title} →</Link>}
          </nav>}</>}
      </>}
    </article>
  </main>;
}

/** 알 수 없는 쿼리·중복 값은 요청 전 거부하고 세션/부모별 화면을 분리한다. */
export function ProjectReader() {
  const params = useSearchParams();
  const auth = useAuth();
  const slugValues = params.getAll("slug");
  const documentValues = params.getAll("doc");
  const valid = slugValues.length === 1 && validProjectSlug(slugValues[0]) && documentValues.length <= 1 &&
    (!documentValues.length || validProjectSlug(documentValues[0])) &&
    [...params.keys()].every((key) => key === "slug" || key === "doc");
  if (!valid) return <main id="main-content" className="page-container project-page"><h1>프로젝트 주소를 확인해 주세요</h1>
    <Link href="/projects/">Projects 목록으로 돌아가기</Link></main>;
  return <ProjectShell key={`${auth.epoch}:${slugValues[0]}`} slug={slugValues[0]}
    documentSlug={documentValues[0] ?? null} />;
}
