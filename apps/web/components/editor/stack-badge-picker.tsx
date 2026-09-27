"use client";

import Image from "next/image";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { apiFailureMessage } from "@/lib/api";
import { publicImageUrl } from "@/lib/profile";
import { parseStackBadges, type StackBadge } from "@/lib/stack-badges";
import { useAuth } from "@/components/auth-provider";

type BadgeDrag = { pointerId: number; handle: HTMLButtonElement; name: string; startX: number; startY: number; active: boolean };

/** {@link StackBadgePicker}의 선택·검색에서 서버와 같은 대소문자 무시 이름 키를 만든다. */
function nameKey(name: string): string { return name.trim().toLowerCase(); }

/** {@link searchRank}에서 공백·점·하이픈·밑줄만 무시하고 C++·C#은 구분한다. */
function compactKey(name: string): string { return nameKey(name).replace(/[\s._-]+/g, ""); }

/** {@link searchRank}에서 표시 이름을 유지하면서 의미가 분명한 기술 약어를 찾는다. */
function searchTerms(name: string): string[] {
  const key = nameKey(name);
  if (key === "google cloud") return [key, "gcp"];
  if (key === "kotlin multiplatform") return [key, "kmp"];
  if (key === "javascript") return [key, "js"];
  if (key === "typescript") return [key, "ts"];
  if (key === "kubernetes") return [key, "k8s"];
  if (key === "oracle cloud") return [key, "oci"];
  if (key === "postgresql") return [key, "postgres"];
  return [key];
}

/** {@link searchTerms}의 정확한 이름·별칭, 접두어, 포함 순으로 후보를 정렬한다. */
function searchRank(name: string, query: string): number {
  const needle = nameKey(query);
  const compact = compactKey(query);
  const terms = searchTerms(name);
  if (terms[0] === needle) return 0;
  if (terms.slice(1).includes(needle)) return 1;
  if (compact && compactKey(terms[0]) === compact) return 2;
  if (compact && terms.slice(1).some((term) => compactKey(term) === compact)) return 3;
  if (terms.some((term) => term.startsWith(needle))) return 4;
  if (compact && terms.some((term) => compactKey(term).startsWith(compact))) return 5;
  if (terms.some((term) => term.includes(needle))) return 6;
  if (compact && terms.some((term) => compactKey(term).includes(compact))) return 7;
  return Number.POSITIVE_INFINITY;
}

