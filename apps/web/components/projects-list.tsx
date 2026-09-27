"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent, type PointerEvent } from "react";
import { ApiFailure, apiFailureMessage, apiJson } from "@/lib/api";
import { formatProjectPeriod, parseProjectOrder, parseProjectPage, projectStatusLabel, type ProjectSummary } from "@/lib/projects";
import { useAuth } from "./auth-provider";
import { publicImageUrl } from "@/lib/profile";

type NativeDrag = { kind: "native"; id: number };
type HandleDrag = { kind: "handle"; id: number; pointerId: number; handle: HTMLButtonElement;
  startX: number; startY: number; active: boolean };
type ProjectDrag = NativeDrag | HandleDrag;

/** {@link ProjectsInstance}에서 보이는 카드 한 장만 지정한 삽입 경계로 옮긴다. */
function moveToBoundary(items: ProjectSummary[], id: number, boundary: number): ProjectSummary[] {
  const from = items.findIndex((item) => item.id === id);
  if (from < 0) return items;
  const to = Math.max(0, Math.min(boundary, items.length)) - (boundary > from ? 1 : 0);
  if (from === to) return items;
  const next = [...items];
  const [moving] = next.splice(from, 1);
  next.splice(to, 0, moving);
  return next;
}

/** 관리자 전체 ID 배열에서 비표시 프로젝트의 자리를 보존하며 카드 순서만 바꾼다. */
function fullOrder(baseIds: number[], before: ProjectSummary[], after: ProjectSummary[]): number[] {
  const visible = new Set(before.map((item) => item.id));
  let cursor = 0;
  return baseIds.map((id) => visible.has(id) ? after[cursor++].id : id);
}

