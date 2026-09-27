"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

/** {@link FieldChoice}에서 기존 분야 선택과 새 분야 입력을 같은 폼 값으로 전환한다. */
export function FieldChoice({ value, fields, onChange }: { value: string; fields: string[];
  onChange: (value: string) => void }) {
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const optionRefs = useRef<Array<HTMLDivElement | null>>([]);
  const optionPointer = useRef(false);
  const labelId = useId();
  const valueId = useId();
  const listId = useId();
  const options = [...new Set(fields)];
  const optionCount = options.length + 1;
  const selected = options.indexOf(value);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) {
        optionPointer.current = false;
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeOutside, true);
    return () => document.removeEventListener("pointerdown", closeOutside, true);
  }, [open]);

  useEffect(() => {
    if (adding) input.current?.focus();
  }, [adding]);

  useEffect(() => {
    if (open) optionRefs.current[active]?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  /** {@link FieldChoice}의 열린 목록에서 고른 분야를 폼에 적용한다. */
  function choose(index: number) {
    optionPointer.current = false;
    setOpen(false);
    if (index === options.length) {
      onChange("");
      setAdding(true);
    } else {
      onChange(options[index]);
      trigger.current?.focus();
    }
  }

  /** 새 분야 입력을 취소하고 기존 분야 선택으로 돌아간다. {@link FieldChoice} */
  function cancelAdding() {
    setAdding(false);
    onChange(options[0] ?? "");
    requestAnimationFrame(() => trigger.current?.focus());
  }

  /** 펼친 목록의 활성 행만 옮기고 선택은 Enter 또는 Space에 확정한다. {@link choose} */
  function onTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Escape" && open) {
      event.preventDefault(); event.stopPropagation(); setOpen(false); return;
    }
    if (event.key === "Tab" && open) { setOpen(false); return; }
    if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {
      event.preventDefault();
      if (!open) {
        setActive(event.key === "End" ? optionCount - 1 : event.key === "Home" ? 0 : selected < 0 ? 0 : selected);
        setOpen(true);
      } else {
        setActive((current) => event.key === "Home" ? 0 : event.key === "End" ? optionCount - 1
          : (current + (event.key === "ArrowDown" ? 1 : -1) + optionCount) % optionCount);
      }
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (open) choose(active);
      else { setActive(selected < 0 ? 0 : selected); setOpen(true); }
    }
  }

  return <div className="field-choice" ref={root} onBlur={(event) => {
    if (!optionPointer.current && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
    <span id={labelId} className="field-choice-label">분야</span>
    {adding ? <span className="field-new">
      <input ref={input} value={value} maxLength={80} required placeholder="새 분야 이름"
        aria-labelledby={labelId} onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Escape") {
          event.preventDefault(); event.stopPropagation(); cancelAdding();
        } }} />
      <button type="button" aria-label="기존 분야 선택" onClick={cancelAdding}>×</button>
    </span> : <>
      <button ref={trigger} type="button" id={valueId} className="field-choice-trigger"
        role="combobox" aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined}
        aria-labelledby={`${labelId} ${valueId}`} aria-required="true"
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        onClick={() => { if (open) setOpen(false); else {
          setActive(selected < 0 ? 0 : selected); setOpen(true);
        } }} onKeyDown={onTriggerKeyDown}>
        <span className={value ? "" : "field-choice-placeholder"}>{value || "분야 선택"}</span>
        <svg aria-hidden="true" viewBox="0 0 16 16" fill="none"><path d="m3.5 6 4.5 4 4.5-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {open && <div id={listId} role="listbox" aria-labelledby={labelId} className="field-choice-options"
        onPointerDownCapture={() => { optionPointer.current = true; }}
        onPointerUpCapture={() => { window.setTimeout(() => { optionPointer.current = false; }, 350); }}
        onPointerCancelCapture={() => { optionPointer.current = false; }}>
        {options.map((field, index) => <div key={field} id={`${listId}-${index}`} role="option" tabIndex={-1}
          aria-selected={field === value} className={`field-choice-option${index === active ? " is-active" : ""}`}
          ref={(element) => { optionRefs.current[index] = element; }}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => choose(index)}>
          <span>{field}</span>{field === value && <span className="field-choice-check" aria-hidden="true">✓</span>}
        </div>)}
        <div id={`${listId}-${options.length}`} role="option" tabIndex={-1} aria-selected="false"
          className={`field-choice-option field-choice-add${active === options.length ? " is-active" : ""}`}
          ref={(element) => { optionRefs.current[options.length] = element; }}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => choose(options.length)}>+ 새 분야</div>
      </div>}
    </>}
  </div>;
}
