"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ApiFailure, apiFailureMessage, apiJson, parseCategories, parseTags, type CategoryNode, type TagCount } from "@/lib/api";
import { parseFeedPage, type FeedPage } from "@/lib/feed";
import { useAuth } from "./auth-provider";
import { FeedAside, FeedCard, FeedSkeleton } from "./post-feed";

/** 제목·요약·본문 검색을 현재 권한의 전체 섹션 결과에 연결한다. {@link SearchResults} */
export function SearchResults() {
  const params = useSearchParams();
  const auth = useAuth();
  const values = params.getAll("q");
  const query = values.length === 1 ? values[0].trim() : "";
  const [categories, setCategories] = useState<CategoryNode[]>([]);
  const [tags, setTags] = useState<TagCount[]>([]);
  const [data, setData] = useState<FeedPage | null>(null);
  const [page, setPage] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  const sentinel = useRef<HTMLDivElement>(null);
  const nextLock = useRef(false);

  useEffect(() => { setData(null); setPage(0); nextLock.current = false; }, [query]);
  useEffect(() => {
    if (auth.status === "checking" || !query) return;
    const controller = new AbortController();
    setLoading(true); setError("");
    void (async () => {
      try {
        const credentials = await auth.readCredentials(controller.signal);
        const result = parseFeedPage(await apiJson<unknown>(`/api/v1/search?q=${encodeURIComponent(query)}&page=${page}&size=10`,
          credentials, controller.signal));
        if (page === 0) {
          const [categoryValue, tagValue] = await Promise.all([
            apiJson<unknown>("/api/v1/categories", credentials, controller.signal),
            apiJson<unknown>("/api/v1/tags", credentials, controller.signal),
          ]);
          if (!controller.signal.aborted) { setCategories(parseCategories(categoryValue)); setTags(parseTags(tagValue)); }
        }
        if (!controller.signal.aborted) { setData((current) => page === 0 || !current ? result :
          { ...result, items: [...current.items, ...result.items] }); setLoading(false); nextLock.current = false; }
      } catch (failure) {
        if (!controller.signal.aborted) { if (failure instanceof ApiFailure && failure.status === 401) auth.expire();
          setError(apiFailureMessage(failure)); setLoading(false); nextLock.current = false; }
      }
    })();
    return () => controller.abort();
  }, [auth.status, auth.epoch, auth.readCredentials, auth.expire, query, page, retry]);

  useEffect(() => {
    if (!data || loading || error || page + 1 >= data.totalPages || !sentinel.current ||
      typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting) && !nextLock.current) {
        nextLock.current = true;
        setPage((current) => current + 1);
      }
    }, { rootMargin: "300px" });
    observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [data, loading, error, page]);

  return <main id="main-content" className="page-container search-page"><div className="content-grid"><section className="feed-column">
    <div className="section-heading"><h1>최근 글</h1><nav className="feed-sort" aria-label="글 정렬">
      <span aria-current="page">최신</span><Link href="/?sort=pin">핀</Link></nav></div>
    {query && <p className="active-filters"><span className="search-filter">검색: {query}</span>
      {data && <span className="mono feed-total">{data.totalElements}편</span>}<Link href="/">필터 해제</Link></p>}
    {!query && <div className="message-card card">검색어를 입력해 주세요.</div>}
    {loading && !data && <FeedSkeleton />}
    {error && <div className="message-card card" role="alert">{error}<br /><button type="button" className="small-button"
      onClick={() => setRetry((value) => value + 1)}>다시 시도</button></div>}
    {data && <>{data.items.length ? <div className="post-list">{data.items.map((item) => <FeedCard key={item.id} post={item}
      mode="home" categoryId={null} tag={null} sort="new" categories={categories} />)}</div> : <div className="message-card card">검색 결과가 없습니다.</div>}
      {page + 1 < data.totalPages && <button type="button" className="feed-more" disabled={loading}
        onClick={() => { if (nextLock.current) return; nextLock.current = true; setPage((value) => value + 1); }}
        aria-label="검색 결과 더 보기"><FeedSkeleton /></button>}<div ref={sentinel} className="load-sentinel" aria-hidden="true" /></>}
  </section><FeedAside categories={categories} tags={tags} /></div></main>;
}
