"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { useAuth } from "@/components/auth-provider";
import { ApiFailure, apiFailureMessage } from "@/lib/api";
import { parseProjectOrder, type ProjectOrderItem } from "@/lib/projects";

type Drag = { id: number; pointerId: number; x: number; y: number; active: boolean; handle: HTMLButtonElement };
type Props = { onCancel: () => void; onSaved: () => void };

/** {@link ProjectOrderItem}의 ID만 움직이고 항목 메타데이터는 그대로 보존한다. */
function moveToBoundary(items: ProjectOrderItem[], id: number, boundary: number): ProjectOrderItem[] {
  const from = items.findIndex((item) => item.id === id);
  if (from < 0) return items;
  const destination = Math.max(0, Math.min(boundary, items.length)) - (boundary > from ? 1 : 0);
  if (from === destination) return items;
  const next = [...items];
  const [moving] = next.splice(from, 1);
  next.splice(destination, 0, moving);
  return next;
}

/** 관리자 전체 순서를 읽고 포인터·키보드 순서를 원자적으로 저장한다. */
export function ProjectsOrderEditor({ onCancel, onSaved }: Props) {
  const auth = useAuth();
  const [items, setItems] = useState<ProjectOrderItem[]>([]);
  const [baseIds, setBaseIds] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [retry, setRetry] = useState(0);
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [dropBoundary, setDropBoundary] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const list = useRef<HTMLOListElement | null>(null);
  const drag = useRef<Drag | null>(null);
  const saveController = useRef<AbortController | null>(null);
  const dirty = items.length === baseIds.length && items.some((item, index) => item.id !== baseIds[index]);

  useEffect(() => {
    const controller = new AbortController();
    let live = true;
    setLoading(true); setError(""); setConflict(false); setItems([]); setBaseIds([]);
    void auth.adminRead("/api/v1/admin/projects/order", controller.signal).then((value) => {
      const loaded = parseProjectOrder(value);
      if (!live) return;
      setItems(loaded); setBaseIds(loaded.map((item) => item.id));
      setAnnouncement(""); setLoading(false);
    }).catch((failure) => {
      if (!live || controller.signal.aborted) return;
      setError(apiFailureMessage(failure)); setLoading(false);
    });
    return () => { live = false; controller.abort(); };
  }, [auth.adminRead, retry]);

  useEffect(() => {
    const cancelOnBlur = () => {
      const current = drag.current;
      if (!current) return;
      drag.current = null; setDraggingId(null); setDropBoundary(null);
      if (current.handle.hasPointerCapture(current.pointerId)) current.handle.releasePointerCapture(current.pointerId);
    };
    window.addEventListener("blur", cancelOnBlur);
    return () => {
      window.removeEventListener("blur", cancelOnBlur);
      const current = drag.current;
      drag.current = null;
      if (current?.handle.hasPointerCapture(current.pointerId)) current.handle.releasePointerCapture(current.pointerId);
      saveController.current?.abort();
    };
  }, []);

  /** 보이는 행의 중간점을 기준으로 포인터의 놓기 경계를 고른다. {@link moveToBoundary} */
  function boundaryAt(clientY: number): number {
    const rows = [...(list.current?.querySelectorAll<HTMLElement>("[data-project-order-id]") ?? [])];
    const index = rows.findIndex((row) => clientY < row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2);
    return index < 0 ? rows.length : index;
  }

  /** 목록 밖 가로 여백에 놓은 포인터가 우연히 맨 위·아래 순서로 저장되지 않게 한다. */
  function withinListX(clientX: number): boolean {
    const bounds = list.current?.getBoundingClientRect();
    return !!bounds && clientX >= bounds.left && clientX <= bounds.right;
  }

  /** 마우스·터치·펜의 같은 포인터를 손잡이에 묶고 실제 이동 전까지 순서를 바꾸지 않는다. */
  function startDrag(event: PointerEvent<HTMLButtonElement>, id: number) {
    if (loading || saving || conflict || !event.isPrimary || event.button !== 0) return;
    drag.current = { id, pointerId: event.pointerId, x: event.clientX, y: event.clientY,
      active: false, handle: event.currentTarget };
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  /** 포인터가 다섯 픽셀 이상 움직이면 놓기 위치를 표시하고 긴 목록 가장자리에서는 스크롤한다. */
  function dragOver(event: PointerEvent<HTMLButtonElement>) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if (!current.active && Math.hypot(event.clientX - current.x, event.clientY - current.y) < 5) return;
    current.active = true;
    event.preventDefault();
    const box = list.current;
    if (box && withinListX(event.clientX)) {
      const bounds = box.getBoundingClientRect();
      if (event.clientY < bounds.top + 35) box.scrollTop -= 16;
      else if (event.clientY > bounds.bottom - 35) box.scrollTop += 16;
    }
    setDraggingId(current.id);
    setDropBoundary(withinListX(event.clientX) ? boundaryAt(event.clientY) : null);
  }

  /** 놓인 한 번에만 로컬 순서를 바꾸고 저장은 별도 버튼에서 실행한다. {@link moveToBoundary} */
  function finishDrag(event: PointerEvent<HTMLButtonElement>) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if (current.active && withinListX(event.clientX)) {
      const boundary = boundaryAt(event.clientY);
      setItems((previous) => moveToBoundary(previous, current.id, boundary));
      setAnnouncement("프로젝트 순서를 바꿨습니다. 저장하면 적용됩니다.");
    } else if (current.active) setAnnouncement("이동을 취소했습니다.");
    drag.current = null; setDraggingId(null); setDropBoundary(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  /** 취소된 포인터는 순서를 바꾸지 않고 삽입선만 지운다. */
  function cancelDrag(event: PointerEvent<HTMLButtonElement>) {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null; setDraggingId(null); setDropBoundary(null);
  }

  /** 손잡이의 방향키·Home·End로 순서를 바꾸며 같은 손잡이에 초점을 유지한다. */
  function keyMove(event: KeyboardEvent<HTMLButtonElement>, id: number) {
    if (loading || saving || conflict) return;
    if (event.key === "Escape" && drag.current?.id === id) {
      event.preventDefault();
      const pointerId = drag.current.pointerId;
      drag.current = null; setDraggingId(null); setDropBoundary(null);
      if (event.currentTarget.hasPointerCapture(pointerId)) event.currentTarget.releasePointerCapture(pointerId);
      setAnnouncement("이동을 취소했습니다.");
      return;
    }
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const from = items.findIndex((item) => item.id === id);
    if (from < 0) return;
    const to = event.key === "ArrowUp" ? from - 1 : event.key === "ArrowDown" ? from + 1 :
      event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : -1;
    if (to < 0) return;
    event.preventDefault();
    if (to === from || to >= items.length) return;
    setItems((previous) => moveToBoundary(previous, id, to > from ? to + 1 : to));
    setAnnouncement(`${items[from].name} ${to + 1}번째`);
  }

  /** GET 순서와 전체 ID 집합을 함께 보내 오래된 편집 결과를 409로 구별한다. */
  async function save() {
    if (loading || saving || conflict || !dirty) return;
    const controller = new AbortController();
    saveController.current = controller;
    setSaving(true); setError("");
    try {
      await auth.adminWrite("PUT", "/api/v1/admin/projects/order",
        { baseIds, projectIds: items.map((item) => item.id) }, controller.signal);
      onSaved();
    } catch (failure) {
      if (controller.signal.aborted) return;
      if (failure instanceof ApiFailure && failure.status === 409) {
        setConflict(true);
        setError("프로젝트 순서가 다른 곳에서 바뀌었습니다. 다시 불러온 뒤 편집해 주세요.");
      } else setError(apiFailureMessage(failure));
    } finally {
      if (saveController.current === controller) saveController.current = null;
      setSaving(false);
    }
  }

  return <section className="projects-order-editor card" aria-label="프로젝트 순서 편집">
    <div className="projects-order-top"><div><h2>프로젝트 순서</h2>
      <p>손잡이를 끌거나 방향키로 순서를 바꿀 수 있습니다.</p></div>
      <button type="button" className="small-button" disabled={saving} onClick={onCancel}>취소</button></div>
    {loading ? <p role="status">프로젝트 순서를 불러오고 있습니다…</p> : <>
      {error && <p role="alert" className="projects-order-error">{error}{conflict || !items.length && !baseIds.length ?
        <button type="button" className="small-button" onClick={() => setRetry((value) => value + 1)}>다시 불러오기</button> : null}</p>}
      {!error && !items.length && <p>순서를 바꿀 프로젝트가 없습니다.</p>}
      {items.length > 0 && <ol ref={list} className="projects-order-list" aria-label="프로젝트 중요도 순서">
        {items.map((item, index) => <li key={item.id} data-project-order-id={item.id}
          className={`${draggingId === item.id ? "is-dragging" : ""}${dropBoundary === index ? " drop-before" : ""}`}>
          <span className="projects-order-number" aria-hidden="true">{index + 1}</span>
          <div className="projects-order-name"><strong>{item.name}</strong>
            {item.visibility === "PRIVATE" && <small>나만 보기</small>}</div>
          <button type="button" className="projects-order-handle" disabled={saving || conflict}
            aria-label={`${item.name} 순서 이동, 현재 ${index + 1}번째`}
            aria-keyshortcuts="ArrowUp ArrowDown Home End"
            onKeyDown={(event) => keyMove(event, item.id)}
            onPointerDown={(event) => startDrag(event, item.id)}
            onPointerMove={dragOver} onPointerUp={finishDrag} onPointerCancel={cancelDrag}
            onLostPointerCapture={cancelDrag}>⋮⋮</button>
        </li>)}
        {dropBoundary === items.length && <li className="projects-order-drop-end" aria-hidden="true" />}
      </ol>}
      <p className="sr-only" aria-live="polite">{announcement}</p>
      <div className="projects-order-actions">
        {error && !conflict && items.length > 0 && <button type="button" className="small-button"
          onClick={() => setRetry((value) => value + 1)}>다시 불러오기</button>}
        <button type="button" className="primary-button" disabled={!dirty || saving || conflict || !!error && !items.length}
          onClick={() => void save()}>{saving ? "저장 중…" : "순서 저장"}</button>
      </div>
    </>}
  </section>;
}
