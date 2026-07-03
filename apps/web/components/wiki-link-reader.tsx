"use client";

import Link from "next/link";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ApiFailure, apiJson, parseWikiLinkResults, type WikiLinkResult } from "@/lib/api";
import { useAuth } from "./auth-provider";

type WikiContextValue = { results: ReadonlyMap<string, WikiLinkResult>; requested: ReadonlySet<string>;
  pending: boolean; failed: boolean };
const WikiContext = createContext<WikiContextValue | null>(null);
type Batch = { titles: string[]; query: string };

/** 정확한 API 상한 안에서 고유 제목을 요청 순서대로 묶는다. */
function batches(titles: readonly string[]): Batch[] {
  const output: Batch[] = [];
  let current: string[] = [];
  let bytes = 0;
  const flush = () => {
    if (!current.length) return;
    const query = new URLSearchParams();
    for (const title of current) query.append("title", title);
    output.push({ titles: current, query: query.toString() });
    current = []; bytes = 0;
  };
  for (const title of titles) {
    const length = new TextEncoder().encode(title).length;
    const preview = new URLSearchParams();
    for (const part of current) preview.append("title", part);
    preview.append("title", title);
    if (current.length && (current.length >= 20 || bytes + length > 1500 || preview.toString().length > 6144)) flush();
    current.push(title); bytes += length;
  }
  flush();
  return output;
}

/** 문서 하나의 고유 대상만 최대 두 요청씩 조회하고 세션/문서 교체 때 응답을 폐기한다. */
export function WikiLinkReader({ titles, children }: { titles: readonly string[]; children: ReactNode }) {
  const { readCredentials, refresh } = useAuth();
  const [results, setResults] = useState<ReadonlyMap<string, WikiLinkResult>>(() => new Map());
  const [pending, setPending] = useState(titles.length > 0);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const requested = useMemo(() => new Set(titles), [titles]);
  useEffect(() => {
    const controller = new AbortController();
    let live = true;
    setResults(new Map()); setPending(titles.length > 0); setFailed(false);
    if (!titles.length) return () => { live = false; controller.abort(); };
    const work = batches(titles);
    void (async () => {
      try {
        const credentials = await readCredentials(controller.signal);
        if (!live) return;
        let next = 0;
        const worker = async () => {
          while (live && next < work.length) {
            const batch = work[next++];
            try {
              const response = await apiJson<unknown>(`/api/v1/wiki-links/resolve?${batch.query}`,
                credentials, controller.signal);
              const values = parseWikiLinkResults(response, batch.titles);
              if (!live) return;
              setResults((previous) => {
                const updated = new Map(previous);
                for (const value of values) updated.set(value.requestedTitle, value);
                return updated;
              });
            } catch (error) {
              if (!live || controller.signal.aborted) return;
              if (error instanceof ApiFailure && error.status === 401) void refresh();
              setFailed(true);
            }
          }
        };
        await Promise.all([worker(), worker()]);
      } catch (error) {
        if (live && !controller.signal.aborted) {
          if (error instanceof ApiFailure && error.status === 401) void refresh();
          setFailed(true);
        }
      } finally { if (live) setPending(false); }
    })();
    return () => { live = false; controller.abort(); };
  }, [titles, readCredentials, refresh, retry]);

  const context: WikiContextValue = { results, requested, pending, failed };
  return <WikiContext.Provider value={context}>{children}
    {failed && <div className="wiki-query-error" role="status">일부 글 링크를 확인하지 못했습니다. 원문은 유지됩니다. <button
      type="button" className="small-button" onClick={() => setRetry((value) => value + 1)}>글 링크 다시 확인</button></div>}
  </WikiContext.Provider>;
}

/** API가 확인한 slug만 이동시키며 잠금·없음·오류는 텍스트 상태로 표시한다. */
export function WikiLink({ title, label, raw, interactive = true }: {
  title: string; label: string; raw: string; interactive?: boolean;
}) {
  const auth = useAuth();
  const context = useContext(WikiContext);
  if (!context || !context.requested.has(title)) return <span>{raw}</span>;
  const result = context.results.get(title);
  if (!result) return <span className="wiki-link wiki-unverified"
    title={context.pending ? "글 링크 확인 중" : "글 링크를 확인하지 못했습니다"}>{label}</span>;
  if (result.status === "LOCKED") return <span className="wiki-link wiki-locked"
    title="비공개 글 · 로그인하면 볼 수 있습니다" aria-label={`${label}, 비공개 글, 로그인하면 볼 수 있습니다`}>{label}</span>;
  if (result.status === "MISSING") return interactive && auth.status === "authenticated" && auth.user?.role === "ADMIN" ?
    <Link className="wiki-link wiki-missing" href={`/write/?title=${encodeURIComponent(title)}`}
      title="아직 없는 글 · 새 글로 작성" aria-label={`${label}, 아직 없는 글, 새 글로 작성`}>{label}</Link> :
    <span className="wiki-link wiki-missing" title="아직 없는 글" aria-label={`${label}, 아직 없는 글`}>{label}</span>;
  if (result.status !== "READABLE") return <span>{raw}</span>;
  if (!interactive) return <span className="wiki-link wiki-readable" title={`Tech · ${result.title}`}>{label}</span>;
  return <Link className="wiki-link wiki-readable" href={`/post/?slug=${encodeURIComponent(result.slug)}`}
    title={`Tech · ${result.title}`}>{label}</Link>;
}
