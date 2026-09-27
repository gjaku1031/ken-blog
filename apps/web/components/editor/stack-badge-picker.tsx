"use client";

import Image from "next/image";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ApiFailure, apiFailureMessage } from "@/lib/api";
import { publicImageUrl } from "@/lib/profile";
import { normalizeBadge, parseStackBadges, type StackBadge } from "@/lib/stack-badges";
import { useAuth } from "@/components/auth-provider";

type Choice = { kind: "existing"; badge: StackBadge } | { kind: "register"; name: string };

/** {@link StackBadgePicker}의 선택·검색에서 서버와 같은 대소문자 무시 이름 키를 만든다. */
function nameKey(name: string): string { return name.trim().toLowerCase(); }

/** {@link StackBadgePicker}의 새 뱃지 이름이 서버의 길이·제어 문자 조건을 만족하는지 확인한다. */
function validName(name: string): boolean {
  const clean = name.trim();
  return clean.length > 0 && clean.length <= 100 && !/[\u0000-\u001f\u007f-\u009f]/.test(clean);
}

/** {@link parseStackBadges}의 실제 레지스트리와 선택된 이름을 연결해 대문 뱃지 자동완성·즉석 등록을 제공한다. */
export function StackBadgePicker({ value, onChange, disabled = false }: {
  value: string[]; onChange: (names: string[]) => void; disabled?: boolean;
}) {
  const auth = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<AbortController | null>(null);
  const pendingName = useRef("");
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  valueRef.current = value;
  onChangeRef.current = onChange;
  const listId = useId();
  const [badges, setBadges] = useState<StackBadge[]>([]);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [composing, setComposing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void auth.adminRead("/api/v1/admin/stack-badges", controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) { setBadges(parseStackBadges(result)); setError(""); }
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setError(apiFailureMessage(failure));
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [auth.adminRead, retry]);

  useEffect(() => () => uploadRef.current?.abort(), []);

  const choices = useMemo<Choice[]>(() => {
    const needle = nameKey(query);
    const chosen = new Set(value.map(nameKey));
    const matching = badges.filter((badge) => !chosen.has(nameKey(badge.name)) && nameKey(badge.name).includes(needle))
      .sort((left, right) => {
        const prefix = Number(nameKey(right.name).startsWith(needle)) - Number(nameKey(left.name).startsWith(needle));
        return prefix || (right.projectCount ?? 0) - (left.projectCount ?? 0) || left.name.localeCompare(right.name, "ko");
      });
    const options: Choice[] = matching.map((badge) => ({ kind: "existing", badge }));
    const clean = query.trim();
    if (validName(clean) && !badges.some((badge) => nameKey(badge.name) === nameKey(clean)) && !chosen.has(nameKey(clean)))
      options.push({ kind: "register", name: clean });
    return options;
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

  /** {@link StackBadgePicker}의 미등록 이름을 보관하고 팝업 밖의 파일 입력을 바로 연다. */
  function choose(choice: Choice) {
    if (disabled || uploading) return;
    if (choice.kind === "existing") { select(choice.badge); return; }
    if (valueRef.current.length >= 30) { setError("기술 스택은 30개까지 선택할 수 있습니다."); return; }
    pendingName.current = choice.name;
    setOpen(false);
    fileRef.current?.click();
  }

  /** {@link normalizeBadge}의 64×64 PNG를 실제 관리자 API에 등록한 뒤 프로젝트 선택에도 추가한다. */
  async function register(file: File) {
    const name = pendingName.current;
    pendingName.current = "";
    if (!validName(name) || disabled || uploading) return;
    if (file.type !== "image/png" && file.type !== "image/jpeg") {
      setError("PNG 또는 JPEG 이미지를 선택해 주세요."); return;
    }
    if (file.size === 0 || file.size > 10 * 1024 * 1024) {
      setError("10MiB 이하 이미지를 선택해 주세요."); return;
    }
    const controller = new AbortController();
    uploadRef.current = controller;
    setUploading(true); setError("");
    try {
      const png = await normalizeBadge(file);
      if (controller.signal.aborted) return;
      const fields = new FormData();
      fields.set("name", name); fields.set("file", png);
      const badge = parseStackBadges([await auth.adminForm("POST", "/api/v1/admin/stack-badges", fields, controller.signal)])[0];
      if (controller.signal.aborted) return;
      setBadges((current) => [...current.filter((item) => item.id !== badge.id), badge]);
      select(badge);
    } catch (failure) {
      if (!controller.signal.aborted) {
        setError(failure instanceof ApiFailure && failure.status === 409 ?
          "이미 등록된 이름입니다. 목록을 새로고침한 뒤 기존 뱃지를 선택해 주세요." :
          failure instanceof ApiFailure && failure.status === 415 ?
            "PNG 또는 JPEG 이미지를 선택해 주세요." : apiFailureMessage(failure));
        if (failure instanceof ApiFailure && failure.status === 409) setRetry((current) => current + 1);
      }
    } finally {
      if (uploadRef.current === controller) uploadRef.current = null;
      if (!controller.signal.aborted) setUploading(false);
    }
  }

  /** {@link choose}의 ↑↓·Enter·Esc 탐색과 빈 입력 Backspace의 마지막 선택 제거를 처리한다. */
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
      if (choice) choose(choice);
    }
  }

  const locked = disabled || uploading;
  return <div className="stack-picker" onBlur={(event) => {
    if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
    <div className="stack-picker-chips write-tag-chips">{value.map((name) => {
      const badge = badges.find((item) => nameKey(item.name) === nameKey(name));
      const image = badge ? publicImageUrl(badge.imageUrl) : null;
      return <button key={name} type="button" disabled={locked} aria-label={`${name} 기술 스택 제거`}
        onClick={() => onChange(value.filter((item) => item !== name))}>{image && <Image src={image} width={22} height={22}
          unoptimized alt="" />}{name} <span aria-hidden="true">×</span></button>;
    })}</div>
    <div className="stack-picker-combobox">
      <input id="write-stack" ref={inputRef} role="combobox" aria-autocomplete="list" aria-expanded={open && !locked}
        aria-controls={open ? listId : undefined} aria-activedescendant={open && choices[activeIndex] ? `${listId}-${activeIndex}` : undefined}
        value={query} maxLength={100} autoComplete="off" disabled={locked} placeholder="기술 스택 입력"
        onFocus={() => setOpen(true)} onChange={(event) => { setQuery(event.target.value); setActive(0); setOpen(true); setError(""); }}
        onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)} onKeyDown={onKeyDown} />
      {open && !locked && <div id={listId} className="stack-picker-options" role="listbox" aria-label="기술 스택 후보">
        {choices.map((choice, index) => {
          const image = choice.kind === "existing" ? publicImageUrl(choice.badge.imageUrl) : null;
          return <button key={choice.kind === "existing" ? choice.badge.id : `new:${choice.name}`} type="button" role="option"
            id={`${listId}-${index}`} aria-selected={activeIndex === index} className={activeIndex === index ? "stack-picker-option active" : "stack-picker-option"}
            onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setActive(index)} onClick={() => choose(choice)}>
            {choice.kind === "existing" ? <><span className="stack-picker-option-name">{image && <Image src={image} width={22}
              height={22} unoptimized alt="" />}{choice.badge.name}</span><span className="stack-picker-option-count">
              프로젝트 {choice.badge.projectCount ?? 0}</span></> : <span className="stack-picker-option-name">
              “{choice.name}” 새 뱃지 등록 · 이미지 고르기</span>}
          </button>;
        })}
        {!loading && choices.length === 0 && <p className="stack-picker-empty">선택할 뱃지가 없습니다.</p>}
      </div>}
    </div>
    <input ref={fileRef} hidden tabIndex={-1} type="file" accept="image/png,image/jpeg"
      aria-label="새 기술 스택 뱃지 이미지" disabled={locked} onChange={(event) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (file) void register(file);
      }} />
    {loading && <p className="stack-picker-status" role="status">기술 스택을 불러오고 있습니다…</p>}
    {uploading && <p className="stack-picker-status" role="status">뱃지를 등록하고 있습니다…</p>}
    {error && <p className="inline-error" role="alert">{error} <button type="button" className="small-button"
      disabled={locked} onClick={() => setRetry((current) => current + 1)}>목록 다시 읽기</button></p>}
  </div>;
}
