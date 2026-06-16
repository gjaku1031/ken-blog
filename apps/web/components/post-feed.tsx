"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiFailure, apiFailureMessage, apiJson, parseCategories, parsePostPage, parseTags,
  type CategoryNode, type PostPage, type PostSummary, type TagCount } from "@/lib/api";
import { useAuth } from "./auth-provider";

type FeedMode = "home" | "tech";
type FeedState = { status: "loading" | "ready" | "error"; items: PostSummary[]; page: number; total: number; totalPages: number;
  categories: CategoryNode[]; tags: TagCount[]; error: string };

/** 현재 필터를 유지하거나 해제하는 정적 페이지 URL을 만든다. */
function filterHref(mode: FeedMode, categoryId: number | null, tag: string | null): string {
  const params = new URLSearchParams();
  if (categoryId !== null) params.set("categoryId", String(categoryId));
  if (tag !== null) params.set("tag", tag);
  const base = mode === "home" ? "/" : "/tech/";
  return params.size ? `${base}?${params}` : base;
}

/** 선택한 분류의 경로를 현재 권한 트리에서 찾는다. */
function categoryPath(nodes: CategoryNode[], id: number): string | null {
  for (const node of nodes) {
    if (node.id === id) return node.path.replaceAll("/", " › ");
    const nested = categoryPath(node.children, id);
    if (nested !== null) return nested;
  }
  return null;
}

/** 분류의 직접·하위 건수와 선택 상태를 계층적으로 표시한다. */
function CategoryLinks({ nodes, selected, tag, mode }: { nodes: CategoryNode[]; selected: number | null; tag: string | null; mode: FeedMode }) {
  return <ul className="category-tree">{nodes.map((node) => <li key={node.id}>
    <Link href={filterHref(mode, node.id, tag)} aria-current={selected === node.id ? "page" : undefined}>
      <span>{node.name}</span><span className="mono side-count">{node.totalCount}</span>
    </Link>
    {node.children.length > 0 && <CategoryLinks nodes={node.children} selected={selected} tag={tag} mode={mode} />}
  </li>)}</ul>;
}

