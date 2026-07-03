"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { apiFailureMessage, parseWikiTitleSearch, type WikiTitleSearch } from "@/lib/api";
import { validWikiTitle } from "@/lib/wiki-link-syntax";
import { useAuth } from "@/components/auth-provider";

type Choice = { title: string; note: string; missing: boolean };
type SearchState = { query: string; value: WikiTitleSearch | null; error: string; loading: boolean };

/** ADMIN 제목 검색과 없는 제목 삽입을 동일한 키보드 목록으로 제공한다. */
export function WikiLinkPicker({ onInsert, onClose }: { onInsert: (title: string) => void; onClose: () => void }) {
  const auth = useAuth();
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [query, setQuery] = useState("");
  const [composing, setComposing] = useState(false);
  const [active, setActive] = useState(0);
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<SearchState>({ query: "", value: null, error: "", loading: false });
  const title = validWikiTitle(query);
  const result = title && state.query === title ? state.value : null;
  const choices = useMemo(() => {
    if (!result) return [];
    const output: Choice[] = result.items.map((item) => ({ title: item.title, note: "출간된 글", missing: false }));
    const exact = result.exact;
    if (exact.status === "READABLE" && !output.some((item) => item.title === exact.title))
      output.unshift({ title: exact.title, note: "정확히 일치하는 글", missing: false });
    if (result.exact.status === "MISSING" && title)
      output.push({ title, note: "없는 제목으로 링크 만들기", missing: true });
    return output;
  }, [result, title]);

  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => {
    if (!title || composing) { setState({ query: "", value: null, error: "", loading: false }); return; }
    const controller = new AbortController();
    let live = true;
    setState({ query: title, value: null, error: "", loading: true });
    const timer = setTimeout(() => {
      void auth.adminRead(`/api/v1/admin/posts/title-search?q=${encodeURIComponent(title)}`, controller.signal)
        .then((value) => { if (live) { setState({ query: title, value: parseWikiTitleSearch(value, title), error: "", loading: false });
          setActive(0); } })
        .catch((error) => { if (live && !controller.signal.aborted)
          setState({ query: title, value: null, error: apiFailureMessage(error), loading: false }); });
    }, 180);
    return () => { live = false; clearTimeout(timer); controller.abort(); };
  }, [title, composing, retry, auth.adminRead]);

  /** 조합 종료 전 Enter는 후보를 확정하지 않고 입력기에 맡긴다. */
  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
    if (composing || event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "ArrowDown" && choices.length) { event.preventDefault(); setActive((value) => (value + 1) % choices.length); }
    if (event.key === "ArrowUp" && choices.length) { event.preventDefault(); setActive((value) => (value - 1 + choices.length) % choices.length); }
    if (event.key === "Enter" && choices[active]) { event.preventDefault(); onInsert(choices[active].title); }
  }

  return <div className="wiki-picker" role="dialog" aria-label="글 링크 선택기">
    <div className="wiki-picker-heading"><strong>글 링크</strong><button type="button" className="small-button" onClick={onClose}
      aria-label="글 링크 선택기 닫기">닫기</button></div>
    <label htmlFor="wiki-title-search">연결할 글 제목</label>
    <input id="wiki-title-search" ref={input} role="combobox" aria-autocomplete="list" aria-expanded={choices.length > 0}
      aria-controls={listId} aria-activedescendant={choices[active] ? `${listId}-${active}` : undefined}
      value={query} onChange={(event) => setQuery(event.target.value)} onCompositionStart={() => setComposing(true)}
      onCompositionEnd={() => setComposing(false)} onKeyDown={onKeyDown} autoComplete="off" />
    {!title && query && <p role="status">제목은 대괄호·세로줄·제어 문자 없이 1~200자로 입력해 주세요.</p>}
    {title && state.query === title && state.loading && <p role="status">제목을 찾고 있습니다…</p>}
    {title && state.query === title && state.error && <p role="alert">{state.error} <button type="button" className="small-button"
      onClick={() => setRetry((value) => value + 1)}>다시 시도</button></p>}
    {result && choices.length === 0 && <p role="status">표시할 글이 없습니다.</p>}
    <div id={listId} role="listbox" aria-label="검색 결과" className="wiki-picker-results">
      {choices.map((choice, index) => <div key={`${choice.title}:${choice.missing}`} id={`${listId}-${index}`} role="option"
        aria-selected={active === index} className={active === index ? "wiki-picker-option active" : "wiki-picker-option"}
        onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setActive(index)}
        onClick={() => onInsert(choice.title)}>{choice.title}<span>{choice.note}</span></div>)}
    </div>
    <p className="wiki-picker-help">↑↓ 선택 · Enter 삽입 · Esc 닫기. 선택한 본문 글자를 링크로 바꿉니다.</p>
  </div>;
}
