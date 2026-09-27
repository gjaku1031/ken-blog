"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiFailure, apiFailureMessage, apiJson, parseCategories, parseTags, postDestination,
  type CategoryNode, type TagCount } from "@/lib/api";
import { parseFeedPage, readPinnedIds, type FeedItem, type FeedPage } from "@/lib/feed";
import { useAuth } from "./auth-provider";

type FeedMode = "home" | "tech";
type FeedSort = "new" | "pin";
type FeedState = { status: "loading" | "ready" | "error"; items: FeedItem[]; page: number;
  total: number; pages: number; categories: CategoryNode[]; tags: TagCount[]; error: string };
const feedCache = new Map<string, FeedState>();
const categoryExpansion = new Map<number, boolean>();

/** 필터와 정렬을 쿼리 문자열로 보존하는 정적 페이지 주소를 만든다. */
function feedHref(mode: FeedMode, categoryId: number | null, tag: string | null, sort: FeedSort): string {
  const params = new URLSearchParams();
  if (categoryId !== null) params.set("categoryId", String(categoryId));
  if (tag) params.set("tag", tag);
  if (sort === "pin") params.set("sort", "pin");
  return `${mode === "home" ? "/" : "/tech/"}${params.size ? `?${params}` : ""}`;
}

/** 현재 권한 트리에서 선택한 분류 경로를 찾는다. */
function categoryPath(nodes: CategoryNode[], id: number): string | null {
  for (const node of nodes) {
    if (node.id === id) return node.path.replaceAll("/", " › ");
    const nested = categoryPath(node.children, id); if (nested) return nested;
  }
  return null;
}

/** 선택 분류가 하위 노드에 있는지 확인해 접힌 트리의 현재 위치를 보존한다. */
function containsCategory(node: CategoryNode, selected: number | null): boolean {
  return selected !== null && (node.id === selected || node.children.some((child) => containsCategory(child, selected)));
}

/** {@link CategoryNode}의 하위 분류를 독립적으로 펼치고 직접·전체 건수를 전환한다. */
function CategoryLinkItem({ node, selected, tag, mode, sort }: { node: CategoryNode; selected: number | null;
  tag: string | null; mode: FeedMode; sort: FeedSort }) {
  const [expanded, setExpanded] = useState(() => categoryExpansion.get(node.id) ?? containsCategory(node, selected));
  return <li><div className="category-line"><Link
    href={feedHref("home", selected === node.id ? null : node.id, tag, sort)} aria-current={selected === node.id ? "page" : undefined}
    onClick={() => { if (selected !== node.id) { categoryExpansion.set(node.id, true); setExpanded(true); } }}>
    <span>{node.name}</span>{(!expanded || node.directCount > 0) &&
      <span className="mono side-count">{expanded ? node.directCount : node.totalCount}</span>}</Link>
    {node.children.length > 0 && <button type="button" aria-expanded={expanded} aria-label={`${node.name} 하위 분류 ${expanded ? "접기" : "펼치기"}`}
      onClick={() => setExpanded((current) => { categoryExpansion.set(node.id, !current); return !current; })}>
      {expanded ? "▾" : "▸"}</button>}</div>
    {expanded && node.children.length > 0 && <CategoryLinks nodes={node.children} selected={selected} tag={tag} mode={mode} sort={sort} />}</li>;
}

/** 현재 권한의 분류 트리를 같은 깊이의 목록으로 표시한다. */
function CategoryLinks({ nodes, selected, tag, mode, sort }: { nodes: CategoryNode[]; selected: number | null;
  tag: string | null; mode: FeedMode; sort: FeedSort }) {
  return <ul className="category-tree">{nodes.map((node) => <CategoryLinkItem key={node.id} node={node}
    selected={selected} tag={tag} mode={mode} sort={sort} />)}</ul>;
}

