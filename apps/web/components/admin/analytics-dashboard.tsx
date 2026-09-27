"use client";

import { useEffect, useState } from "react";
import { apiFailureMessage } from "@/lib/api";
import { useAuth } from "../auth-provider";

type Analytics = { status: "UNCONFIGURED" | "EMPTY" | "READY" | "ERROR"; range: 7 | 30 | 90;
  metrics: { visitors: number; pageViews: number; averageEngagementSeconds: number | null; projectsSessionRate: number | null;
    visitorsChangePercent: number | null; pageViewsChangePercent: number | null } | null;
  dailyVisitors: Array<{ date: string; visitors: number }>;
  topPages: Array<{ path: string; title: string; section: string; views: number }>;
  trafficSources: Array<{ channel: string; sessions: number; percentage: number }>;
  projects: Array<{ slug: string; name: string; homeViews: number; documentReachRate: number | null }> };

/** 실제 GA4 응답의 상태와 필수 배열을 확인하고 수치를 만들어 내지 않는다. */
function parseAnalytics(value: unknown): Analytics {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid analytics");
  const item = value as Record<string, unknown>;
  if (!Array.isArray(item.dailyVisitors) || !Array.isArray(item.topPages) || !Array.isArray(item.trafficSources) ||
    !Array.isArray(item.projects) || !["UNCONFIGURED", "EMPTY", "READY", "ERROR"].includes(String(item.status)))
    throw new Error("Invalid analytics");
  return item as Analytics;
}

/** GA4 Data API의 기간별 실측값과 미설정·빈 결과·오류를 명확히 구분한다. */
export function AnalyticsDashboard() {
  const auth = useAuth();
  const [range, setRange] = useState<7 | 30 | 90>(7);
  const [data, setData] = useState<Analytics | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setData(null); setError("");
    void (async () => {
      try { const result = parseAnalytics(await auth.adminRead(`/api/v1/admin/analytics?range=${range}`, controller.signal));
        if (!controller.signal.aborted) setData(result); }
      catch (failure) { if (!controller.signal.aborted) setError(apiFailureMessage(failure)); }
    })();
    return () => controller.abort();
  }, [auth.adminRead, range, retry]);

  const metrics = data?.metrics;
  const max = Math.max(1, ...(data?.dailyVisitors.map((entry) => entry.visitors) ?? []));
  return <><div className="admin-heading"><h1>대시보드</h1>
    <div className="range-tabs" aria-label="분석 기간">{([7, 30, 90] as const).map((value) => <button key={value}
      type="button" aria-pressed={range === value} onClick={() => setRange(value)}>{value}일</button>)}</div></div>
    {!data && !error && <p role="status">분석 결과를 불러오고 있습니다…</p>}
    {error && <p role="alert">{error} <button type="button" className="small-button" onClick={() => setRetry((value) => value + 1)}>다시 시도</button></p>}
    {data?.status === "UNCONFIGURED" && <div className="message-card card">Google Analytics Data API가 연결되지 않았습니다.</div>}
    {data?.status === "ERROR" && <div className="message-card card" role="alert">Google Analytics 결과를 가져오지 못했습니다.
      <button type="button" className="small-button" onClick={() => setRetry((value) => value + 1)}>다시 시도</button></div>}
    {data?.status === "EMPTY" && <div className="message-card card">선택한 기간에 집계된 방문 기록이 없습니다.</div>}
    {data?.status === "READY" && metrics && <>
      <div className="metrics-grid">{[
        ["방문자", metrics.visitors.toLocaleString("ko-KR"), metrics.visitorsChangePercent],
        ["페이지뷰", metrics.pageViews.toLocaleString("ko-KR"), metrics.pageViewsChangePercent],
        ["평균 참여", metrics.averageEngagementSeconds === null ? "측정 없음" :
          `${Math.floor(metrics.averageEngagementSeconds / 60)}분 ${Math.round(metrics.averageEngagementSeconds % 60)}초`, null],
        ["Projects 유입", metrics.projectsSessionRate === null ? "측정 없음" : `${metrics.projectsSessionRate.toFixed(1)}%`, null],
      ].map(([label, value, change], index) => <section className="metric-card card" key={label}><h2>{label}</h2><strong>{value}</strong>
        {index < 2 && (change !== null ? <span>{Number(change) >= 0 ? "+" : ""}{change}% 이전 기간 대비</span> :
          <span>비교 기간 측정 없음</span>)}</section>)}</div>
      <section className="analytics-chart card"><h2>일별 방문자</h2><div className="bar-chart" role="img" aria-label="날짜별 방문자 막대 그래프">
        {data.dailyVisitors.map((entry) => <div className="bar-cell" key={entry.date} title={`${entry.date} · ${entry.visitors}명`}>
          <span style={{ height: `${entry.visitors / max * 100}%` }} /></div>)}</div></section>
      <div className="analytics-bottom"><section className="card"><h2>인기 글</h2><table className="admin-table"><thead><tr><th>제목</th><th>구분</th><th>조회</th></tr></thead>
        <tbody>{data.topPages.map((item) => <tr key={item.path}><td>{item.title}</td><td>{item.section}</td><td>{item.views.toLocaleString("ko-KR")}</td></tr>)}</tbody></table></section>
        <section className="card"><h2>유입 경로</h2>{data.trafficSources.map((item) => <div className="traffic-row" key={item.channel}>
          <span>{item.channel}</span><meter min={0} max={100} value={item.percentage} /><span>{item.percentage.toFixed(1)}%</span></div>)}
          <h2>프로젝트별 읽힘</h2><table className="admin-table"><thead><tr><th>프로젝트</th><th>대문 조회</th><th>문서 도달률</th></tr></thead>
            <tbody>{data.projects.map((item) => <tr key={item.slug}><td>{item.name}</td><td>{item.homeViews}</td>
              <td>{item.documentReachRate === null ? "측정 없음" : `${item.documentReachRate.toFixed(1)}%`}</td></tr>)}</tbody></table></section></div>
    </>}
  </>;
}
