"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import type { AdminProject } from "@/lib/projects";

type Props = { projects: AdminProject[]; selected: number | null; disabled: boolean;
  hasMore: boolean; loadingMore: boolean; error: string;
  onSelect: (id: number | null) => void; onMore: () => void };

/** {@link ProjectPicker}의 선택 항목을 이름이 같은 프로젝트라도 ID로 구별한다. */
function choiceId(project: AdminProject | null): number | null { return project?.id ?? null; }

/** 관련 프로젝트를 앱 색상에 맞는 목록으로 표시하고 키보드·바깥 클릭으로 제어한다. */
export function ProjectPicker({ projects, selected, disabled, hasMore, loadingMore, error, onSelect, onMore }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const choices: Array<AdminProject | null> = [null, ...projects];
  const selectedIndex = Math.max(0, choices.findIndex((project) => choiceId(project) === selected));
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(selectedIndex);
  const [moreUsed, setMoreUsed] = useState(false);
  const activeIndex = Math.min(active, choices.length - 1);
  const selectedProject = projects.find((project) => project.id === selected);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  useEffect(() => {
    if (open) document.getElementById(`${listId}-${activeIndex}`)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, listId, open]);

  /** {@link ProjectPicker}의 목록을 현재 선택 항목에서 열고 트리거에 초점을 유지한다. */
  function show() { setActive(selectedIndex); setOpen(true); trigger.current?.focus(); }

  /** {@link ProjectPicker}의 선택 변경 뒤 목록을 닫고 트리거 초점을 복원한다. */
  function choose(id: number | null) {
    onSelect(id); setOpen(false); trigger.current?.focus();
  }

  /** {@link ProjectPicker}에서 ↑↓·Home·End·Enter·Escape 탐색을 처리한다. */
  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return;
    if (event.key === "Escape" && open) {
      event.preventDefault(); setOpen(false); trigger.current?.focus(); return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) { show(); return; }
      setActive((index) => Math.max(0, Math.min(choices.length - 1, index + (event.key === "ArrowDown" ? 1 : -1))));
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault(); setOpen(true); setActive(event.key === "Home" ? 0 : choices.length - 1); return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (open) choose(choiceId(choices[activeIndex])); else show();
    }
  }

  return <div className="editor-project-picker" ref={root} onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }} onKeyDown={(event) => {
    if (event.target !== trigger.current && event.key === "Escape" && open) {
      event.preventDefault(); setOpen(false); trigger.current?.focus();
    }
  }}>
    <button ref={trigger} type="button" role="combobox" className={`editor-compact-button editor-project-select${selected !== null ? " selected" : ""}`}
      aria-label="관련 프로젝트" aria-haspopup="listbox" aria-expanded={open && !disabled} aria-controls={open ? listId : undefined}
      aria-activedescendant={open ? `${listId}-${activeIndex}` : undefined} disabled={disabled}
      onClick={() => { if (open) setOpen(false); else show(); }} onKeyDown={onKeyDown}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18" /></svg>
      <span className="editor-project-current">{selectedProject?.name ?? (selected === null ? "프로젝트 없음" : "선택한 프로젝트")}</span>
      <span aria-hidden="true">⌄</span>
    </button>
    {open && !disabled && <div className="editor-project-popover">
      <div id={listId} className="editor-project-options" role="listbox" aria-label="관련 프로젝트 목록" tabIndex={-1}>{choices.map((project, index) => {
        const id = choiceId(project);
        return <button id={`${listId}-${index}`} key={id ?? "none"} type="button" role="option"
          className={`editor-project-option${index === activeIndex ? " active" : ""}`}
          aria-selected={selected === id} tabIndex={-1} onMouseDown={(event) => event.preventDefault()}
          onMouseEnter={() => setActive(index)} onClick={() => choose(id)}>
          <span className="editor-project-option-name">{project?.name ?? "없음"}</span>
          {project?.visibility === "PRIVATE" && <small>비공개</small>}
          <span className="editor-project-check" aria-hidden="true">{selected === id ? "✓" : ""}</span>
        </button>;
      })}</div>
      {(hasMore || moreUsed) && <button type="button" className="editor-project-more" aria-disabled={loadingMore || !hasMore}
        onMouseDown={(event) => event.preventDefault()} onClick={() => {
          if (loadingMore || !hasMore) return;
          setMoreUsed(true); onMore();
        }}>
        {loadingMore ? "프로젝트 불러오는 중…" : hasMore ? "더보기" : "모든 프로젝트를 불러왔습니다"}</button>}
      {error && <p className="editor-project-error" role="alert">{error}</p>}
    </div>}
  </div>;
}
