"use client";

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";

type LanguageOption = { value: string; label: string; search: string };
type ListPlacement = { side: "above" | "below"; maxHeight: number };

const GENERAL: LanguageOption = { value: "", label: "일반 텍스트", search: "plain text 일반 텍스트" };
const LANGUAGES: readonly LanguageOption[] = [
  { value: "kotlin", label: "Kotlin", search: "코틀린" },
  { value: "java", label: "Java", search: "자바" },
  { value: "javascript", label: "JavaScript", search: "자바스크립트 js" },
  { value: "typescript", label: "TypeScript", search: "타입스크립트 ts" },
  { value: "json", label: "JSON", search: "제이슨" },
  { value: "sql", label: "SQL", search: "에스큐엘" },
  { value: "bash", label: "Bash", search: "배시 shell 쉘" },
  { value: "yaml", label: "YAML", search: "야믈" },
  { value: "python", label: "Python", search: "파이썬" },
  { value: "css", label: "CSS", search: "씨에스에스" },
  { value: "html", label: "HTML", search: "에이치티엠엘" },
  { value: "markdown", label: "Markdown", search: "마크다운 md" },
];
const CUSTOM_LANGUAGE = /^[A-Za-z0-9_-]{1,32}$/;

export type CodeLanguagePickerProps = { id: string; value: string; onChange: (language: string) => void;
  disabled?: boolean; "aria-invalid"?: boolean; "aria-describedby"?: string;
  onEditorKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void };

