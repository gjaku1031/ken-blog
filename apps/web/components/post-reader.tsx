"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ApiFailure, apiFailureMessage, apiJson, parsePostDetail, type PostDetail } from "@/lib/api";
import { useAuth } from "./auth-provider";
import { SafeMarkdown } from "./safe-markdown";
import { buildReadingDocument } from "@/lib/reading-document";
import { TableOfContents } from "./table-of-contents";
import { PostBacklinks } from "./post-backlinks";

type DetailState = { status: "loading" | "ready" | "error"; post: PostDetail | null; privatePost: boolean; error: string };

/** 같은 세션 세대의 실제 공개 상세와 익명 접근 범위를 함께 확인한다. */
function ReaderInstance({ slug }: { slug: string }) {
  const { status, user, readCredentials, refresh } = useAuth();
  const [state, setState] = useState<DetailState>({ status: "loading", post: null, privatePost: false, error: "" });
  const [retry, setRetry] = useState(0);
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
        let privatePost = post.locked;
        if (credentials === "include" && !post.locked) {
          const guest = parsePostDetail(await apiJson<unknown>(path, "omit", controller.signal));
          privatePost = guest.locked;
        }
        if (live) setState({ status: "ready", post, privatePost, error: "" });
      } catch (error) {
        if (error instanceof ApiFailure && error.status === 401) void refresh();
        if (live) setState({ status: "error", post: null, privatePost: false, error: apiFailureMessage(error) });
      }
    })();
    return () => { live = false; controller.abort(); };
  }, [status, readCredentials, refresh, slug, retry]);

  return <main id="main-content" className="post-page page-container">
    <Link href="/tech/" className="back-link">← Tech</Link>
    {state.status === "loading" && <div className="message-card card" role="status">글을 불러오고 있습니다…</div>}
    {state.status === "error" && <div className="message-card card" role="alert">{state.error}<br />
      <button type="button" className="small-button" onClick={() => { setState({ status: "loading", post: null, privatePost: false, error: "" }); setRetry((n) => n + 1); }}>다시 시도</button></div>}
    {state.status === "ready" && state.post && <article>
      <div className="post-overline">Tech{state.post.category ? ` · ${state.post.category.path.replaceAll("/", " › ")}` : ""}</div>
      <h1>{state.post.title}</h1>
      <div className="detail-meta"><time className="mono" dateTime={state.post.publishedDate}>{state.post.publishedDate.replaceAll("-", ".")}</time>
        <span aria-label="열람 범위">{state.privatePost ? "로그인 회원 공개" : "전체 공개"}</span>
        {status === "authenticated" && user?.role === "ADMIN" &&
          <Link href={`/write/?postId=${state.post.id}`}>편집본 만들기</Link>}</div>
      {!state.post.locked && <div className="tag-list detail-tags">{state.post.tags.map((name) => <Link key={name}
        href={`/tech/?tag=${encodeURIComponent(name)}`}>#{name}</Link>)}</div>}
      {state.post.locked ? <div className="locked-post card"><h2>로그인이 필요한 글입니다</h2>
        <p>제목과 날짜만 볼 수 있습니다. 본문과 분류·태그는 로그인 후 표시됩니다.</p>
        <Link className="primary-button" href={`/login/?returnTo=${encodeURIComponent(`/post/?slug=${slug}`)}`}>로그인</Link></div> :
        <div className={reading?.toc.length ? "post-reading-layout has-toc" : "post-reading-layout"}>
          <div className="post-main-content">
            <SafeMarkdown body={state.post.body ?? ""} source={{ kind: "post", postId: state.post.id }} reading={reading ?? undefined} />
            <PostBacklinks slug={slug} />
          </div>
          {reading && <TableOfContents items={reading.toc} />}
        </div>}
    </article>}
  </main>;
}

/** 정적 `/post/` 경로의 slug 쿼리를 검증하고 세션 변경 시 상세 데이터를 폐기한다. */
export function PostReader() {
  const slug = useSearchParams().get("slug") ?? "";
  const auth = useAuth();
  if (!slug || slug.length > 160 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    return <main id="main-content" className="post-page page-container"><h1>글 주소를 확인해 주세요</h1>
      <Link href="/tech/">Tech 글 목록으로 돌아가기</Link></main>;
  }
  return <ReaderInstance key={`${auth.epoch}:${slug}`} slug={slug} />;
}
