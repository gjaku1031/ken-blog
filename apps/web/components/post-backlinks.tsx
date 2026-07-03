"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ApiFailure, apiFailureMessage, apiJson, parseWikiBacklinkPage, type WikiTitleItem } from "@/lib/api";
import { useAuth } from "./auth-provider";

type BacklinkState = { items: WikiTitleItem[]; loadedPage: number; hasMore: boolean;
  loading: boolean; error: string };

/** 현재 세션에서 읽을 수 있는 출간 글의 역링크만 10개씩 표시한다. */
export function PostBacklinks({ slug }: { slug: string }) {
  const { readCredentials, refresh } = useAuth();
  const [wantedPage, setWantedPage] = useState(0);
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<BacklinkState>({ items: [], loadedPage: -1, hasMore: false, loading: true, error: "" });
  useEffect(() => {
    const controller = new AbortController();
    let live = true;
    setState((old) => ({ ...old, loading: true, error: "" }));
    void (async () => {
      try {
        const credentials = await readCredentials(controller.signal);
        const response = await apiJson<unknown>(`/api/v1/posts/${encodeURIComponent(slug)}/backlinks?page=${wantedPage}`,
          credentials, controller.signal);
        const page = parseWikiBacklinkPage(response, wantedPage);
        if (!live) return;
        setState((old) => ({ items: wantedPage === 0 ? page.items : [...old.items, ...page.items],
          loadedPage: wantedPage, hasMore: page.hasMore, loading: false, error: "" }));
      } catch (error) {
        if (!live || controller.signal.aborted) return;
        if (error instanceof ApiFailure && error.status === 401) void refresh();
        setState((old) => ({ ...old, loading: false, error: apiFailureMessage(error) }));
      }
    })();
    return () => { live = false; controller.abort(); };
  }, [slug, wantedPage, retry, readCredentials, refresh]);

  if (!state.items.length && !state.loading && !state.error) return null;
  return <section className="post-backlinks" aria-label="이 글을 가리키는 글">
    <h2>이 글을 가리키는 글</h2>
    {state.items.length > 0 && <ul>{state.items.map((item) => <li key={item.id}>
      <Link href={`/post/?slug=${encodeURIComponent(item.slug)}`}>{item.title}</Link></li>)}</ul>}
    {state.loading && <p role="status">역링크를 불러오고 있습니다…</p>}
    {state.error && <p role="alert">{state.error} <button type="button" className="small-button"
      onClick={() => setRetry((value) => value + 1)}>다시 시도</button></p>}
    {!state.loading && !state.error && state.hasMore && <button type="button" className="small-button"
      onClick={() => setWantedPage(state.loadedPage + 1)}>더 보기</button>}
  </section>;
}
