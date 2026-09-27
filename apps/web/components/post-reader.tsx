"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ApiFailure, apiFailureMessage, apiJson, parseCategories, parsePostDetail, postDestination, recordPostView, type PostDetail } from "@/lib/api";
import { categoryLabelPath } from "@/lib/category-label";
import { useAuth } from "./auth-provider";
import { SafeMarkdown } from "./safe-markdown";
import { buildReadingDocument } from "@/lib/reading-document";
import { TableOfContents } from "./table-of-contents";
import { PostBacklinks } from "./post-backlinks";
import { PublicAnalytics } from "./public-analytics";
import { readPinnedIds } from "@/lib/feed";

type DetailState = { status: "loading" | "ready" | "error"; post: PostDetail | null; privatePost: boolean; error: string };

/** 실제 본문 글자 수로 원본의 500자당 1분 규칙을 계산한다. {@link readingMinutes} */
function readingMinutes(body: string): number {
  return Math.max(1, Math.round(body.length / 500));
}

/** 같은 세션 세대의 실제 공개 상세와 익명 접근 범위를 함께 확인한다. {@link ReaderInstance} */
function ReaderInstance({ slug }: { slug: string }) {
  const { status, user, readCredentials, refresh, adminWrite } = useAuth();
  const router = useRouter();
  const [state, setState] = useState<DetailState>({ status: "loading", post: null, privatePost: false, error: "" });
  const [retry, setRetry] = useState(0);
  const viewed = useRef<number | null>(null);
  const [viewCount, setViewCount] = useState<number | null>(null);
  const [pinState, setPinState] = useState<boolean | null>(null);
  const [pinBusy, setPinBusy] = useState(false);
  const [pinError, setPinError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [categoryLabel, setCategoryLabel] = useState<string | null>(null);
  const reading = useMemo(() => state.status === "ready" && state.post && !state.post.locked ?
    buildReadingDocument(state.post.body ?? "") : null, [state]);

  useEffect(() => {
    if (status === "checking") return;
    let live = true;
    const controller = new AbortController();
    void (async () => {
      try {
        const credentials = await readCredentials(controller.signal);
        const path = `/api/v1/posts/${encodeURIComponent(slug)}`;
        const post = parsePostDetail(await apiJson<unknown>(path, credentials, controller.signal));
        if (post.section !== "TECH") {
          if (live) router.replace(postDestination(post));
          return;
        }
        let privatePost = post.locked;
        if (credentials === "include" && !post.locked) {
          const guest = parsePostDetail(await apiJson<unknown>(path, "omit", controller.signal));
          privatePost = guest.locked;
        }
        if (live) setState({ status: "ready", post, privatePost, error: "" });
        if (post.category && !post.locked) void apiJson<unknown>("/api/v1/categories", credentials, controller.signal)
          .then(parseCategories).then((nodes) => { if (live) setCategoryLabel(categoryLabelPath(nodes, post.category!.id)); })
          .catch(() => undefined);
      } catch (error) {
        if (error instanceof ApiFailure && error.status === 401) void refresh();
        if (live) setState({ status: "error", post: null, privatePost: false, error: apiFailureMessage(error) });
      }
    })();
    return () => { live = false; controller.abort(); };
  }, [status, readCredentials, refresh, slug, retry, router]);

  useEffect(() => {
    const post = state.post;
    if (state.status !== "ready" || !post || post.locked || viewed.current === post.id) return;
    viewed.current = post.id;
    void recordPostView(post.id).then(setViewCount).catch(() => undefined);
  }, [state]);

  /** 서버의 전체 핀 순서를 사용해 현재 글의 고정 여부를 변경한다. {@link togglePin} */
  async function togglePin(post: PostDetail) {
    if (pinBusy) return;
    setPinBusy(true); setPinError("");
    try {
      const ids = await readPinnedIds(await readCredentials());
      const index = ids.indexOf(post.id);
      if (index < 0) ids.push(post.id); else ids.splice(index, 1);
      await adminWrite("PUT", "/api/v1/admin/pins", { postIds: ids });
      setPinState(index < 0);
    } catch (failure) { setPinError(apiFailureMessage(failure)); }
    finally { setPinBusy(false); }
  }

  /** 확인한 Tech 글만 삭제하고 목록으로 이동한다. {@link deletePost} */
  async function deletePost(post: PostDetail) {
    if (deleteBusy) return;
    setDeleteBusy(true); setDeleteError("");
    try { await adminWrite("DELETE", `/api/v1/admin/posts/${post.id}`); router.replace("/tech/"); }
    catch (failure) { setDeleteError(apiFailureMessage(failure)); setDeleteBusy(false); }
  }

  const series = state.post?.series;
  const previous = series?.items[(series.position ?? 0) - 2];
  const next = series?.items[series.position ?? 0];

  return <main id="main-content" className="post-page page-container">
    <Link href={state.post?.relatedProject ? `/project/?slug=${encodeURIComponent(state.post.relatedProject.slug)}` : "/tech/"}
      className="back-link">← {state.post?.relatedProject?.name ?? "Tech"}</Link>
    {state.status === "loading" && <div className="message-card card" role="status">글을 불러오고 있습니다…</div>}
    {state.status === "error" && <div className="message-card card" role="alert">{state.error}<br />
      <button type="button" className="small-button" onClick={() => { setState({ status: "loading", post: null, privatePost: false, error: "" }); setRetry((n) => n + 1); }}>다시 시도</button></div>}
    {state.status === "ready" && state.post && <article>
      {!state.privatePost && !state.post.locked && <PublicAnalytics virtualPath={`/post/${state.post.slug}`} />}
      <div className="post-overline"><Link href="/tech/">Tech</Link>{state.post.category && <>
        <span>·</span><Link href={`/?categoryId=${state.post.category.id}`}>{categoryLabel ?? state.post.category.name}</Link></>}
        {state.post.relatedProject && <><span>·</span><Link href={`/project/?slug=${encodeURIComponent(state.post.relatedProject.slug)}`}>
          {state.post.relatedProject.name}</Link></>}
        {state.privatePost && <span className="private-label">· 비공개</span>}</div>
      <h1>{state.post.title}</h1>
      <div className="detail-meta"><time className="mono" dateTime={state.post.publishedDate}>{state.post.publishedDate.replaceAll("-", ".")}</time>
        {!state.post.locked && <span>· {readingMinutes(state.post.body ?? "")}분</span>}
        {(viewCount ?? state.post.viewCount) != null && <span>· 조회 {(viewCount ?? state.post.viewCount)?.toLocaleString("ko-KR")}</span>}
        {status === "authenticated" && user?.role === "ADMIN" && <>
          <button type="button" className="detail-pin-button" disabled={pinBusy} onClick={() => void togglePin(state.post!)}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
              strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 3h6l-1 6 3 3v2H7v-2l3-3-1-6ZM12 14v7" /></svg>
            {(pinState ?? state.post.pinOrder !== null) ? "핀 해제" : "핀 고정"}</button>
          <Link href={`/write/?postId=${state.post.id}`}>수정</Link>
          <button type="button" className="danger-text" onClick={() => setDeleting(true)}>삭제</button></>}</div>
      {pinError && <p role="alert" className="inline-error">{pinError}</p>}
      {deleting && <div className="inline-confirm" role="alertdialog" aria-label="Tech 글 삭제 확인"><p>“{state.post.title}” 글을 삭제할까요?</p>
        <button type="button" className="small-button" onClick={() => setDeleting(false)}>취소</button>
        <button type="button" className="small-button danger-button" disabled={deleteBusy}
          onClick={() => void deletePost(state.post!)}>삭제</button></div>}
      {deleteError && <p role="alert" className="inline-error">{deleteError}</p>}
      {!state.post.locked && <div className="tag-list detail-tags">{state.post.tags.map((name) => <Link key={name}
        href={`/tech/?tag=${encodeURIComponent(name)}`}>#{name}</Link>)}</div>}
      {state.post.locked ? <div className="locked-post card"><h2>로그인이 필요한 글입니다</h2>
        <p>제목과 날짜만 볼 수 있습니다. 본문과 분류·태그는 로그인 후 표시됩니다.</p>
        <Link className="primary-button" href={`/login/?returnTo=${encodeURIComponent(`/post/?slug=${slug}`)}`}>로그인</Link></div> :
        <div className={reading?.toc.length || series ? "post-reading-layout has-toc" : "post-reading-layout"}>
          <div className="post-main-content">
            <SafeMarkdown body={state.post.body ?? ""} source={{ kind: "post", postId: state.post.id }} reading={reading ?? undefined} />
            <PostBacklinks slug={slug} />
            {series && <nav className="series-previous-next" aria-label="시리즈 이전 글과 다음 글">
              {previous ? <Link href={`/post/?slug=${encodeURIComponent(previous.slug)}`}><span>← 이전 글 · {series.position - 1}편</span>
                <strong>{previous.title}</strong></Link> : <span />}
              {next ? <Link href={`/post/?slug=${encodeURIComponent(next.slug)}`}><span>다음 글 · {series.position + 1}편 →</span>
                <strong>{next.title}</strong></Link> : <span className="series-end">시리즈의 마지막 글입니다</span>}
            </nav>}
          </div>
          {(reading?.toc.length || series) && <aside className="post-side-rail">
            {reading && <TableOfContents items={reading.toc} />}
            {series && <nav className="series-nav" aria-label="시리즈 글 목록"><h2>시리즈 · {state.post.category?.name ?? "Tech"}
              <span>{series.position}/{series.items.length}</span></h2>
              <ol>{series.items.map((item) => <li key={item.id}><Link href={`/post/?slug=${encodeURIComponent(item.slug)}`}
                aria-current={item.id === state.post?.id ? "page" : undefined}><span className="series-number">{item.order}</span>
                <span>{item.title}</span></Link></li>)}</ol></nav>}
          </aside>}
        </div>}
    </article>}
  </main>;
}

/** 정적 `/post/` 경로의 slug 쿼리를 검증하고 세션 변경 시 상세 데이터를 폐기한다. {@link PostReader} */
export function PostReader() {
  const slug = useSearchParams().get("slug") ?? "";
  const auth = useAuth();
  if (!slug || slug.length > 160 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    return <main id="main-content" className="post-page page-container"><h1>글 주소를 확인해 주세요</h1>
      <Link href="/tech/">Tech 글 목록으로 돌아가기</Link></main>;
  }
  return <ReaderInstance key={`${auth.epoch}:${slug}`} slug={slug} />;
}