/** 한 글을 요약·조회수 없이 실제 목록 API의 메타데이터만으로 구성한다. */
function PostCard({ post, mode, categoryId, tag }: { post: PostSummary; mode: FeedMode; categoryId: number | null; tag: string | null }) {
  return <article className="post-card card">
    <div className="card-meta"><span>Tech</span>{post.category && <span>· {post.category.path.replaceAll("/", " › ")}</span>}</div>
    {mode === "tech" ? <h2><Link href={`/post/?slug=${encodeURIComponent(post.slug)}`}>{post.title}</Link></h2> :
      <h3><Link href={`/post/?slug=${encodeURIComponent(post.slug)}`}>{post.title}</Link></h3>}
    <div className="card-bottom">
      <div className="tag-list">{post.tags.map((name) => <Link key={name}
        href={filterHref(mode, categoryId, tag === name ? null : name)}
        aria-label={`${name} 태그로 필터`} className={tag === name ? "selected" : ""}>#{name}</Link>)}</div>
      <time className="mono" dateTime={post.publishedDate}>{post.publishedDate.replaceAll("-", ".")}</time>
    </div>
  </article>;
}

/** 세션 세대·필터별로 언마운트되는 데이터 경계. 지난 PRIVATE 응답을 다시 그리지 않는다. */
function FeedInstance({ mode, categoryId, tag }: { mode: FeedMode; categoryId: number | null; tag: string | null }) {
  const auth = useAuth();
  const { status, readCredentials, expire } = auth;
  const [state, setState] = useState<FeedState>({ status: "loading", items: [], page: 0, total: 0, totalPages: 0,
    categories: [], tags: [], error: "" });
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState("");
  const [retry, setRetry] = useState(0);
  const sentinel = useRef<HTMLDivElement>(null);
  const moreControllers = useRef(new Set<AbortController>());
  const loadingLock = useRef(false);

  useEffect(() => () => {
    moreControllers.current.forEach((controller) => controller.abort());
    moreControllers.current.clear();
  }, []);

  useEffect(() => {
    if (status === "checking") return;
    let live = true;
    const controller = new AbortController();
    void (async () => {
      try {
        const credentials = await readCredentials(controller.signal);
        const query = new URLSearchParams({ page: "0", size: "10" });
        if (categoryId !== null) query.set("categoryId", String(categoryId));
        if (tag !== null) query.set("tag", tag);
        const [pageValue, categoriesValue, tagsValue] = await Promise.all([
          apiJson<unknown>(`/api/v1/posts?${query}`, credentials, controller.signal),
          apiJson<unknown>("/api/v1/categories", credentials, controller.signal),
          apiJson<unknown>("/api/v1/tags", credentials, controller.signal),
        ]);
        const page = parsePostPage(pageValue);
        const categories = parseCategories(categoriesValue);
        const tags = parseTags(tagsValue);
        if (live) setState({ status: "ready", items: page.items, page: 0, total: page.totalElements,
          totalPages: page.totalPages, categories, tags, error: "" });
      } catch (error) {
        if (error instanceof ApiFailure && error.status === 401) expire();
        if (live) setState((previous) => ({ ...previous, status: "error", items: [], error: apiFailureMessage(error) }));
      }
    })();
    return () => { live = false; controller.abort(); };
  }, [status, readCredentials, expire, categoryId, tag, retry]);

  /** 다음 페이지를 붙이되 세션 변화로 언마운트되면 늦은 결과를 버린다. */
  const loadMore = useCallback(async () => {
    if (loadingLock.current || state.page + 1 >= state.totalPages) return;
    loadingLock.current = true;
    const nextPage = state.page + 1;
    const controller = new AbortController();
    moreControllers.current.add(controller);
    setLoadingMore(true);
    setMoreError("");
    try {
      const credentials = await readCredentials(controller.signal);
      const query = new URLSearchParams({ page: String(nextPage), size: "10" });
      if (categoryId !== null) query.set("categoryId", String(categoryId));
      if (tag !== null) query.set("tag", tag);
      const page = parsePostPage(await apiJson<unknown>(`/api/v1/posts?${query}`, credentials, controller.signal));
      setState((previous) => ({ ...previous, items: [...previous.items, ...page.items], page: nextPage,
        total: page.totalElements, totalPages: page.totalPages }));
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 401) expire();
      if (!controller.signal.aborted) setMoreError(apiFailureMessage(error));
    } finally {
      moreControllers.current.delete(controller);
      loadingLock.current = false;
      if (!controller.signal.aborted) setLoadingMore(false);
    }
  }, [state.page, state.totalPages, readCredentials, expire, categoryId, tag]);

  useEffect(() => {
    if (state.status !== "ready" || moreError || state.page + 1 >= state.totalPages || !sentinel.current ||
      typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void loadMore();
    }, { rootMargin: "240px" });
    observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [state.status, state.page, state.totalPages, moreError, loadMore]);

  return <div className="content-grid">
    <section className="feed-column" aria-labelledby="feed-title">
      <div className="section-heading">{mode === "home" ? <h2 id="feed-title">최근 Tech 글</h2> : <h1 id="feed-title">Tech</h1>}
        {state.status === "ready" && <span className="mono feed-total">{state.total}개</span>}</div>
      {(categoryId !== null || tag !== null) && <div className="active-filters"><span>선택한 필터</span>
        {categoryId !== null && <Link href={filterHref(mode, null, tag)}>{categoryPath(state.categories, categoryId) ?? "선택한 분류"} ×</Link>}
        {tag !== null && <Link href={filterHref(mode, categoryId, null)}>#{tag} ×</Link>}
        <Link href={filterHref(mode, null, null)}>모두 해제</Link></div>}
      {state.status === "loading" && <div className="message-card card" role="status">글을 불러오고 있습니다…</div>}
      {state.status === "error" && <div className="message-card card" role="alert">{state.error}<br />
        <button type="button" className="small-button" onClick={() => {
          setState((previous) => ({ ...previous, status: "loading", items: [], error: "" }));
          setRetry((value) => value + 1);
        }}>다시 시도</button></div>}
      {state.status === "ready" && <>
        {state.items.length === 0 ? <div className="message-card card">현재 조건에 맞는 Tech 글이 없습니다.</div> :
          <div className="post-list">{state.items.map((post) => <PostCard key={post.id} post={post} mode={mode} categoryId={categoryId} tag={tag} />)}</div>}
        {moreError && <p className="inline-error" role="alert">{moreError}</p>}
        {state.page + 1 < state.totalPages && <button className="load-more" type="button" disabled={loadingMore} onClick={() => void loadMore()}>
          {loadingMore ? "불러오는 중…" : "글 더 보기"}</button>}
        <div ref={sentinel} className="load-sentinel" aria-hidden="true" />
      </>}
    </section>
    <aside className="feed-sidebar" aria-label="Tech 탐색">
      <section className="side-card card"><h2>분류</h2>
        {state.status === "ready" && (state.categories.length ? <CategoryLinks nodes={state.categories} selected={categoryId} tag={tag} mode={mode} /> :
          <p className="side-empty">등록된 분류가 없습니다.</p>)}
        {state.status !== "ready" && <p className="side-empty">목록과 함께 불러옵니다.</p>}
      </section>
      <section className="side-card card"><h2>태그</h2>
        {state.status === "ready" && (state.tags.length ? <div className="tag-cloud">{state.tags.map((item) =>
          <Link key={item.name} href={filterHref(mode, categoryId, tag === item.name ? null : item.name)}
            className={tag === item.name ? "selected" : ""}>#{item.name} <span className="sr-only">글 {item.count}개</span></Link>)}</div> :
          <p className="side-empty">등록된 태그가 없습니다.</p>)}
        {state.status !== "ready" && <p className="side-empty">목록과 함께 불러옵니다.</p>}
      </section>
    </aside>
  </div>;
}

/** URL 필터와 인증 세대가 바뀔 때 목록 인스턴스를 새로 만들어 오래된 권한 데이터를 폐기한다. */
export function PostFeed({ mode }: { mode: FeedMode }) {
  const params = useSearchParams();
  const auth = useAuth();
  const rawCategory = params.get("categoryId");
  const categoryId = rawCategory === null ? null : Number(rawCategory);
  const tag = params.get("tag");
  if (rawCategory !== null && (categoryId === null || !Number.isSafeInteger(categoryId) || categoryId <= 0)) {
    return <div className="message-card card" role="alert">분류 주소가 올바르지 않습니다.</div>;
  }
  return <FeedInstance key={`${auth.epoch}:${mode}:${categoryId}:${tag}`} mode={mode} categoryId={categoryId} tag={tag} />;
}