/** 섹션 소속과 실제 요약·회차 번호·권한을 카드에 표시한다. */
export function FeedCard({ post, mode, categoryId, tag, sort, pinAction, pinDrop, onPinDragStart }: { post: FeedItem; mode: FeedMode;
  categoryId: number | null; tag: string | null; sort: FeedSort;
  pinAction?: (post: FeedItem, direction?: -1 | 1) => void; pinDrop?: (target: FeedItem) => void;
  onPinDragStart?: (post: FeedItem) => void }) {
  const href = postDestination(post);
  const category = post.category?.path.replaceAll("/", " › ");
  return <article className="post-card card" draggable={!!pinDrop} onDragStart={(event) => {
    if (!pinDrop) return; onPinDragStart?.(post); event.dataTransfer.setData("text/plain", String(post.id)); event.dataTransfer.effectAllowed = "move";
  }} onDragOver={(event) => { if (pinDrop) event.preventDefault(); }} onDrop={(event) => {
    if (!pinDrop) return; event.preventDefault(); pinDrop(post);
  }}><div className="card-meta"><span>{post.section === "TECH" ? "Tech" :
    post.section === "NOTE_CHAPTER" ? "Notes" : "Projects"}</span>
    {category && <span>· {category}</span>}
    {post.section === "TECH" && post.seriesPosition && post.seriesTotal &&
      <span>· 시리즈 {post.seriesPosition}/{post.seriesTotal}</span>}
    {post.section === "NOTE_CHAPTER" && post.chapterPosition && <span>· {post.chapterPosition}강 / {post.chapterTotal}</span>}
    {post.visibility === "PRIVATE" && <span>· 비공개</span>}{post.pinOrder !== null && <span>· 고정</span>}</div>
    <h2><Link href={href}>{post.title}</Link></h2>
    {post.summary && <p className="post-summary">{post.summary}</p>}
    <div className="card-bottom"><div className="tag-list">{post.tags.map((name) => <Link key={name}
      href={feedHref(mode, categoryId, tag === name ? null : name, sort)}>#{name}</Link>)}</div>
      <time className="mono" dateTime={post.publishedDate}>{post.publishedDate.replaceAll("-", ".")}</time></div>
    {pinAction && <div className="card-pin-controls"><button type="button" onClick={() => pinAction(post)}>
      {post.pinOrder === null ? "핀 고정" : "핀 해제"}</button>{sort === "pin" && <>
        <button type="button" aria-label={`${post.title} 위로`} onClick={() => pinAction(post, -1)}>▲</button>
        <button type="button" aria-label={`${post.title} 아래로`} onClick={() => pinAction(post, 1)}>▼</button></>}</div>}
  </article>;
}

/** 필터·세션마다 새로 요청하고 다음 10개를 뷰포트 근처에서 이어 붙인다. */
function FeedInstance({ mode, categoryId, tag, sort }: { mode: FeedMode; categoryId: number | null; tag: string | null; sort: FeedSort }) {
  const auth = useAuth();
  const cacheKey = `${auth.epoch}:${mode}:${categoryId}:${tag}:${sort}`;
  const [state, setState] = useState<FeedState>(() => feedCache.get(cacheKey) ?? { status: "loading", items: [], page: 0,
    total: 0, pages: 0, categories: [], tags: [], error: "" });
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState("");
  const [retry, setRetry] = useState(0);
  const [pinBusy, setPinBusy] = useState(false);
  const [pinError, setPinError] = useState("");
  const sentinel = useRef<HTMLDivElement>(null);
  const loadingLock = useRef(false);
  const dragged = useRef<number | null>(null);
  const section = mode === "home" ? "all" : "tech";
  const query = useCallback((page: number) => {
    const params = new URLSearchParams({ section, sort, page: String(page), size: "10" });
    if (categoryId !== null) params.set("categoryId", String(categoryId));
    if (tag) params.set("tag", tag);
    return `/api/v1/feed?${params}`;
  }, [section, sort, categoryId, tag]);

  useEffect(() => {
    if (auth.status === "checking") return;
    if (retry === 0 && feedCache.has(cacheKey)) return;
    const controller = new AbortController();
    setState((current) => ({ ...current, status: "loading", items: [], error: "" }));
    void (async () => {
      try {
        const credentials = await auth.readCredentials(controller.signal);
        const [feed, categories, tags] = await Promise.all([
          apiJson<unknown>(query(0), credentials, controller.signal),
          apiJson<unknown>("/api/v1/categories", credentials, controller.signal),
          apiJson<unknown>("/api/v1/tags", credentials, controller.signal),
        ]);
        const page = parseFeedPage(feed);
        if (!controller.signal.aborted) setState({ status: "ready", items: page.items, page: 0,
          total: page.totalElements, pages: page.totalPages, categories: parseCategories(categories),
          tags: parseTags(tags), error: "" });
      } catch (failure) {
        if (controller.signal.aborted) return;
        if (failure instanceof ApiFailure && failure.status === 401) auth.expire();
        setState((current) => ({ ...current, status: "error", items: [], error: apiFailureMessage(failure) }));
      }
    })();
    return () => controller.abort();
  }, [auth.status, auth.epoch, auth.readCredentials, auth.expire, query, retry, cacheKey]);

  useEffect(() => {
    if (state.status !== "ready") return;
    if (feedCache.size >= 24 && !feedCache.has(cacheKey)) feedCache.delete(feedCache.keys().next().value!);
    feedCache.set(cacheKey, state);
  }, [cacheKey, state]);

  /** 다음 {@link FeedPage}를 현재 필터의 마지막 페이지 뒤에만 추가한다. */
  const loadMore = useCallback(async () => {
    if (loadingLock.current || state.page + 1 >= state.pages) return;
    loadingLock.current = true; setLoadingMore(true); setMoreError("");
    try {
      const credentials = await auth.readCredentials();
      const next = parseFeedPage(await apiJson<unknown>(query(state.page + 1), credentials));
      setState((current) => ({ ...current, items: [...current.items, ...next.items], page: next.page,
        total: next.totalElements, pages: next.totalPages }));
    } catch (failure) { setMoreError(apiFailureMessage(failure)); }
    finally { loadingLock.current = false; setLoadingMore(false); }
  }, [auth, state.page, state.pages, query]);

  useEffect(() => {
    if (state.status !== "ready" || state.page + 1 >= state.pages || moreError || !sentinel.current ||
      typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) void loadMore(); },
      { rootMargin: "300px" });
    observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [state.status, state.page, state.pages, moreError, loadMore]);

  /** 서버의 전체 핀 순서를 기준으로 고정·해제·위아래 이동을 원자적으로 저장한다. */
  async function changePin(post: FeedItem, direction?: -1 | 1) {
    if (pinBusy) return;
    setPinBusy(true); setPinError("");
    try {
      const credentials = await auth.readCredentials();
      const ids = await readPinnedIds(credentials);
      const current = ids.indexOf(post.id);
      if (direction === undefined) {
        if (current < 0) ids.push(post.id); else ids.splice(current, 1);
      } else if (current >= 0 && current + direction >= 0 && current + direction < ids.length) {
        [ids[current], ids[current + direction]] = [ids[current + direction], ids[current]];
      } else return;
      await auth.adminWrite("PUT", "/api/v1/admin/pins", { postIds: ids });
      setRetry((value) => value + 1);
    } catch (failure) { setPinError(apiFailureMessage(failure)); }
    finally { setPinBusy(false); }
  }

  /** 드래그 대상의 전체 핀 순서를 다시 읽고 놓은 카드 앞에 이동한다. */
  async function dropPin(target: FeedItem) {
    const movedId = dragged.current;
    dragged.current = null;
    if (pinBusy || movedId === null || movedId === target.id) return;
    setPinBusy(true); setPinError("");
    try {
      const credentials = await auth.readCredentials();
      const ids = await readPinnedIds(credentials);
      const source = ids.indexOf(movedId);
      if (source < 0 || !ids.includes(target.id)) return;
      ids.splice(source, 1);
      ids.splice(ids.indexOf(target.id), 0, movedId);
      await auth.adminWrite("PUT", "/api/v1/admin/pins", { postIds: ids });
      setRetry((value) => value + 1);
    } catch (failure) { setPinError(apiFailureMessage(failure)); }
    finally { setPinBusy(false); }
  }

  return <div className="content-grid"><section className="feed-column" aria-labelledby="feed-title">
    <div className="section-heading"><h2 id="feed-title">{mode === "home" ? sort === "pin" ? "고정한 글" : "최근 글" :
      sort === "pin" ? "Tech · 고정한 글" : "Tech"}</h2>
      {state.status === "ready" && <span className="mono feed-total">{state.total}편</span>}
      {mode === "tech" && auth.user?.role === "ADMIN" && <Link href="/write/" className="feed-write-link">+ 글쓰기</Link>}
      <nav className="feed-sort" aria-label="글 정렬"><Link href={feedHref(mode, categoryId, tag, "new")}
        aria-current={sort === "new" ? "page" : undefined}>최신</Link><Link href={feedHref(mode, categoryId, tag, "pin")}
        aria-current={sort === "pin" ? "page" : undefined}>핀</Link></nav></div>
    {(categoryId !== null || tag) && <div className="active-filters">
      {categoryId !== null && <Link href={feedHref(mode, null, tag, sort)}>{categoryPath(state.categories, categoryId) ?? "분류"} ×</Link>}
      {tag && <Link href={feedHref(mode, categoryId, null, sort)}>#{tag} ×</Link>}
      <Link href={feedHref(mode, null, null, sort)}>필터 해제</Link></div>}
    {state.status === "loading" && <div className="message-card card" role="status">글을 불러오고 있습니다…</div>}
    {state.status === "error" && <div className="message-card card" role="alert">{state.error}<br />
      <button type="button" className="small-button" onClick={() => setRetry((value) => value + 1)}>다시 시도</button></div>}
    {pinError && <p role="alert" className="inline-error">{pinError}</p>}
    {sort === "pin" && auth.user?.role === "ADMIN" && state.items.length > 1 &&
      <p className="pin-order-help">카드를 끌거나 ▲ ▼ 버튼으로 고정 순서를 바꿀 수 있습니다.</p>}
    {state.status === "ready" && <>{state.items.length ? <div className="post-list">{state.items.map((post) => <FeedCard
      key={post.id} post={post} mode={mode} categoryId={categoryId} tag={tag} sort={sort}
      pinAction={auth.user?.role === "ADMIN" && !pinBusy ? (item, direction) => void changePin(item, direction) : undefined}
      pinDrop={auth.user?.role === "ADMIN" && sort === "pin" && !pinBusy ? (target) => void dropPin(target) : undefined}
      onPinDragStart={auth.user?.role === "ADMIN" && sort === "pin" && !pinBusy ? (item) => { dragged.current = item.id; } : undefined} />)}</div> :
      <div className="message-card card">{sort === "pin" ? "고정한 글이 없습니다." : "아직 글이 없습니다."}</div>}
      {moreError && <p role="alert" className="inline-error">{moreError}</p>}
      {state.page + 1 < state.pages && <button type="button" className="load-more" disabled={loadingMore}
        onClick={() => void loadMore()}>{loadingMore ? "불러오는 중…" : "글 더 보기"}</button>}
      <div ref={sentinel} className="load-sentinel" aria-hidden="true" /></>}
  </section><aside className="feed-sidebar" aria-label="Tech 탐색"><section className="side-card card"><h2>분류</h2>
    {state.status === "ready" && <CategoryLinks nodes={state.categories} selected={categoryId} tag={tag} mode={mode} sort={sort} />}</section>
    <section className="side-card card"><h2>태그</h2><div className="tag-cloud">{state.tags.map((item) => <Link key={item.name}
      href={feedHref(mode, categoryId, tag === item.name ? null : item.name, sort)}>#{item.name}</Link>)}</div></section>
  </aside></div>;
}

/** URL 필터와 권한 세대가 달라지면 이전 PRIVATE 피드 응답을 버린다. */
export function PostFeed({ mode }: { mode: FeedMode }) {
  const params = useSearchParams();
  const auth = useAuth();
  const rawCategory = params.get("categoryId");
  const categoryId = rawCategory === null ? null : Number(rawCategory);
  const tag = params.get("tag");
  const rawSort = params.get("sort");
  const sort = rawSort === "pin" ? "pin" : "new";
  if ([...params.keys()].some((key) => !["categoryId", "tag", "sort"].includes(key)) ||
    rawCategory !== null && (!Number.isSafeInteger(categoryId) || categoryId === null || categoryId <= 0) ||
    rawSort !== null && rawSort !== "new" && rawSort !== "pin") {
    return <div className="message-card card" role="alert">피드 주소가 올바르지 않습니다.</div>;
  }
  return <FeedInstance key={`${auth.epoch}:${mode}:${categoryId}:${tag}:${sort}`} mode={mode}
    categoryId={categoryId} tag={tag} sort={sort} />;
}
