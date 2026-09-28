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
import { readPinnedIds } from "@/lib/feed";
import { publicPostPath, publicProjectPath } from "@/lib/public-route";

type ProjectState = { status: "loading" | "ready" | "error"; detail: ProjectDetail | null; error: string };
type DocumentState = { slug: string; status: "loading" | "ready" | "error"; post: PostDetail | null; error: string };

/** 기존 본문 렌더러의 주석·위키·목차·첨부 권한을 Post ID로 재사용한다. {@link ProjectBody} */
function ProjectBody({ body, postId, reading }: { body: string; postId: number; reading: ReadingDocument }) {
  return <><SafeMarkdown body={body} source={{ kind: "post", postId }} reading={reading} />
  </>;
}

/** 생성된 프로젝트 본문을 유지하며 부모와 선택 문서를 현재 세션으로 다시 확인한다. {@link ProjectShell} */
function ProjectShell({ slug, documentSlug, initialDetail, initialDocument }: {
  slug: string; documentSlug: string | null; initialDetail?: ProjectDetail; initialDocument?: PostDetail;
}) {
  const auth = useAuth();
  const router = useRouter();
  const [state, setState] = useState<ProjectState>(() => initialDetail ?
    { status: "ready", detail: initialDetail, error: "" } : { status: "loading", detail: null, error: "" });
  const [retry, setRetry] = useState(0);
  const [verified, setVerified] = useState(false);
  const [document, setDocument] = useState<DocumentState>(() => initialDocument && documentSlug ?
    { slug: documentSlug, status: "ready", post: initialDocument, error: "" } :
    { slug: "", status: "loading", post: null, error: "" });
  const [documentRetry, setDocumentRetry] = useState(0);
  const [documentVerified, setDocumentVerified] = useState(false);
  const [related, setRelated] = useState<RelatedTech[]>(initialDetail && !initialDetail.locked ? initialDetail.relatedTech : []);
  const [relatedPage, setRelatedPage] = useState(0);
  const [relatedTotalPages, setRelatedTotalPages] = useState(initialDetail && !initialDetail.locked ?
    Math.ceil(initialDetail.relatedTechCount / 5) : 1);
  const [relatedLoading, setRelatedLoading] = useState(false);
  const [relatedError, setRelatedError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<"project" | "document" | null>(null);
  const [orderBusy, setOrderBusy] = useState(false);
  const [adminError, setAdminError] = useState("");
  const [pinBusy, setPinBusy] = useState(false);
  const [pinned, setPinned] = useState<Record<number, boolean>>({});
  const relatedController = useRef<AbortController | null>(null);
  const relatedBusy = useRef(false);
  const viewed = useRef(new Set<number>());
  const [viewCounts, setViewCounts] = useState<Record<number, number>>({});
  const reading = useMemo(() => {
    const detail = state.detail;
    if (state.status !== "ready" || !detail || detail.locked) return null;
    if (documentSlug && (detail.documents.find((item) => item.slug === documentSlug)?.locked ?? true)) return null;
    const source = documentSlug ? document.slug === documentSlug && document.status === "ready" && !document.post?.locked ?
      document.post?.body : null : detail.home.body;
    return source ? buildReadingDocument(source) : null;
  }, [state, documentSlug, document]);

  useEffect(() => () => { relatedController.current?.abort(); relatedBusy.current = false; }, []);
  useEffect(() => { setConfirmDelete(null); setAdminError(""); }, [documentSlug]);

  /** 프로젝트 또는 선택 문서를 소속별 전용 삭제 경로로 삭제한다. {@link remove} */
  async function remove(projectId: number, documentId?: number) {
    setOrderBusy(true); setAdminError("");
    try { await auth.adminWrite("DELETE", documentId ? `/api/v1/admin/projects/${projectId}/documents/${documentId}` :
      `/api/v1/admin/projects/${projectId}`); setConfirmDelete(null);
      if (documentId) { router.replace(publicProjectPath(slug)); setRetry((value) => value + 1); }
      else router.replace("/projects/"); }
    catch (failure) { setAdminError(apiFailureMessage(failure)); }
    finally { setOrderBusy(false); }
  }

  /** {@link readPinnedIds}의 전체 순서를 보존하며 현재 프로젝트 문서의 고정 여부만 변경한다. */
  async function toggleDocumentPin(post: PostDetail) {
    if (pinBusy) return;
    setPinBusy(true); setAdminError("");
    try {
      const ids = await readPinnedIds(await auth.readCredentials());
      const index = ids.indexOf(post.id);
      if (index < 0) ids.push(post.id); else ids.splice(index, 1);
      await auth.adminWrite("PUT", "/api/v1/admin/pins", { postIds: ids });
      setPinned((current) => ({ ...current, [post.id]: index < 0 }));
    } catch (failure) { setAdminError(apiFailureMessage(failure)); }
    finally { setPinBusy(false); }
  }

  useEffect(() => {
    const id = documentSlug ? document.slug === documentSlug && document.status === "ready" && !document.post?.locked ?
      document.post?.id : null : state.status === "ready" && state.detail && !state.detail.locked ? state.detail.home.id : null;
    if (!(documentSlug ? documentVerified : verified) || !id || viewed.current.has(id)) return;
    viewed.current.add(id);
    void recordPostView(id).then((count) => setViewCounts((current) => ({ ...current, [id]: count }))).catch(() => undefined);
  }, [documentSlug, document, state, verified, documentVerified]);

  useEffect(() => {
    if (auth.status === "checking") return;
    const controller = new AbortController();
    let live = true;
    void (async () => {
      try {
        const credentials = await auth.readCredentials(controller.signal);
        const detail = parseProjectDetail(await apiJson<unknown>(`/api/v1/projects/${encodeURIComponent(slug)}`,
          credentials, controller.signal));
        if (!live) return;
        if (detail.project.slug !== slug) throw new ApiFailure("response");
        setState({ status: "ready", detail, error: "" }); setVerified(true);
        if (!detail.locked) { setRelated(detail.relatedTech); setRelatedPage(0);
          setRelatedTotalPages(Math.ceil(detail.relatedTechCount / 5)); }
      } catch (failure) {
        if (!live || controller.signal.aborted) return;
        if (failure instanceof ApiFailure && failure.status === 401) void auth.refresh();
        setState({ status: "error", detail: null, error: apiFailureMessage(failure) }); setVerified(false);
      }
    })();
    return () => { live = false; controller.abort(); };
  }, [auth.status, auth.readCredentials, auth.refresh, slug, retry]);

  useEffect(() => {
    if (!documentSlug || state.status !== "ready" || !state.detail || state.detail.locked) return;
    const controller = new AbortController();
    let live = true;
    setDocument((current) => current.slug === documentSlug && current.status === "ready" ? current :
      { slug: documentSlug, status: "loading", post: null, error: "" });
    void (async () => {
      try {
        const credentials = await auth.readCredentials(controller.signal);
        const value = await apiJson<unknown>(`/api/v1/posts/${encodeURIComponent(documentSlug)}`,
          credentials, controller.signal);
        const post = parsePostDetail(value);
        if (post.section !== "PROJECT_DOC" || post.projectSlug !== slug || post.slug !== documentSlug)
          throw new ApiFailure("response");
        if (live) { setDocument({ slug: documentSlug, status: "ready", post, error: "" }); setDocumentVerified(true); }
      } catch (failure) {
        if (!live || controller.signal.aborted) return;
        if (failure instanceof ApiFailure && failure.status === 401) void auth.refresh();
        setDocument({ slug: documentSlug, status: "error", post: null, error: apiFailureMessage(failure) });
        setDocumentVerified(false);
      }
    })();
    return () => { live = false; controller.abort(); };
  }, [auth.readCredentials, auth.refresh, documentSlug, state.status, state.detail, slug, documentRetry]);

  /** 처음 5개 뒤의 관련 Tech 글은 요청한 페이지만 이어서 읽는다. {@link moreRelated} */
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
  if (detail.locked) return <main id="main-content" className="page-container project-page project-layout">
    <aside className="project-sidebar" aria-label="프로젝트 탐색"><Link href="/projects/" className="back-link">← Projects</Link>
      <h2>{detail.project.name}</h2><nav aria-label="프로젝트 대문"><span className="locked-home-label">대문</span></nav></aside>
    <div className="locked-post card project-locked"><span className="private-label">관리자만</span>
      <h1>{detail.project.name}</h1><p>이 프로젝트는 관리자만 볼 수 있습니다.</p></div></main>;

  const documents = [...detail.documents].sort((left, right) => left.order - right.order || left.id - right.id);
  const selectedIndex = documentSlug ? documents.findIndex((item) => item.slug === documentSlug) : -1;
  const visibleDocument = documentSlug && selectedIndex >= 0 &&
    (!documents[selectedIndex].locked || document.post?.locked) &&
    document.slug === documentSlug && document.status === "ready" ? document.post : null;
  const toDocument = (item: ProjectDocument) => publicProjectPath(slug, item.slug);

  return <main id="main-content" className="page-container project-page project-layout">
    {detail.project.visibility === "PUBLIC" && (!documentSlug || visibleDocument && !visibleDocument.locked &&
      documents[selectedIndex]?.visibility === "PUBLIC") &&
      <PublicAnalytics virtualPath={documentSlug ? `/project/${slug}/docs/${documentSlug}` : `/project/${slug}`} />}
    <aside className="project-sidebar" aria-label="프로젝트 탐색">
      <Link href="/projects/" className="back-link">← Projects</Link>
      <h2>{detail.project.name}</h2>
      <nav aria-label="프로젝트 문서"><Link href={publicProjectPath(slug)}
        aria-current={!documentSlug ? "page" : undefined}>대문</Link>
        <ol>{documents.map((item, index) => <li key={item.id}><Link href={toDocument(item)}
          aria-current={documentSlug === item.slug ? "page" : undefined}>{index + 1}. {item.title}
          {item.visibility === "PRIVATE" && <span> · 나만 보기</span>}</Link></li>)}</ol></nav>
      {auth.status === "authenticated" && auth.user?.role === "ADMIN" && <Link className="project-add-document"
        href={`/write/?section=project-doc&projectId=${detail.project.id}`}>+ 문서 추가</Link>}
      {adminError && <p role="alert" className="inline-error">{adminError}</p>}
      {detail.relatedTechCount > 0 && <section className="project-related"><h3>관련 글 · Tech {detail.relatedTechCount}</h3>
        <ul>{related.map((item) => <li key={item.id}><Link href={publicPostPath(item.slug)}>
          {item.title}</Link><time>{item.publishedDate.slice(2).replaceAll("-", ".")}</time></li>)}</ul>
        {relatedPage + 1 < relatedTotalPages && <button type="button" className="small-button" disabled={relatedLoading}
          onClick={() => void moreRelated()}>{relatedLoading ? "불러오는 중…" : `${detail.relatedTechCount - related.length}개 더 보기`}</button>}
        {related.length > 5 && <button type="button" className="small-button" onClick={() => {
          relatedController.current?.abort(); relatedController.current = null; relatedBusy.current = false; setRelatedLoading(false);
          setRelated(detail.relatedTech); setRelatedPage(0); setRelatedError("");
        }}>접기</button>}
        {relatedError && <p role="alert">{relatedError} <button type="button" className="small-button"
          onClick={() => void moreRelated()}>다시 시도</button></p>}
      </section>}
      {documentSlug && reading && reading.toc.length > 0 && <TableOfContents items={reading.toc} />}
    </aside>
    <article className="project-main card">
      {!documentSlug ? <>
        <div className="project-overline">Projects {detail.project.visibility === "PRIVATE" ? "· 나만 보기" : ""}
          {auth.user?.role === "ADMIN" && <span className="inline-actions"><Link
            href={`/write/?postId=${detail.home.id}`}>대문 수정</Link>
            <button type="button" className="danger-text" onClick={() => setConfirmDelete("project")}>프로젝트 삭제</button></span>}</div>
        <h1>{detail.project.name}</h1>
        <div className="project-meta"><span className={`project-status project-status-${detail.project.status.toLowerCase()}`}>
          <span aria-hidden="true" />{projectStatusLabel(detail.project.status)}</span>
          <span className="mono">{formatProjectPeriod(detail.project.startPeriod, detail.project.endPeriod, detail.project.status)}</span></div>
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
        <div className="project-overline">Projects · <Link href={publicProjectPath(slug)}>
          {detail.project.name}</Link>{visibleDocument?.publishedDate ? ` · ${visibleDocument.publishedDate.replaceAll("-", ".")}` : ""}
          {visibleDocument && !visibleDocument.locked ? ` · ${Math.max(1, Math.round((visibleDocument.body ?? "").length / 500))}분` : ""}
          {visibleDocument && viewCounts[visibleDocument.id] !== undefined ? ` · 조회 ${viewCounts[visibleDocument.id].toLocaleString("ko-KR")}` : ""}
          {auth.user?.role === "ADMIN" && visibleDocument && <span className="inline-actions">
            <Link href={`/write/?postId=${visibleDocument.id}`}>수정</Link>
            {!visibleDocument.locked && <button type="button" disabled={pinBusy}
              onClick={() => void toggleDocumentPin(visibleDocument)}>
              {(pinned[visibleDocument.id] ?? visibleDocument.pinOrder !== null) ? "핀 해제" : "핀 고정"}</button>}
            <button type="button" className="danger-text" onClick={() => setConfirmDelete("document")}>삭제</button></span>}</div>
        {(!visibleDocument || document.status !== "ready") && (document.slug !== documentSlug || document.status === "loading") &&
          <p role="status">문서를 불러오고 있습니다…</p>}
        {document.slug === documentSlug && document.status === "error" && <p role="alert">{document.error} <button
          type="button" className="small-button" onClick={() => setDocumentRetry((value) => value + 1)}>다시 시도</button></p>}
        {visibleDocument && <><h1>{visibleDocument.title}</h1>
          {!visibleDocument.locked && visibleDocument.tags.length > 0 && <div className="tag-list detail-tags">
            {visibleDocument.tags.map((name) => <Link key={name} href={`/?tag=${encodeURIComponent(name)}`}>#{name}</Link>)}
          </div>}
          {visibleDocument.locked ? <div className="locked-post"><p>이 문서는 관리자만 볼 수 있습니다.</p></div> :
            <>{reading && <ProjectBody body={visibleDocument.body ?? ""} postId={visibleDocument.id} reading={reading} />}
              <PostBacklinks key={documentSlug} slug={documentSlug} /></>}
          {confirmDelete === "document" && <div className="inline-confirm" role="alertdialog" aria-label="문서 삭제 확인">
            <p>“{visibleDocument.title}” 문서를 삭제합니다.</p><button type="button" className="small-button" onClick={() => setConfirmDelete(null)}>취소</button>
            <button type="button" className="small-button danger-button" disabled={orderBusy}
              onClick={() => void remove(detail.project.id, visibleDocument.id)}>삭제</button></div>}
          </>}
      </>}
    </article>
    {visibleDocument && !visibleDocument.locked && selectedIndex >= 0 && <nav className="project-document-neighbors"
      aria-label="이전·다음 문서">
      {documents[selectedIndex - 1] && <Link href={toDocument(documents[selectedIndex - 1])}><span>← 이전 문서</span>
        <strong>{selectedIndex}. {documents[selectedIndex - 1].title}</strong></Link>}
      {documents[selectedIndex + 1] && <Link href={toDocument(documents[selectedIndex + 1])}><span>다음 문서 →</span>
        <strong>{selectedIndex + 2}. {documents[selectedIndex + 1].title}</strong></Link>}
    </nav>}
  </main>;
}

/** 기존 쿼리의 중복·형식을 검사하고 생성된 공개 주소가 있으면 이동한다. {@link ProjectReader} */
export function ProjectReader() {
  const params = useSearchParams();
  const auth = useAuth();
  const router = useRouter();
  const slugValues = params.getAll("slug");
  const documentValues = params.getAll("doc");
  const valid = slugValues.length === 1 && validProjectSlug(slugValues[0]) && documentValues.length <= 1 &&
    (!documentValues.length || validProjectSlug(documentValues[0])) &&
    [...params.keys()].every((key) => key === "slug" || key === "doc");
  useEffect(() => {
    if (!valid) return;
    const canonical = publicProjectPath(slugValues[0], documentValues[0]);
    if (!canonical.startsWith("/project/?")) router.replace(`${canonical}${window.location.hash}`);
  }, [router, valid, slugValues[0], documentValues[0]]);
  if (!valid) return <main id="main-content" className="page-container project-page"><h1>프로젝트 주소를 확인해 주세요</h1>
    <Link href="/projects/">Projects 목록으로 돌아가기</Link></main>;
  return <ProjectShell key={`${auth.epoch}:${slugValues[0]}`} slug={slugValues[0]}
    documentSlug={documentValues[0] ?? null} />;
}

/** 생성된 프로젝트 대문 또는 문서를 서버 HTML부터 표시하고 현재 권한으로 다시 조회한다. {@link StaticProjectReader} */
export function StaticProjectReader({ detail, document }: { detail: ProjectDetail; document?: PostDetail }) {
  const auth = useAuth();
  const slug = detail.project.slug;
  return <ProjectShell key={`${auth.epoch}:${slug}:${document?.slug ?? ""}`} slug={slug}
    documentSlug={document?.slug ?? null} initialDetail={detail} initialDocument={document} />;
}
