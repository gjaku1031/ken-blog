"use client";

import { createContext, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { remarkMathSyntax } from "@/lib/math-syntax";
import type { AnnotationItem } from "@/lib/annotation-syntax";
import { MathExpression } from "./math-expression";

type Active = { item: AnnotationItem; occurrence: number; anchor: HTMLAnchorElement };
type Highlight = { kind: "item" | "reference"; index: number; occurrence?: number };
type AnnotationContextValue = {
  prefix: string; items: AnnotationItem[]; active: Active | null; highlight: Highlight | null;
  show: (item: AnnotationItem, occurrence: number, anchor: HTMLAnchorElement) => void;
  close: () => void; scheduleClose: () => void; keepOpen: () => void;
  itemId: (index: number) => string; referenceId: (index: number, occurrence: number) => string;
  goToItem: (event: MouseEvent<HTMLAnchorElement>, index: number) => void;
  goToReference: (event: MouseEvent<HTMLAnchorElement>, item: AnnotationItem) => void;
};

const AnnotationContext = createContext<AnnotationContextValue | null>(null);

/** 본문 원문의 인라인 문법만 다시 표시하고 주석 안 이미지·HTML·재귀 참조를 실행하지 않는다. */
function AnnotationContent({ content, interactive }: { content: string; interactive: boolean }) {
  return <Markdown remarkPlugins={[remarkGfm, remarkMathSyntax]} skipHtml urlTransform={(value, key) => {
    if (key === "src") return "";
    const url = value.trim();
    if (/[\u0000-\u001f\u007f\\]/.test(url) || url.startsWith("//")) return "";
    return url.startsWith("#") || url.startsWith("/") || /^(https?:|mailto:)/i.test(url) || /^[^:/?#][^:]*$/.test(url) ? url : "";
  }} components={{
    p({ children }) { return <span>{children}</span>; },
    a({ href, children }) {
      if (!interactive || !href) return <span>{children}</span>;
      const external = /^https?:/i.test(href);
      return <a href={href} target={external ? "_blank" : undefined} rel={external ? "noopener noreferrer" : undefined}>{children}</a>;
    },
    img({ alt }) { return <span>{alt || "이미지"}</span>; },
    pre({ children }) { return <span>{children}</span>; },
    span({ node, children }) {
      const classes = node?.properties.className;
      const math = Array.isArray(classes) && classes.includes("ken-math-inline") &&
        node?.children.length === 1 && node.children[0].type === "text" ? node.children[0].value : null;
      return math !== null ? <MathExpression source={math} display={false} /> : <span>{children}</span>;
    },
  }}>{content}</Markdown>;
}

/** 초점·hover 참조 옆에 놓되 viewport와 설명 높이에 따라 위치를 다시 계산한다. */
function AnnotationTooltip({ active, id, close, scheduleClose, keepOpen }: {
  active: Active; id: string; close: () => void; scheduleClose: () => void; keepOpen: () => void;
}) {
  const target = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number; ready: boolean }>({ left: 16, top: 16, ready: false });

  useLayoutEffect(() => {
    const element = target.current;
    if (!element) return;
    /** 크기 변동(비동기 MathML 포함)에도 가장자리 16px을 지킨다. */
    const place = () => {
      if (!active.anchor.isConnected) { close(); return; }
      const rect = active.anchor.getBoundingClientRect();
      const width = element.offsetWidth;
      const height = element.offsetHeight;
      const left = Math.max(16, Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - 16));
      const above = rect.top - height - 8;
      const below = rect.bottom + 8;
      const top = above >= 16 ? above : below + height <= window.innerHeight - 16 ? below :
        Math.max(16, Math.min(rect.top, window.innerHeight - height - 16));
      setPosition({ left, top, ready: true });
    };
    place();
    const resize = new ResizeObserver(place);
    resize.observe(element);
    return () => resize.disconnect();
  }, [active, close]);

  useEffect(() => {
    /** 스크롤 대상이 말풍선 자체이면 긴 설명을 계속 읽을 수 있다. */
    const onScroll = (event: Event) => {
      const element = target.current;
      if (element && event.target instanceof Node && element.contains(event.target)) return;
      close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); close(); }
    };
    window.addEventListener("resize", close);
    document.addEventListener("scroll", onScroll, true);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("resize", close);
      document.removeEventListener("scroll", onScroll, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [close]);

  return createPortal(<div id={id} ref={target} className="annotation-tooltip" role="tooltip"
    style={{ left: position.left, top: position.top, visibility: position.ready ? "visible" : "hidden" }}
    onPointerEnter={keepOpen} onPointerLeave={scheduleClose}>
    <AnnotationContent content={active.item.content} interactive={false} />
  </div>, document.body);
}

