"use client";

import { useEffect, useState } from "react";
import { apiFailureMessage } from "@/lib/api";
import { useAuth } from "../auth-provider";
import { DailyVisitorsChart } from "./daily-visitors-chart";

type Analytics = { status: "UNCONFIGURED" | "EMPTY" | "READY" | "ERROR"; range: 7 | 30 | 90;
  metrics: { visitors: number; pageViews: number; averageEngagementSeconds: number | null; projectsSessionRate: number | null;
    visitorsChangePercent: number | null; pageViewsChangePercent: number | null } | null;
  dailyVisitors: Array<{ date: string; visitors: number }>;
  topPages: Array<{ path: string; title: string; section: string; views: number }>;
  trafficSources: Array<{ channel: string; sessions: number; percentage: number }>;
  projects: Array<{ slug: string; name: string; homeViews: number; documentReachRate: number | null }> };

/** 실제 GA4 응답의 상태와 필수 배열을 확인하고 수치를 만들어 내지 않는다. */
function parseAnalytics(value: unknown, expectedRange: 7 | 30 | 90): Analytics {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid analytics");
  const item = value as Record<string, unknown>;
  if (!Array.isArray(item.dailyVisitors) || !Array.isArray(item.topPages) || !Array.isArray(item.trafficSources) ||
    !Array.isArray(item.projects) || !["UNCONFIGURED", "EMPTY", "READY", "ERROR"].includes(String(item.status)) ||
    item.range !== expectedRange || item.status === "READY" && (
      !item.metrics || typeof item.metrics !== "object" || item.dailyVisitors.length !== expectedRange ||
      item.dailyVisitors.some((day) => !day || typeof day !== "object" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(String(day.date)) ||
        !Number.isSafeInteger(day.visitors) || day.visitors < 0)))
    throw new Error("Invalid analytics");
  return item as Analytics;
}

/** {@link AnalyticsDashboard}의 GA4 비율을 불필요한 소수점 0 없이 표시한다. */
function percent(value: number): string { return `${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)}%`; }

/** {@link parseAnalytics}로 확인한 GA4 실측값과 미설정·빈 결과·오류를 원본 배치에 구분해 표시한다. */
export function AnalyticsDashboard() {
  const auth = useAuth();
  const [range, setRange] = useState<7 | 30 | 90>(30);
  const [data, setData] = useState<Analytics | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setData(null); setError("");
    void (async () => {
      try { const result = parseAnalytics(await auth.adminRead(`/api/v1/admin/analytics?range=${range}`, controller.signal), range);
        if (!controller.signal.aborted) setData(result); }
      catch (failure) { if (!controller.signal.aborted) setError(apiFailureMessage(failure)); }
    })();
    return () => controller.abort();
  }, [auth.adminRead, range, retry]);

  const metrics = data?.metrics;
  const ready = data?.range === range && data.status === "READY" && Boolean(metrics);
  const unavailable = data?.status === "UNCONFIGURED" ? "Google Analytics Data API가 연결되지 않았습니다." :
    data?.status === "EMPTY" ? "선택한 기간에 집계된 방문 기록이 없습니다." :
      data?.status === "ERROR" ? "Google Analytics 결과를 가져오지 못했습니다." : null;
  return <><div className="admin-heading"><h1>대시보드</h1>
    {data && <span className="analytics-connection" role={data.status === "ERROR" ? "alert" : "status"}>
      <span className={ready ? "analytics-connection-dot connected" : "analytics-connection-dot"} />
      {ready ? "Google Analytics 연결됨 · 실측 수치" : unavailable}
      {data.status === "ERROR" && <button type="button" onClick={() => setRetry((value) => value + 1)}>다시 시도</button>}</span>}
    <div className="range-tabs" aria-label="분석 기간">{([7, 30, 90] as const).map((value) => <button key={value}
      type="button" aria-pressed={range === value} onClick={() => setRange(value)}>{value}일</button>)}</div></div>
    {!data && !error && <p role="status">분석 결과를 불러오고 있습니다…</p>}
    {error && <p role="alert">{error} <button type="button" className="small-button" onClick={() => setRetry((value) => value + 1)}>다시 시도</button></p>}
    <div className="metrics-grid">{[
      ["방문자", ready ? metrics!.visitors.toLocaleString("ko-KR") : "—", metrics?.visitorsChangePercent ?? null],
      ["페이지뷰", ready ? metrics!.pageViews.toLocaleString("ko-KR") : "—", metrics?.pageViewsChangePercent ?? null],
      ["평균 참여", ready && metrics!.averageEngagementSeconds !== null ?
        `${Math.floor(metrics!.averageEngagementSeconds / 60)}분 ${Math.round(metrics!.averageEngagementSeconds % 60)}초` : "—", null],
      ["Projects 유입", ready && metrics!.projectsSessionRate !== null ? percent(metrics!.projectsSessionRate) : "—", null],
    ].map(([label, value, change], index) => <section className="metric-card" key={label}><h2>{label}</h2><strong>{value}</strong>
      {index < 2 && <span>{ready && change !== null ? <><b className={Number(change) >= 0 ? "metric-positive" : "metric-negative"}>
        {Number(change) >= 0 ? "▲" : "▼"}{Math.abs(Number(change))}%</b> 이전 기간 대비</> :
        "비교 기간 측정 없음"}</span>}
      {ready && index === 2 && <span>문서 페이지 기준</span>}
      {ready && index === 3 && <span>전체 세션 중</span>}</section>)}</div>
    <section className="analytics-chart card"><h2>일별 방문자 {ready && <small>지난 {range}일</small>}</h2>
      {ready ? <DailyVisitorsChart key={`${range}:${data!.dailyVisitors[0].date}:${data!.dailyVisitors.at(-1)?.date}`}
        days={data!.dailyVisitors} range={range} /> : <div className="analytics-empty-chart">실측 데이터 없음</div>}</section>
    <div className="analytics-bottom"><section className="card"><h2>인기 글</h2><table className="admin-table"><thead><tr><th>제목</th><th>구분</th><th>조회</th></tr></thead>
      <tbody>{ready && data!.topPages.map((item) => <tr key={item.path}><td>{item.title}</td><td>{item.section}</td><td>{item.views.toLocaleString("ko-KR")}</td></tr>)}</tbody></table>
      {!ready && <p className="analytics-empty-list">실측 데이터 없음</p>}</section>
      <div className="analytics-side"><section className="card"><h2>유입 경로</h2>{ready && data!.trafficSources.map((item) => <div className="traffic-row" key={item.channel}>
        <span>{item.channel}</span><meter min={0} max={100} value={item.percentage} /><span>{percent(item.percentage)}</span></div>)}
        {!ready && <p className="analytics-empty-list">실측 데이터 없음</p>}</section>
        <section className="card"><h2>프로젝트별 읽힘 <small>대문 → 하위 문서 도달률</small></h2><table className="admin-table"><thead><tr><th>프로젝트</th><th>대문</th><th>도달</th></tr></thead>
          <tbody>{ready && data!.projects.map((item) => <tr key={item.slug}><td>{item.name}</td><td>{item.homeViews}</td>
            <td>{item.documentReachRate === null ? "측정 없음" : percent(item.documentReachRate)}</td></tr>)}</tbody></table>
          {!ready && <p className="analytics-empty-list">실측 데이터 없음</p>}</section></div></div>
  </>;
}