/** {@link CodeLanguagePickerProps}의 기존 언어값을 유지하며 12개 추천·일반 텍스트·직접 입력을 제공한다. */
export function CodeLanguagePicker({ id, value, onChange, disabled = false, "aria-invalid": invalid,
  "aria-describedby": describedBy, onEditorKeyDown }: CodeLanguagePickerProps) {
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const [filtering, setFiltering] = useState(false);
  const [active, setActive] = useState(0);
  const [placement, setPlacement] = useState<ListPlacement>({ side: "below", maxHeight: 250 });
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
  const compositionEndAt = useRef(0);
  const listId = `${id}-options`;
  const search = query.trim().toLocaleLowerCase();
  const custom = CUSTOM_LANGUAGE.test(query) && query.toLowerCase() !== "mermaid" &&
    !LANGUAGES.some((item) => item.value.toLowerCase() === query.toLowerCase()) ?
    { value: query, label: query, search: "직접 입력" } : null;
  const options = filtering && search ? [
    ...LANGUAGES.filter((item) => `${item.value} ${item.label} ${item.search}`.toLocaleLowerCase().includes(search)),
    ...(custom ? [custom] : []),
    ...(GENERAL.search.includes(search) ? [GENERAL] : []),
  ] : [GENERAL, ...(custom ? [custom] : []), ...LANGUAGES];

  /** {@link CodeLanguagePicker} 입력 위치와 고정 도구막대 위쪽 여유를 재서 목록 방향·높이를 정한다. */
  function measurePlacement(): ListPlacement {
    const rect = root.current?.getBoundingClientRect();
    if (!rect) return { side: "below", maxHeight: 250 };
    const viewportTop = window.visualViewport?.offsetTop ?? 0;
    const viewportBottom = viewportTop + (window.visualViewport?.height ?? window.innerHeight);
    const toolbarTop = document.querySelector<HTMLElement>(".write-toolbar")?.getBoundingClientRect().top ?? viewportBottom;
    const above = Math.max(0, rect.top - viewportTop - 8);
    const below = Math.max(0, Math.min(viewportBottom, toolbarTop) - rect.bottom - 8);
    const desired = Math.min(250, options.length * 35 + 12);
    const side = below < desired && above > below ? "above" : "below";
    return { side, maxHeight: Math.floor(Math.min(250, side === "above" ? above : below)) };
  }

  useEffect(() => { setQuery(value); }, [value]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  useLayoutEffect(() => {
    if (!open) return;
    const next = measurePlacement();
    setPlacement((current) => current.side === next.side && current.maxHeight === next.maxHeight ? current : next);
  }, [open, options.length, query]);
  useEffect(() => {
    if (!open) return;
    const reposition = () => {
      const next = measurePlacement();
      setPlacement((current) => current.side === next.side && current.maxHeight === next.maxHeight ? current : next);
    };
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    window.visualViewport?.addEventListener("resize", reposition);
    window.visualViewport?.addEventListener("scroll", reposition);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
      window.visualViewport?.removeEventListener("resize", reposition);
      window.visualViewport?.removeEventListener("scroll", reposition);
    };
  }, [open, options.length, query]);
  useEffect(() => {
    if (open && options.length) (list.current?.children.item(active) as HTMLElement | null)?.scrollIntoView({ block: "nearest" });
  }, [open, active, options.length, query, filtering]);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) {
        setOpen(false); setFiltering(false); setQuery(value);
      }
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open, value]);

  /** {@link CodeLanguagePicker}의 전체 후보를 열고 현재 값부터 키보드 이동을 시작한다. */
  function openAll() {
    if (disabled) return;
    setFiltering(false);
    setOpen(true);
    const selected = [GENERAL, ...(custom ? [custom] : []), ...LANGUAGES]
      .findIndex((item) => item.value.toLowerCase() === value.toLowerCase());
    setActive(Math.max(0, selected));
  }

  /** 선택한 언어를 {@link CodeLanguagePickerProps.onChange}로 확정하고 입력 초점을 유지한다. */
  function choose(language: string) {
    setQuery(language); onChange(language);
    setOpen(false); setFiltering(false); setActive(0);
    input.current?.focus();
  }

  /** 열린 목록 명령을 처리하고 나머지는 {@link CodeLanguagePickerProps.onEditorKeyDown}에 위임한다. */
  function keyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) {
      if (event.key === "Enter") event.stopPropagation();
      return;
    }
    if (event.key === "Enter" && compositionEndAt.current > 0 && performance.now() - compositionEndAt.current < 250) {
      event.preventDefault(); event.stopPropagation(); compositionEndAt.current = 0; return;
    }
    if (event.ctrlKey || event.metaKey) { onEditorKeyDown?.(event); return; }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault(); event.stopPropagation();
      if (!open) openAll();
      else setActive((current) => (current + (event.key === "ArrowDown" ? 1 : -1) + options.length) % Math.max(1, options.length));
      return;
    }
    if (event.key === "Home" && open && options.length) { event.preventDefault(); setActive(0); return; }
    if (event.key === "End" && open && options.length) { event.preventDefault(); setActive(options.length - 1); return; }
    if (event.key === "Escape" && open) {
      event.preventDefault(); event.stopPropagation(); setOpen(false); setFiltering(false); setQuery(value); return;
    }
    if (event.key === "Enter" && open) {
      event.preventDefault(); event.stopPropagation();
      if (options[active]) choose(options[active].value);
      return;
    }
    if (event.key === "Tab") { setOpen(false); setFiltering(false); setQuery(value); }
    onEditorKeyDown?.(event);
  }

  return <div ref={root} className={`code-language-picker${invalid ? " invalid" : ""}`} onBlur={(event) => {
    if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) {
      setOpen(false); setFiltering(false); setQuery(value);
    }
  }}>
    <div className="code-language-control"><input ref={input} id={id} type="text" role="combobox" autoComplete="off"
      autoCapitalize="off" spellCheck={false} value={query} disabled={disabled}
      aria-autocomplete="list" aria-expanded={open && !disabled} aria-controls={open && !disabled ? listId : undefined}
      aria-activedescendant={open && !disabled && options[active] ? `${listId}-${active}` : undefined}
      aria-invalid={invalid} aria-describedby={describedBy} onCompositionStart={() => { composing.current = true; }}
      onCompositionEnd={() => { composing.current = false; compositionEndAt.current = performance.now(); }} onKeyDown={keyDown}
      onClick={() => { if (!open) openAll(); }} onChange={(event) => {
        const next = event.target.value;
        setQuery(next); setFiltering(true); setOpen(true); setActive(0); onChange(next);
      }} />
      <button type="button" className="code-language-toggle" disabled={disabled}
        aria-label={open ? "코드 언어 목록 닫기" : "코드 언어 목록 열기"} aria-expanded={open && !disabled}
        aria-controls={open && !disabled ? listId : undefined} onMouseDown={(event) => event.preventDefault()}
        onClick={() => { if (open) { setOpen(false); setFiltering(false); setQuery(value); }
          else openAll(); input.current?.focus(); }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="m6 9 6 6 6-6" /></svg></button></div>
    {open && !disabled && <div ref={list} id={listId}
      className={`code-language-options${placement.side === "above" ? " above" : ""}`}
      style={{ maxHeight: placement.maxHeight }} role="listbox" aria-label="코드 언어 선택">
      {options.length ? options.map((item, index) => <div key={item.value || "plain"} id={`${listId}-${index}`}
        className={`code-language-option${active === index ? " active" : ""}`} role="option"
        aria-selected={value === item.value} onMouseDown={(event) => event.preventDefault()}
        onClick={() => choose(item.value)} onMouseEnter={() => setActive(index)}>
        <span>{item.label}</span><small>{item.value || "강조 없음"}</small></div>) :
        <p className="code-language-empty" role="status">일치하는 추천 언어가 없습니다. 영문·숫자·-·_로 직접 입력할 수 있습니다.</p>}
    </div>}
  </div>;
}
