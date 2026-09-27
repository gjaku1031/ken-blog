"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { apiFailureMessage, apiJson } from "@/lib/api";
import { parseActivity, type Activity } from "@/lib/feed";
import { parseProfile, type HomeProfile } from "@/lib/profile";
import { useAuth } from "./auth-provider";
import { ProfileCard } from "./profile-card";

/** 현재 KST 날짜의 자정에 해당하는 UTC 날짜 문자열을 만든다. */
function kstToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

/** 화면 너비에 맞는 주 수를 일요일 시작 날짜 격자로 변환한다. */
function heatmapDays(today: string, weeks: number): Array<{ date: string; weekday: number; future: boolean }> {
  const end = new Date(`${today}T00:00:00Z`);
  const start = new Date(end); start.setUTCDate(start.getUTCDate() - start.getUTCDay() - (weeks - 1) * 7);
  const days: Array<{ date: string; weekday: number; future: boolean }> = [];
  for (let index = 0; index < weeks * 7; index += 1) {
    const current = new Date(start); current.setUTCDate(start.getUTCDate() + index);
    days.push({ date: current.toISOString().slice(0, 10), weekday: current.getUTCDay(), future: current > end });
  }
  return days;
}

/** API의 실제 KST 출간 건수만 색 농도와 접근 가능한 제목으로 보여 준다. */
function ActivityCard({ activity }: { activity: Activity }) {
  const area = useRef<HTMLDivElement>(null);
  const [today, setToday] = useState("");
  const [selectedDate, setSelectedDate] = useState("");
  const [weeks, setWeeks] = useState(8);
  useEffect(() => { const date = kstToday(); setToday(date); setSelectedDate(date); }, []);
  useEffect(() => {
    if (!area.current) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      if (width > 0) setWeeks(Math.max(8, Math.min(53, Math.floor((width - 24) / 14))));
    });
    observer.observe(area.current);
    return () => observer.disconnect();
  }, []);
  const days = useMemo(() => today ? heatmapDays(today, weeks) : [], [today, weeks]);
  const counts = new Map(activity.items.map((item) => [item.date, item.count]));
  const visible = days.filter((day) => !day.future);
  const postCount = visible.reduce((sum, day) => sum + (counts.get(day.date) ?? 0), 0);
  const activeDays = visible.filter((day) => (counts.get(day.date) ?? 0) > 0).length;
  const months = Math.max(1, Math.round(weeks * 7 / 30));
  const monthLabels = Array.from({ length: weeks }, (_, index) => {
    const current = days[index * 7];
    const previous = index > 0 ? days[(index - 1) * 7] : null;
    return current && (index === 0 || current.date.slice(0, 7) !== previous?.date.slice(0, 7)) ?
      `${Number(current.date.slice(5, 7))}월` : "";
  });
  /** 화살표로 하루 또는 한 주씩 이동하고 활성 날짜 하나만 탭 순서에 둔다. */
  function moveDate(date: string, key: string) {
    const current = visible.findIndex((day) => day.date === date);
    const offset = key === "ArrowUp" ? -1 : key === "ArrowDown" ? 1 : key === "ArrowLeft" ? -7 : key === "ArrowRight" ? 7 : 0;
    if (!offset) return false;
    const target = visible[current + offset];
    if (target) { setSelectedDate(target.date); document.getElementById(`heat-${target.date}`)?.focus(); }
    return true;
  }
  return <section className="activity-card card"><div className="activity-heading"><h2>글쓰기 기록</h2>
    <span>지난 {months}개월 · 글 {postCount}개 · {activeDays}일</span></div>
    <div className="heatmap-area" ref={area}><div className="heat-months" style={{ gridTemplateColumns: `repeat(${weeks}, 11px)` }}>
      {monthLabels.map((label, index) => <span key={index}>{label}</span>)}
    </div><div className="heat-weekdays" aria-hidden="true"><span>월</span><span>수</span><span>금</span></div>
    <div className="heatmap" style={{ gridTemplateColumns: `repeat(${weeks}, 11px)` }} role="group"
      aria-label={`지난 ${months}개월 날짜별 출간 글 수. 화살표 키로 날짜 이동`}>
      {days.map((day) => { const count = counts.get(day.date) ?? 0; return day.future ? <span key={day.date}
        className="heat-day heat-future" aria-hidden="true" /> : <button key={day.date} id={`heat-${day.date}`} type="button"
        className={`heat-day heat-level-${count === 0 ? 0 : count === 1 ? 1 : count === 2 ? 2 : count === 3 ? 3 : 4}`}
        aria-label={`${day.date} 글 ${count}개`} aria-pressed={selectedDate === day.date}
        tabIndex={selectedDate === day.date ? 0 : -1} onClick={() => setSelectedDate(day.date)}
        onKeyDown={(event) => { if (moveDate(day.date, event.key)) event.preventDefault(); }} />; })}
    </div></div><div className="heat-legend">적음 <span className="heat-level-0" /><span className="heat-level-1" />
      <span className="heat-level-2" /><span className="heat-level-3" /><span className="heat-level-4" /> 많음</div>
    {selectedDate && <p className="heat-selection" aria-live="polite">{selectedDate} · 글 {counts.get(selectedDate) ?? 0}개</p>}
  </section>;
}

/** 홈의 저장된 소개와 권한별 글쓰기 기록을 독립적으로 읽는다. */
function SummaryInstance() {
  const auth = useAuth();
  const params = useSearchParams();
  const [profile, setProfile] = useState<HomeProfile | null>(null);
  const [activity, setActivity] = useState<Activity | null>(null);
  const [profileError, setProfileError] = useState("");
  const [activityError, setActivityError] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (auth.status === "checking") return;
    const controller = new AbortController();
    void (async () => {
      const credentials = await auth.readCredentials(controller.signal).catch(() => "omit" as RequestCredentials);
      const [profileResult, activityResult] = await Promise.allSettled([
        apiJson<unknown>("/api/v1/profile", "omit", controller.signal),
        apiJson<unknown>("/api/v1/activity?months=12", credentials, controller.signal),
      ]);
      if (controller.signal.aborted) return;
      if (profileResult.status === "fulfilled") { try { setProfile(parseProfile(profileResult.value)); setProfileError(""); }
        catch (failure) { setProfileError(apiFailureMessage(failure)); } }
      else setProfileError(apiFailureMessage(profileResult.reason));
      if (activityResult.status === "fulfilled") { try { setActivity(parseActivity(activityResult.value)); setActivityError(""); }
        catch (failure) { setActivityError(apiFailureMessage(failure)); } }
      else setActivityError(apiFailureMessage(activityResult.reason));
    })();
    return () => controller.abort();
  }, [auth.status, auth.epoch, auth.readCredentials, retry]);

  if (params.has("categoryId") || params.has("tag")) return null;
  return <div className="home-summary">{profile ? <ProfileCard profile={profile} /> : <div className="profile-card card message-card"
    role={profileError ? "alert" : "status"}>{profileError || "소개를 불러오고 있습니다…"}</div>}
    {activity ? <ActivityCard activity={activity} /> : <div className="activity-card card message-card"
      role={activityError ? "alert" : "status"}>{activityError || "글쓰기 기록을 불러오고 있습니다…"}</div>}
    {(profileError || activityError) && <button type="button" className="small-button" onClick={() => setRetry((value) => value + 1)}>다시 시도</button>}
  </div>;
}

/** 인증 세대가 바뀌면 이전 권한의 {@link ActivityCard}를 즉시 폐기한다. */
export function HomeSummary() {
  const auth = useAuth();
  return <SummaryInstance key={`${auth.epoch}:${auth.status}`} />;
}
