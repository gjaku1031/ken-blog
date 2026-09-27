"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ApiFailure, apiFailureMessage, apiJson } from "@/lib/api";
import { parseFeedPage, type FeedPage } from "@/lib/feed";
import { useAuth } from "./auth-provider";
import { FeedCard } from "./post-feed";
import { disablePublicAnalytics } from "./public-analytics";

/** 제목·요약·본문 검색을 현재 권한의 전체 섹션 결과에 연결한다. */
export function SearchResults() {
  const params = useSearchParams();
  const router = useRouter();
  const auth = useAuth();
  const values = params.getAll("q");
  const query = values.length === 1 ? values[0].trim() : "";
  const [input, setInput] = useState(query);
  const [data, setData] = useState<FeedPage | null>(null);
  const [page, setPage] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  const sentinel = useRef<HTMLDivElement>(null);
  const nextLock = useRef(false);

  useEffect(() => { setInput(query); setData(null); setPage(0); nextLock.current = false; }, [query]);
  useEffect(() => {
    if (auth.status === "checking" || !query) return;
    const controller = new AbortController();
    setLoading(true); setError("");
    void (async () => {
      try {
        const credentials = await auth.readCredentials(controller.signal);
        const result = parseFeedPage(await apiJson<unknown>(`/api/v1/search?q=${encodeURIComponent(query)}&page=${page}&size=10`,
          credentials, controller.signal));
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

  /** 입력값을 한 번만 인코딩해 정적 검색 주소로 이동한다. */
  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = input.trim(); if (value) { disablePublicAnalytics(); router.push(`/search/?q=${encodeURIComponent(value)}`); }
  }

  return <main id="main-content" className="page-container search-page"><div className="content-grid"><section className="feed-column">
    <h1>검색</h1><form className="search-main-form" role="search" onSubmit={search}><label className="sr-only" htmlFor="search-main-input">글 검색</label>
      <input id="search-main-input" value={input} onChange={(event) => setInput(event.target.value)} placeholder="글 검색" />
      <button type="submit" className="primary-button">검색</button></form>
    {query && <p className="active-filters">검색: {query}{data && <> · {data.totalElements}편</>}</p>}
    {!query && <div className="message-card card">검색어를 입력해 주세요.</div>}
    {loading && !data && <div className="message-card card" role="status">검색하고 있습니다…</div>}
    {error && <div className="message-card card" role="alert">{error}<br /><button type="button" className="small-button"
      onClick={() => setRetry((value) => value + 1)}>다시 시도</button></div>}
    {data && <>{data.items.length ? <div className="post-list">{data.items.map((item) => <FeedCard key={item.id} post={item}
      mode="home" categoryId={null} tag={null} sort="new" />)}</div> : <div className="message-card card">검색 결과가 없습니다.</div>}
      {page + 1 < data.totalPages && <button type="button" className="load-more" disabled={loading}
        onClick={() => { if (nextLock.current) return; nextLock.current = true; setPage((value) => value + 1); }}>
        {loading ? "불러오는 중…" : "더 보기"}</button>}<div ref={sentinel} className="load-sentinel" aria-hidden="true" /></>}
  </section></div></main>;
}
