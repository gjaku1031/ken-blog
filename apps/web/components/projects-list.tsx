"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";
import { ApiFailure, apiFailureMessage, apiJson } from "@/lib/api";
import { formatProjectPeriod, parseProjectPage, projectStatusLabel, type ProjectSummary } from "@/lib/projects";
import { useAuth } from "./auth-provider";
import { publicImageUrl } from "@/lib/profile";

/** 역할별 출간 프로젝트만 읽고 이후 페이지는 사용자가 요청할 때 이어 붙인다. {@link ProjectsInstance} */
function ProjectsInstance() {
  const auth = useAuth();
  const [items, setItems] = useState<ProjectSummary[]>([]);
  const [page, setPage] = useState(0);
  const [loaded, setLoaded] = useState(-1);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (auth.status === "checking") return;
    const controller = new AbortController();
    let live = true;
    setLoading(true); setError("");
    void (async () => {
      try {
        const credentials = await auth.readCredentials(controller.signal);
        const result = parseProjectPage(await apiJson<unknown>(`/api/v1/projects?page=${page}&size=12`,
          credentials, controller.signal), page);
        if (!live) return;
        setItems((previous) => page === 0 ? result.items : [...previous, ...result.items]);
        setLoaded(page); setTotalPages(result.totalPages); setLoading(false);
      } catch (failure) {
        if (!live || controller.signal.aborted) return;
        if (failure instanceof ApiFailure && failure.status === 401) void auth.refresh();
        setError(apiFailureMessage(failure)); setLoading(false);
      }
    })();
    return () => { live = false; controller.abort(); };
  }, [auth.status, auth.readCredentials, auth.refresh, page, retry]);

  useEffect(() => {
    if (!loading && !error && loaded + 1 < totalPages) setPage(loaded + 1);
  }, [loading, error, loaded, totalPages]);

  return <main id="main-content" className="page-container projects-page">
    <h1>Projects</h1>
    {items.length === 0 && !loading && !error && <p className="projects-empty">아직 출간된 프로젝트가 없습니다.</p>}
    <div className="projects-grid">
      {items.map((item) => <article key={item.id} className="project-card card hv">
        <div className="project-card-top"><span className={`project-status project-status-${item.status.toLowerCase()}`}>
          <span aria-hidden="true" />{projectStatusLabel(item.status)}</span>
          {formatProjectPeriod(item.startPeriod, item.endPeriod, item.status) && <span className="mono project-period">
            {formatProjectPeriod(item.startPeriod, item.endPeriod, item.status)}</span>}
          {item.visibility === "PRIVATE" && <span className="project-private">비공개</span>}</div>
        <h2><Link href={`/project/?slug=${encodeURIComponent(item.slug)}`}>{item.name}</Link></h2>
        <p>{item.overview}</p>
        {item.stackBadges.length > 0 && <div className="stack-badges">{item.stackBadges.map((badge) => <span key={badge.id}>
          {publicImageUrl(badge.imageUrl) && <Image src={publicImageUrl(badge.imageUrl)!} alt="" width={22} height={22} unoptimized />}
          {badge.name}</span>)}</div>}
        <div className="project-card-counts">문서 {item.documentCount}개{item.relatedTechCount > 0 ? ` · 관련 글 ${item.relatedTechCount}개` : ""}</div>
      </article>)}
      {auth.status === "authenticated" && auth.user?.role === "ADMIN" && <Link
        className="project-card project-create-card" href="/write/?section=project-home"><span aria-hidden="true">＋</span>
        <span>새 프로젝트</span></Link>}
    </div>
    {loading && <p role="status">프로젝트를 불러오고 있습니다…</p>}
    {error && <p role="alert">{error} <button type="button" className="small-button"
      onClick={() => setRetry((value) => value + 1)}>다시 시도</button></p>}
  </main>;
}

/** 세션이 바뀌면 이전 PRIVATE 카드와 대기 응답을 함께 폐기한다. {@link ProjectsList} */
export function ProjectsList() {
  const auth = useAuth();
  return <ProjectsInstance key={auth.epoch} />;
}