/** 문서별 ID와 hover·키보드 이동 상태를 생성하고 PRIVATE 전환 때 모두 폐기한다. */
export function AnnotationReader({ items, children }: { items: AnnotationItem[]; children: ReactNode }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const prefix = `ken-annotation-${id}`;
  const [active, setActive] = useState<Active | null>(null);
  const [highlight, setHighlight] = useState<Highlight | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const frame = useRef<number | null>(null);
  const itemId = (index: number) => `${prefix}-item-${index}`;
  const referenceId = (index: number, occurrence: number) => `${prefix}-ref-${index}-${occurrence}`;
  /** 닫기 대기와 강조 시간을 모두 문서 인스턴스 안에서만 관리한다. */
  const keepOpen = () => { if (closeTimer.current !== null) { clearTimeout(closeTimer.current); closeTimer.current = null; } };
  const close = () => { keepOpen(); setActive(null); };
  const scheduleClose = () => { keepOpen(); closeTimer.current = setTimeout(close, 160); };
  const show = (item: AnnotationItem, occurrence: number, anchor: HTMLAnchorElement) => {
    keepOpen(); setActive({ item, occurrence, anchor });
  };
  /** 이동한 요소를 1.8초 강조하며 연속 이동 때 앞선 타이머를 교체한다. */
  const mark = (value: Highlight) => {
    if (highlightTimer.current !== null) clearTimeout(highlightTimer.current);
    setHighlight(value);
    highlightTimer.current = setTimeout(() => setHighlight(null), 1800);
  };
  /** 사용자 동작으로 이동할 때 모션 설정과 닫힌 접기 조상을 함께 처리한다. */
  const moveTo = (element: HTMLElement) => {
    let parent = element.closest("details");
    while (parent) { parent.open = true; parent = parent.parentElement?.closest("details") ?? null; }
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      element.focus({ preventScroll: true });
      element.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "center" });
      frame.current = null;
    });
  };
  const goToItem = (event: MouseEvent<HTMLAnchorElement>, index: number) => {
    event.preventDefault(); close();
    const item = document.getElementById(itemId(index));
    if (item) { mark({ kind: "item", index }); moveTo(item); }
  };
  const goToReference = (event: MouseEvent<HTMLAnchorElement>, item: AnnotationItem) => {
    event.preventDefault(); close();
    const reference = document.getElementById(referenceId(item.index, item.firstRef));
    if (reference) { mark({ kind: "reference", index: item.index, occurrence: item.firstRef }); moveTo(reference); }
  };

  useEffect(() => () => {
    if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    if (highlightTimer.current !== null) clearTimeout(highlightTimer.current);
    if (frame.current !== null) cancelAnimationFrame(frame.current);
  }, []);

  const context: AnnotationContextValue = { prefix, items, active, highlight, show, close, scheduleClose, keepOpen,
    itemId, referenceId, goToItem, goToReference };
  const tooltipId = active ? `${prefix}-tooltip-${active.item.index}-${active.occurrence}` : "";
  return <AnnotationContext.Provider value={context}>
    {children}
    {items.length > 0 && <section className="annotation-section" aria-labelledby={`${prefix}-heading`}>
      <h2 id={`${prefix}-heading`}>주석</h2>
      <ol>{items.map((item) => <li key={item.index} id={itemId(item.index)} tabIndex={-1}
        className={highlight?.kind === "item" && highlight.index === item.index ? "annotation-highlight" : undefined}>
        <span className="annotation-item-label">[{item.label}]</span>{" "}
        <span className="annotation-item-content"><AnnotationContent content={item.content} interactive /></span>{" "}
        <a className="annotation-backlink" href={`#${referenceId(item.index, item.firstRef)}`}
          aria-label={`${item.label} 주석의 첫 참조로 돌아가기`} onClick={(event) => goToReference(event, item)}>↩ 첫 참조</a>
      </li>)}</ol>
    </section>}
    {active && <AnnotationTooltip key={tooltipId} active={active} id={tooltipId} close={close}
      scheduleClose={scheduleClose} keepOpen={keepOpen} />}
  </AnnotationContext.Provider>;
}

/** 모델이 확정한 숫자 ID만 링크로 바꾸고 이름은 React 텍스트로 표시한다. */
export function AnnotationReference({ index, occurrence }: { index: number; occurrence: number }) {
  const context = useContext(AnnotationContext);
  const item = context?.items[index];
  if (!context || !item || !item.refs.includes(occurrence)) return null;
  const active = context.active?.item.index === index && context.active.occurrence === occurrence;
  return <sup className="annotation-reference"><a id={context.referenceId(index, occurrence)}
    href={`#${context.itemId(index)}`} aria-label={`${item.label} 주석, 목록으로 이동`}
    aria-describedby={active ? `${context.prefix}-tooltip-${index}-${occurrence}` : undefined}
    className={context.highlight?.kind === "reference" && context.highlight.index === index &&
      context.highlight.occurrence === occurrence ? "annotation-highlight" : undefined}
    onPointerEnter={(event) => {
      if (event.pointerType !== "touch" && window.matchMedia("(hover: hover)").matches)
        context.show(item, occurrence, event.currentTarget);
    }}
    onPointerLeave={context.scheduleClose}
    onFocus={(event) => context.show(item, occurrence, event.currentTarget)}
    onBlur={context.scheduleClose}
    onClick={(event) => context.goToItem(event, index)}>[{item.label}]</a></sup>;
}