/** 역할별 출간 프로젝트를 모두 읽고 관리자 카드 그리드에서 놓는 즉시 전체 순서를 저장한다. */
function ProjectsInstance() {
  const auth = useAuth();
  const admin = auth.status === "authenticated" && auth.user?.role === "ADMIN";
  const [items, setItems] = useState<ProjectSummary[]>([]);
  const [page, setPage] = useState(0);
  const [loaded, setLoaded] = useState(-1);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [baseIds, setBaseIds] = useState<number[] | null>(null);
  const [orderError, setOrderError] = useState("");
  const [orderRetry, setOrderRetry] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [dropBoundary, setDropBoundary] = useState<number | null>(null);
  const [ghost, setGhost] = useState<{ name: string; x: number; y: number } | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  const drag = useRef<ProjectDrag | null>(null);
  const savingRef = useRef(false);
  const saveController = useRef<AbortController | null>(null);
  const suppressClickUntil = useRef(0);
  const baseIdsRef = useRef<number[] | null>(null);
  const restoreFocusId = useRef<number | null>(null);
  const scrollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const scrollDirection = useRef(0);
  const pointerPosition = useRef<{ x: number; y: number } | null>(null);
  const allLoaded = !loading && !error && loaded + 1 >= totalPages;
  const visibleIds = new Set(items.map((item) => item.id));
  const orderedVisibleIds = baseIds?.filter((id) => visibleIds.has(id));
  const orderMatches = orderedVisibleIds?.length === items.length &&
    orderedVisibleIds.every((id, index) => id === items[index].id);
  const canOrder = admin && allLoaded && orderMatches && !saving && !savingRef.current;

  useEffect(() => {
    if (!saving && canOrder && restoreFocusId.current !== null) {
      grid.current?.querySelector<HTMLButtonElement>(`[data-project-id="${restoreFocusId.current}"] .project-order-handle`)?.focus();
      restoreFocusId.current = null;
    }
  }, [saving, canOrder, items]);

  /** 게스트·관리자 권한에 맞는 페이지를 순서대로 이어 붙인다. */
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

  /** 관리자 전용 전체 순서 기준을 공개 카드와 별도로 읽어 409 충돌을 감지한다. */
  useEffect(() => {
    if (!admin) return;
    const controller = new AbortController();
    setBaseIds(null); baseIdsRef.current = null; setOrderError("");
    void auth.adminRead("/api/v1/admin/projects/order", controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      const ids = parseProjectOrder(result).map((item) => item.id);
      baseIdsRef.current = ids; setBaseIds(ids);
    }).catch((failure) => {
      if (!controller.signal.aborted) setOrderError(apiFailureMessage(failure));
    });
    return () => controller.abort();
  }, [admin, auth.adminRead, orderRetry]);

  /** 다른 창으로 이동하거나 화면이 해제되면 미완성 드래그와 저장 요청을 정리한다. */
  useEffect(() => {
    const onEscape = (event: globalThis.KeyboardEvent) => {
      if (!drag.current) return;
      if (event.key === "Escape") {
        event.preventDefault(); event.stopPropagation(); clearDrag();
        setAnnouncement("이동을 취소했습니다.");
      }
    };
    window.addEventListener("keydown", onEscape, true);
    window.addEventListener("blur", clearDrag);
    return () => {
      window.removeEventListener("keydown", onEscape, true);
      window.removeEventListener("blur", clearDrag);
      const current = drag.current;
      drag.current = null;
      if (current?.kind === "handle" && current.handle.hasPointerCapture(current.pointerId))
        current.handle.releasePointerCapture(current.pointerId);
      if (scrollTimer.current) clearInterval(scrollTimer.current);
      saveController.current?.abort();
    };
  }, []);

  /** 카드의 가로 줄과 중심점을 읽어 놓기 경계를 찾고 새 프로젝트 CTA는 제외한다. */
  function boundaryAt(x: number, y: number): number | null {
    const container = grid.current;
    if (!container) return null;
    const bounds = container.getBoundingClientRect();
    if (x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom) return null;
    const create = container.querySelector<HTMLElement>(".project-create-card")?.getBoundingClientRect();
    if (create && x >= create.left && x <= create.right && y >= create.top && y <= create.bottom) return null;
    const cards = [...container.querySelectorAll<HTMLElement>("[data-project-id]")]
      .map((element, index) => ({ index, rect: element.getBoundingClientRect() }));
    if (!cards.length) return null;
    const rows: { top: number; bottom: number; cards: typeof cards }[] = [];
    for (const card of cards) {
      const row = rows[rows.length - 1];
      if (row && Math.abs(row.top - card.rect.top) < 5) {
        row.bottom = Math.max(row.bottom, card.rect.bottom); row.cards.push(card);
      } else rows.push({ top: card.rect.top, bottom: card.rect.bottom, cards: [card] });
    }
    const row = rows.reduce((closest, candidate) => {
      const distance = (item: typeof candidate) => y < item.top ? item.top - y : y > item.bottom ? y - item.bottom : 0;
      return distance(candidate) < distance(closest) ? candidate : closest;
    });
    if (row.cards.length === 1) return y < row.cards[0].rect.top + row.cards[0].rect.height / 2 ?
      row.cards[0].index : row.cards[0].index + 1;
    return row.cards.find((card) => x < card.rect.left + card.rect.width / 2)?.index ??
      row.cards[row.cards.length - 1].index + 1;
  }

  /** 포인터 캡처와 고스트를 풀되 저장된 카드 순서는 바꾸지 않는다. */
  function clearDrag() {
    const current = drag.current;
    drag.current = null;
    if (scrollTimer.current) clearInterval(scrollTimer.current);
    scrollTimer.current = null; scrollDirection.current = 0; pointerPosition.current = null;
    if (current?.kind === "handle" && current.handle.hasPointerCapture(current.pointerId))
      current.handle.releasePointerCapture(current.pointerId);
    setDraggingId(null); setDropBoundary(null); setGhost(null);
  }

  /** 409가 나면 관리자 기준과 공개 카드 페이지를 모두 최신 순서로 다시 읽는다. */
  function reload() {
    clearDrag();
    baseIdsRef.current = null; setBaseIds(null);
    setPage(0); setLoaded(-1); setTotalPages(0); setItems([]); setLoading(true);
    setRetry((value) => value + 1); setOrderRetry((value) => value + 1);
  }

  /** 실제 놓기 또는 키보드 이동 한 번에만 전체 순서를 저장하고 실패하면 화면을 되돌린다. */
  async function commitMove(id: number, boundary: number) {
    const base = baseIdsRef.current;
    if (!canOrder || savingRef.current || !base) return;
    const previous = items;
    const next = moveToBoundary(previous, id, boundary);
    if (next === previous) return;
    const ids = fullOrder(base, previous, next);
    if (ids.every((item, index) => item === base[index])) return;
    savingRef.current = true; setSaving(true); setSaveError("");
    setItems(next);
    const controller = new AbortController();
    saveController.current = controller;
    try {
      await auth.adminWrite("PUT", "/api/v1/admin/projects/order", { baseIds: base, projectIds: ids }, controller.signal);
      if (controller.signal.aborted) return;
      baseIdsRef.current = ids; setBaseIds(ids);
      setAnnouncement(`${next.find((item) => item.id === id)?.name ?? "프로젝트"} ${next.findIndex((item) => item.id === id) + 1}번째로 이동했습니다.`);
    } catch (failure) {
      if (controller.signal.aborted) return;
      setItems(previous);
      if (failure instanceof ApiFailure && failure.status === 409) {
        setAnnouncement("순서가 다른 곳에서 바뀌어 최신 목록을 다시 불러옵니다.");
        reload();
      } else setSaveError(`순서를 저장하지 못해 원래대로 되돌렸습니다. ${apiFailureMessage(failure)}`);
    } finally {
      if (saveController.current === controller) saveController.current = null;
      savingRef.current = false; setSaving(false);
    }
  }

  /** 마우스는 카드 전체를 끌고, 제목 링크는 드래그가 시작되지 않으면 정상 이동한다. */
  function startNative(event: DragEvent<HTMLElement>, id: number) {
    if (!canOrder || (event.target instanceof Element && event.target.closest(".project-order-handle"))) {
      event.preventDefault(); return;
    }
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", `project:${id}`);
    event.dataTransfer.setDragImage(event.currentTarget, event.currentTarget.clientWidth / 2, 24);
    drag.current = { kind: "native", id };
    suppressClickUntil.current = Date.now() + 500;
    setDraggingId(id);
  }

  /** 터치·펜에서도 동작하도록 손잡이는 Pointer Events 캡처로 움직인다. */
  function startHandle(event: PointerEvent<HTMLButtonElement>, id: number) {
    if (!canOrder || !event.isPrimary || event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { kind: "handle", id, pointerId: event.pointerId, handle: event.currentTarget,
      startX: event.clientX, startY: event.clientY, active: false };
  }

  /** 이동 거리 5px 이후에만 손잡이 고스트와 카드 삽입선을 표시한다. */
  function moveHandle(event: PointerEvent<HTMLButtonElement>) {
    const current = drag.current;
    if (!current || current.kind !== "handle" || current.pointerId !== event.pointerId) return;
    if (!current.active && Math.hypot(event.clientX - current.startX, event.clientY - current.startY) < 5) return;
    current.active = true; event.preventDefault();
    setDraggingId(current.id); setDropBoundary(boundaryAt(event.clientX, event.clientY));
    pointerPosition.current = { x: event.clientX, y: event.clientY };
    scrollDirection.current = event.clientY < 56 ? -1 : event.clientY > window.innerHeight - 56 ? 1 : 0;
    if (scrollDirection.current && !scrollTimer.current) scrollTimer.current = setInterval(() => {
      if (drag.current?.kind !== "handle" || !pointerPosition.current) return;
      window.scrollBy(0, scrollDirection.current * 12);
      setDropBoundary(boundaryAt(pointerPosition.current.x, pointerPosition.current.y));
    }, 16);
    else if (!scrollDirection.current && scrollTimer.current) {
      clearInterval(scrollTimer.current); scrollTimer.current = null;
    }
    const name = items.find((item) => item.id === current.id)?.name ?? "프로젝트";
    setGhost({ name,
      x: Math.max(8, Math.min(event.clientX + 12, window.innerWidth - Math.min(220, window.innerWidth * .8) - 8)),
      y: Math.max(8, Math.min(event.clientY + 12, window.innerHeight - 44)) });
  }

  /** 손잡이를 실제 카드 그리드 안에서 놓았을 때만 저장한다. */
  function finishHandle(event: PointerEvent<HTMLButtonElement>) {
    const current = drag.current;
    if (!current || current.kind !== "handle" || current.pointerId !== event.pointerId) return;
    const boundary = current.active ? boundaryAt(event.clientX, event.clientY) : null;
    if (current.active) suppressClickUntil.current = Date.now() + 500;
    clearDrag();
    if (boundary !== null) void commitMove(current.id, boundary);
  }

  /** 손잡이에서 화살표·Home·End를 누르면 즉시 한 단계 저장하고 초점을 유지한다. */
  function keyMove(event: KeyboardEvent<HTMLButtonElement>, id: number) {
    if (!canOrder || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const from = items.findIndex((item) => item.id === id);
    if (from < 0) return;
    const key = event.key;
    if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"].includes(key)) return;
    event.preventDefault();
    const to = key === "ArrowUp" || key === "ArrowLeft" ? Math.max(0, from - 1) :
      key === "ArrowDown" || key === "ArrowRight" ? Math.min(items.length - 1, from + 1) :
        key === "Home" ? 0 : items.length - 1;
    if (to !== from) { restoreFocusId.current = id; void commitMove(id, to > from ? to + 1 : to); }
  }

  return <main id="main-content" className="page-container projects-page">
    <div className="projects-heading"><h1>Projects</h1></div>
    {items.length === 0 && !loading && !error && <p className="projects-empty">아직 출간된 프로젝트가 없습니다.</p>}
    {admin && orderError && <p className="project-order-notice" role="alert">순서를 불러오지 못했습니다. {orderError} <button type="button"
      className="small-button" onClick={() => setOrderRetry((value) => value + 1)}>다시 시도</button></p>}
    {admin && allLoaded && !saving && baseIds && !orderMatches && <p className="project-order-notice" role="alert">프로젝트 목록이 바뀌었습니다.
      <button type="button" className="small-button" onClick={reload}>다시 불러오기</button></p>}
    {saveError && <p className="project-order-notice" role="alert">{saveError}</p>}
    {saving && <p className="project-order-notice" role="status">프로젝트 순서를 저장하고 있습니다…</p>}
    <p className="sr-only" aria-live="polite">{announcement}</p>
    {admin && <p id="project-order-help" className="sr-only">마우스는 카드를 끌고, 터치는 손잡이를 끕니다. 손잡이에서 방향키나 Home, End로 이동할 수 있습니다.</p>}
    <div ref={grid} className={`projects-grid${canOrder ? " is-orderable" : ""}`}
      onDragOver={(event) => {
        if (drag.current?.kind !== "native" || !canOrder) return;
        const boundary = boundaryAt(event.clientX, event.clientY);
        if (boundary === null) { setDropBoundary(null); return; }
        event.preventDefault(); event.dataTransfer.dropEffect = "move"; setDropBoundary(boundary);
      }}
      onDragLeave={(event) => {
        if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget))
          setDropBoundary(null);
      }}
      onDrop={(event) => {
        const current = drag.current;
        if (!current || current.kind !== "native") return;
        event.preventDefault();
        const boundary = canOrder ? boundaryAt(event.clientX, event.clientY) : null;
        clearDrag();
        if (boundary !== null) void commitMove(current.id, boundary);
      }}>
      {items.map((item, index) => <article key={item.id} data-project-id={item.id}
        draggable={canOrder} onDragStart={(event) => startNative(event, item.id)} onDragEnd={() => {
          suppressClickUntil.current = Date.now() + 500; clearDrag();
        }}
        onClickCapture={(event) => { if (Date.now() < suppressClickUntil.current) { event.preventDefault(); event.stopPropagation(); } }}
        className={`project-card card hv${draggingId === item.id ? " is-dragging" : ""}${dropBoundary === index ? " drop-before" : ""}${dropBoundary === items.length && index === items.length - 1 ? " drop-after" : ""}`}>
        <div className="project-card-top"><span className={`project-status project-status-${item.status.toLowerCase()}`}>
          <span aria-hidden="true" />{projectStatusLabel(item.status)}</span>
          {formatProjectPeriod(item.startPeriod, item.endPeriod, item.status) && <span className="mono project-period">
            {formatProjectPeriod(item.startPeriod, item.endPeriod, item.status)}</span>}
          {item.visibility === "PRIVATE" && <span className="project-private">나만 보기</span>}
          {admin && <button type="button" className="project-order-handle" disabled={!canOrder}
            aria-label={`${item.name} 순서 이동, ${index + 1}번째`} aria-describedby="project-order-help"
            aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Home End"
            onKeyDown={(event) => keyMove(event, item.id)}
            onPointerDown={(event) => startHandle(event, item.id)} onPointerMove={moveHandle}
            onPointerUp={finishHandle} onPointerCancel={clearDrag} onLostPointerCapture={clearDrag}>
            <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor" aria-hidden="true">
              <circle cx="6" cy="4" r="1.3" /><circle cx="12" cy="4" r="1.3" />
              <circle cx="6" cy="9" r="1.3" /><circle cx="12" cy="9" r="1.3" />
              <circle cx="6" cy="14" r="1.3" /><circle cx="12" cy="14" r="1.3" />
            </svg>
          </button>}</div>
        <h2><Link href={`/project/?slug=${encodeURIComponent(item.slug)}`}>{item.name}</Link></h2>
        <p>{item.overview}</p>
        {item.stackBadges.length > 0 && <div className="stack-badges">{item.stackBadges.map((badge) => <span key={badge.id}>
          {publicImageUrl(badge.imageUrl) && <Image src={publicImageUrl(badge.imageUrl)!} alt="" width={22} height={22} unoptimized />}
          {badge.name}</span>)}</div>}
        <div className="project-card-counts">문서 {item.documentCount}개{item.relatedTechCount > 0 ? ` · 관련 글 ${item.relatedTechCount}개` : ""}</div>
      </article>)}
      {admin && <Link className="project-card project-create-card" href="/write/?section=project-home">
        <span aria-hidden="true">＋</span><span>새 프로젝트</span></Link>}
    </div>
    {ghost && <div className="project-order-ghost" style={{ left: ghost.x, top: ghost.y }} aria-hidden="true">{ghost.name}</div>}
    {loading && <p role="status">프로젝트를 불러오고 있습니다…</p>}
    {error && <p role="alert">{error} <button type="button" className="small-button"
      onClick={() => setRetry((value) => value + 1)}>다시 시도</button></p>}
  </main>;
}

/** 세션이 바뀌면 이전 PRIVATE 카드와 대기 응답을 함께 폐기한다. {@link ProjectsInstance} */
export function ProjectsList() {
  const auth = useAuth();
  return <ProjectsInstance key={auth.epoch} />;
}
