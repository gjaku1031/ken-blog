"use client";

import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";

type DailyVisitor = { date: string; visitors: number };
type ChartStyle = CSSProperties & { "--chart-columns"?: number; "--tooltip-x"?: string;
  "--tick-x"?: string; "--axis-width"?: string };
const weekdays = ["일", "월", "화", "수", "목", "금", "토"];

/** {@link DailyVisitorsChart}의 방문자 정수 눈금을 1·2·5 단위로 올림한다. */
function chartScale(days: DailyVisitor[]): { ceiling: number; ticks: number[] } {
  const highest = Math.max(0, ...days.map((day) => day.visitors));
  const rough = Math.max(1, highest / 4);
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = Math.max(1, ([1, 2, 5, 10].find((unit) => unit * magnitude >= rough) ?? 10) * magnitude);
  const ceiling = Math.max(step, Math.ceil(highest / step) * step);
  return { ceiling, ticks: Array.from({ length: Math.round(ceiling / step) + 1 }, (_, index) => index * step) };
}

/** {@link DailyVisitorsChart}의 실제 날짜를 KST 요일을 포함한 한국어 설명으로 만든다. */
function dayDescription(day: DailyVisitor): string {
  const [year, month, date] = day.date.split("-").map(Number);
  const weekday = weekdays[new Date(Date.UTC(year, month - 1, date)).getUTCDay()];
  return `${day.date.replaceAll("-", ".")} (${weekday}) 방문자 ${day.visitors.toLocaleString("ko-KR")}명`;
}

/** {@link DailyVisitorsChart} 폭에 맞춰 양끝을 포함한 날짜 눈금만 고른다. */
function dateTicks(count: number, width: number): number[] {
  const desired = count <= 7 ? count : count <= 30 ? 6 : 8;
  const visible = Math.min(count, desired, Math.max(2, Math.floor(width / 76)));
  return Array.from({ length: visible }, (_, index) => Math.round(index * (count - 1) / (visible - 1)));
}

/** 연속된 실측 날짜를 읽기 가능한 축과 한 번의 Tab 진입을 가진 막대차트로 표시한다. */
export function DailyVisitorsChart({ days, range }: { days: DailyVisitor[]; range: 7 | 30 | 90 }) {
  const instructionsId = useId();
  const plot = useRef<HTMLDivElement | null>(null);
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const [width, setWidth] = useState(0);
  const [activeIndex, setActiveIndex] = useState(days.length - 1);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const { ceiling, ticks } = chartScale(days);
  const labels = dateTicks(days.length, width);

  useEffect(() => {
    const element = plot.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setWidth(element.getBoundingClientRect().width));
    observer.observe(element);
    setWidth(element.getBoundingClientRect().width);
    return () => observer.disconnect();
  }, []);

  /** 포인터가 가리키는 전체 높이 슬롯에서 0명인 날짜도 선택한다. */
  function selectAt(clientX: number) {
    const rect = plot.current?.getBoundingClientRect();
    if (!rect?.width) return;
    const index = Math.max(0, Math.min(days.length - 1, Math.floor((clientX - rect.left) / rect.width * days.length)));
    setSelectedIndex(index);
    return index;
  }

  /** 마우스 호버와 누른 채 움직이는 터치·펜을 날짜 슬롯에 맞춘다. */
  function movePointer(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType !== "mouse" && event.buttons === 0) return;
    const index = selectAt(event.clientX);
    if (event.pointerType !== "mouse" && index !== undefined) {
      setActiveIndex(index);
      if (document.activeElement !== buttons.current[index]) buttons.current[index]?.focus({ preventScroll: true });
    }
  }

  /** 좌우·Home·End로 한 슬롯씩 이동하고 Escape로 툴팁을 닫는다. */
  function moveKeyboard(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === "Escape") { event.preventDefault(); setSelectedIndex(null); return; }
    const next = event.key === "ArrowLeft" ? Math.max(0, index - 1) :
      event.key === "ArrowRight" ? Math.min(days.length - 1, index + 1) :
        event.key === "Home" ? 0 : event.key === "End" ? days.length - 1 : null;
    if (next === null) return;
    event.preventDefault();
    setActiveIndex(next); setSelectedIndex(next);
    buttons.current[next]?.focus({ preventScroll: true });
  }

  const chosen = selectedIndex === null ? null : days[selectedIndex];
  const tooltipPosition = selectedIndex === null ? "0%" : `${(selectedIndex + .5) / days.length * 100}%`;
  return <div className={`daily-chart daily-chart-${range}`}
    style={{ "--axis-width": `${Math.max(37, ceiling.toLocaleString("ko-KR").length * 7 + 4)}px` } as ChartStyle}>
    <p id={instructionsId} className="sr-only">Tab으로 차트에 들어간 뒤 왼쪽·오른쪽 화살표로 날짜를 이동합니다. Home·End는 처음·끝 날짜, Escape는 날짜 설명을 닫습니다.</p>
    <div className="daily-chart-layout">
      <div className="daily-chart-y-axis" aria-hidden="true">{ticks.map((tick) =>
        <span key={tick} style={{ top: `${(1 - tick / ceiling) * 100}%` }}>{tick.toLocaleString("ko-KR")}</span>)}</div>
      <div className="daily-chart-plot" ref={plot} role="group" aria-label={`지난 ${range}일 일별 방문자`}
        aria-describedby={instructionsId} style={{ "--chart-columns": days.length, "--tooltip-x": tooltipPosition } as ChartStyle}
        onPointerEnter={movePointer} onPointerMove={movePointer} onPointerDown={(event) => {
          if (!event.isPrimary) return;
          const index = selectAt(event.clientX);
          if (event.pointerType !== "mouse" && index !== undefined) {
            setActiveIndex(index); buttons.current[index]?.focus({ preventScroll: true });
          }
        }} onPointerCancel={() => setSelectedIndex(null)}
        onPointerLeave={(event) => {
          if (event.pointerType !== "mouse") return;
          const focused = buttons.current.indexOf(document.activeElement as HTMLButtonElement);
          setSelectedIndex(focused < 0 ? null : focused);
        }}
        onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setSelectedIndex(null); }}>
        {chosen && <div className="daily-chart-tooltip" aria-hidden="true">{dayDescription(chosen)}</div>}
        <div className="daily-chart-grid" aria-hidden="true">{ticks.map((tick) =>
          <span key={tick} style={{ top: `${(1 - tick / ceiling) * 100}%` }} />)}</div>
        <div className="daily-chart-bars">{days.map((day, index) => <button key={day.date} type="button"
          ref={(element) => { buttons.current[index] = element; }} className="daily-chart-slot"
          tabIndex={index === activeIndex ? 0 : -1} aria-label={dayDescription(day)}
          data-selected={selectedIndex === index || undefined}
          onFocus={() => { setActiveIndex(index); setSelectedIndex(index); }}
          onClick={(event) => { if (event.detail === 0) { setActiveIndex(index); setSelectedIndex(index); } }}
          onKeyDown={(event) => moveKeyboard(event, index)}>
          <span className="daily-chart-bar" style={{ height: `${day.visitors / ceiling * 100}%` }} aria-hidden="true" />
        </button>)}</div>
      </div>
    </div>
    <div className="daily-chart-date-axis" aria-hidden="true">{labels.map((index) => <span key={days[index].date}
      style={{ "--tick-x": `${(index + .5) / days.length * 100}%` } as ChartStyle}>
      {days[index].date.slice(5).replace("-", ".")}</span>)}</div>
  </div>;
}