/** {@link parseStackBadges}의 실제 레지스트리만 검색·선택하고 대문 기술 스택 순서를 편집한다. */
export function StackBadgePicker({ value, onChange, onCatalogChange, disabled = false }: {
  value: string[]; onChange: (names: string[]) => void; onCatalogChange?: (badges: StackBadge[] | null) => void; disabled?: boolean;
}) {
  const auth = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const chipsRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<BadgeDrag | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  valueRef.current = value;
  onChangeRef.current = onChange;
  const listId = useId();
  const [badges, setBadges] = useState<StackBadge[]>([]);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [composing, setComposing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [dropBoundary, setDropBoundary] = useState<number | null>(null);
  const [dragGhost, setDragGhost] = useState<{ name: string; x: number; y: number } | null>(null);
  const [movedName, setMovedName] = useState<string | null>(null);
  const [orderMessage, setOrderMessage] = useState("");
  const orderHelpId = `${listId}-order-help`;

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    onCatalogChange?.(null);
    void auth.adminRead("/api/v1/admin/stack-badges", controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) {
          const next = parseStackBadges(result);
          setBadges(next); onCatalogChange?.(next); setError("");
        }
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setError(apiFailureMessage(failure));
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [auth.adminRead, onCatalogChange, retry]);

  useEffect(() => () => { if (flashTimer.current) clearTimeout(flashTimer.current); }, []);

  useEffect(() => {
    const onEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && dragRef.current) {
        event.preventDefault(); event.stopPropagation(); cancelDrag();
      }
    };
    window.addEventListener("keydown", onEscape, true);
    window.addEventListener("blur", cancelDrag);
    return () => {
      window.removeEventListener("keydown", onEscape, true);
      window.removeEventListener("blur", cancelDrag);
      const drag = dragRef.current;
      dragRef.current = null;
      if (drag?.handle.hasPointerCapture(drag.pointerId)) drag.handle.releasePointerCapture(drag.pointerId);
    };
  }, []);

  const choices = useMemo<StackBadge[]>(() => {
    const chosen = new Set(value.map(nameKey));
    return badges.filter((badge) => !chosen.has(nameKey(badge.name)) && Number.isFinite(searchRank(badge.name, query)))
      .sort((left, right) => {
        return searchRank(left.name, query) - searchRank(right.name, query) ||
          (right.projectCount ?? 0) - (left.projectCount ?? 0) || left.name.localeCompare(right.name, "ko");
      });
  }, [badges, query, value]);
  const activeIndex = choices.length ? Math.min(active, choices.length - 1) : 0;

  useEffect(() => {
    if (open && choices[activeIndex]) document.getElementById(`${listId}-${activeIndex}`)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, choices, listId, open]);

  /** {@link StackBadgePicker}의 등록된 뱃지만 순서를 유지해 대문 이름 배열에 추가한다. */
  function select(badge: StackBadge) {
    const current = valueRef.current;
    if (current.length >= 30) { setError("기술 스택은 30개까지 선택할 수 있습니다."); return; }
    if (!current.some((item) => nameKey(item) === nameKey(badge.name))) onChangeRef.current([...current, badge.name]);
    setQuery(""); setOpen(false); setActive(0); setError("");
    inputRef.current?.focus();
  }

  /** {@link select}의 ↑↓·Enter·Esc 탐색과 빈 입력 Backspace의 마지막 선택 제거를 처리한다. */
  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") { event.preventDefault(); setOpen(false); return; }
    if (composing || event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "Backspace" && !query && value.length) {
      event.preventDefault(); onChange(value.slice(0, -1)); return;
    }
    if (event.key === "ArrowDown" && choices.length) {
      event.preventDefault(); setOpen(true); setActive((index) => (index + 1) % choices.length); return;
    }
    if (event.key === "ArrowUp" && choices.length) {
      event.preventDefault(); setOpen(true); setActive((index) => (index - 1 + choices.length) % choices.length); return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (!open) { setOpen(true); return; }
      const choice = choices[activeIndex];
      if (choice) select(choice);
    }
  }

  /** {@link StackBadgePicker}의 선택 칩을 접힌 줄까지 읽어 포인터 삽입 경계를 찾는다. */
  function boundaryAt(x: number, y: number): number | null {
    const container = chipsRef.current;
    if (!container) return null;
    const area = container.getBoundingClientRect();
    if (x < area.left - 24 || x > area.right + 24 || y < area.top - 24 || y > area.bottom + 24) return null;
    const chips = [...container.querySelectorAll<HTMLElement>("[data-stack-chip]")]
      .map((element, index) => ({ index, rect: element.getBoundingClientRect() }));
    if (!chips.length) return null;
    if (y < chips[0].rect.top) return 0;
    if (y > chips[chips.length - 1].rect.bottom) return chips.length;
    const rows: { top: number; bottom: number; chips: typeof chips }[] = [];
    for (const chip of chips) {
      const row = rows[rows.length - 1];
      if (row && Math.abs(row.top - chip.rect.top) < 5) { row.bottom = Math.max(row.bottom, chip.rect.bottom); row.chips.push(chip); }
      else rows.push({ top: chip.rect.top, bottom: chip.rect.bottom, chips: [chip] });
    }
    const row = rows.reduce((closest, candidate) => {
      const distance = (item: typeof candidate) => y < item.top ? item.top - y : y > item.bottom ? y - item.bottom : 0;
      return distance(candidate) < distance(closest) ? candidate : closest;
    });
    return row.chips.find((chip) => x < chip.rect.left + chip.rect.width / 2)?.index ??
      row.chips[row.chips.length - 1].index + 1;
  }

  /** {@link StackBadgePicker}의 이름 배열만 삽입 경계로 재정렬해 저장 계약의 순서를 보존한다. */
  function reorder(name: string, boundary: number) {
    const current = valueRef.current;
    const from = current.indexOf(name);
    if (disabled || from < 0) return;
    const target = Math.max(0, Math.min(current.length, boundary));
    const to = target > from ? target - 1 : target;
    if (to === from) return;
    const next = [...current]; next.splice(from, 1); next.splice(to, 0, name);
    onChangeRef.current(next);
    setMovedName(name); setOrderMessage(`${name}을 ${to + 1}번째로 옮겼습니다.`);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setMovedName(null), 700);
  }

  /** {@link reorder}용 손잡이 포인터를 잡고 제거 버튼 클릭과 구분한다. */
  function beginDrag(event: ReactPointerEvent<HTMLButtonElement>, name: string) {
    if (disabled || !event.isPrimary || event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, handle: event.currentTarget, name,
      startX: event.clientX, startY: event.clientY, active: false };
  }

  /** {@link boundaryAt}의 위치를 삽입선과 손잡이 고스트에 표시한다. */
  function moveDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.active && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 5) return;
    drag.active = true; event.preventDefault();
    setDropBoundary(boundaryAt(event.clientX, event.clientY));
    setDragGhost({ name: drag.name,
      x: Math.max(8, Math.min(event.clientX + 12, window.innerWidth - Math.min(220, window.innerWidth * .8) - 8)),
      y: Math.max(8, Math.min(event.clientY + 12, window.innerHeight - 44)) });
  }

  /** {@link beginDrag}의 포인터 캡처와 삽입 표시를 Escape·창 이탈 때 되돌린다. */
  function cancelDrag() {
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag?.handle.hasPointerCapture(drag.pointerId)) drag.handle.releasePointerCapture(drag.pointerId);
    setDropBoundary(null); setDragGhost(null);
  }

  /** 포인터를 놓은 때에만 {@link reorder}를 확정하고 취소되면 원래 배열을 둔다. */
  function endDrag(event: ReactPointerEvent<HTMLButtonElement>, cancelled = false) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const boundary = !cancelled && drag.active ? boundaryAt(event.clientX, event.clientY) : null;
    cancelDrag();
    if (boundary !== null) reorder(drag.name, boundary);
  }

  const locked = disabled;
  return <div className="stack-picker" onBlur={(event) => {
    if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
    <span id={orderHelpId} className="sr-only">이동 손잡이를 끌어 순서를 바꾸거나 Alt와 방향키를 함께 누르세요.</span>
    <span className="sr-only" role="status">{orderMessage}</span>
    <div ref={chipsRef} className="stack-picker-chips">{value.map((name, index) => {
      const badge = badges.find((item) => nameKey(item.name) === nameKey(name));
      const image = badge ? publicImageUrl(badge.imageUrl) : null;
      return <div key={name} data-stack-chip data-drop-before={dropBoundary === index || undefined}
        data-drop-after={dropBoundary === value.length && index === value.length - 1 || undefined}
        className={`stack-picker-chip${movedName === name ? " moved" : ""}`}>
        <button type="button" className="stack-picker-drag-handle" disabled={locked}
          aria-label={`${name} 순서 이동, ${index + 1}/${value.length}`} aria-describedby={orderHelpId}
          aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight Alt+ArrowUp Alt+ArrowDown"
          onPointerDown={(event) => beginDrag(event, name)} onPointerMove={moveDrag}
          onPointerUp={endDrag} onPointerCancel={(event) => endDrag(event, true)}
          onLostPointerCapture={(event) => endDrag(event, true)}
          onKeyDown={(event) => {
            if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || locked) return;
            if ((event.key === "ArrowLeft" || event.key === "ArrowUp") && index > 0) {
              event.preventDefault(); reorder(name, index - 1);
            } else if ((event.key === "ArrowRight" || event.key === "ArrowDown") && index < value.length - 1) {
              event.preventDefault(); reorder(name, index + 2);
            }
          }}>
          <svg width="14" height="18" viewBox="0 0 14 18" fill="currentColor" aria-hidden="true">
            <circle cx="4" cy="4" r="1.4" /><circle cx="10" cy="4" r="1.4" />
            <circle cx="4" cy="9" r="1.4" /><circle cx="10" cy="9" r="1.4" />
            <circle cx="4" cy="14" r="1.4" /><circle cx="10" cy="14" r="1.4" />
          </svg>
        </button>
        {image && <Image src={image} width={20} height={20} draggable={false} unoptimized alt="" />}
        <span className="stack-picker-chip-name">{name}</span>
        <button type="button" className="stack-picker-remove" disabled={locked} aria-label={`${name} 기술 스택 제거`}
          onClick={() => onChange(value.filter((item) => item !== name))}><span aria-hidden="true">×</span></button>
      </div>;
    })}</div>
    {dragGhost && <div className="stack-picker-drag-ghost" style={{ left: dragGhost.x, top: dragGhost.y }}
      aria-hidden="true">{dragGhost.name}</div>}
    <div className="stack-picker-combobox">
      <input id="write-stack" ref={inputRef} role="combobox" aria-autocomplete="list" aria-expanded={open && !locked}
        aria-controls={open ? listId : undefined} aria-activedescendant={open && choices[activeIndex] ? `${listId}-${activeIndex}` : undefined}
        value={query} maxLength={100} autoComplete="off" disabled={locked} placeholder="기술 스택 입력"
        onFocus={() => setOpen(true)} onChange={(event) => { setQuery(event.target.value); setActive(0); setOpen(true); setError(""); }}
        onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)} onKeyDown={onKeyDown} />
      {open && !locked && <div id={listId} className="stack-picker-options" role="listbox" aria-label="기술 스택 후보">
        {choices.map((choice, index) => {
          const image = publicImageUrl(choice.imageUrl);
          return <button key={choice.id} type="button" role="option"
            id={`${listId}-${index}`} aria-selected={activeIndex === index} className={activeIndex === index ? "stack-picker-option active" : "stack-picker-option"}
            onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setActive(index)} onClick={() => select(choice)}>
            <span className="stack-picker-option-name">{image && <Image src={image} width={22}
              height={22} unoptimized alt="" />}{choice.name}</span><span className="stack-picker-option-count">
              프로젝트 {choice.projectCount ?? 0}</span>
          </button>;
        })}
        {!loading && !error && choices.length === 0 && <p className="stack-picker-empty">검색 결과가 없습니다.</p>}
      </div>}
    </div>
    {loading && <p className="stack-picker-status" role="status">기술 스택을 불러오고 있습니다…</p>}
    {error && <p className="inline-error" role="alert">{error} <button type="button" className="small-button"
      disabled={locked} onClick={() => setRetry((current) => current + 1)}>목록 다시 읽기</button></p>}
  </div>;
}
