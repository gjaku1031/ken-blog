"use client";

import { useEffect, useRef, type FormEvent } from "react";

type Props = { title: string; slug: string; visibility: "PUBLIC" | "PRIVATE"; busy: boolean; error: string;
  onSlug: (value: string) => void; onVisibility: (value: "PUBLIC" | "PRIVATE") => void;
  onClose: () => void; onPublish: () => void };

/** 저장된 revision으로 출간하기 전 주소·열람 범위를 다시 확인하는 모달. */
export function PublishSheet({ title, slug, visibility, busy, error, onSlug, onVisibility, onClose, onPublish }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => { if (element?.open) element.close(); };
  }, []);

  /** 브라우저 제출을 막고 상위의 저장→출간 직렬 흐름만 실행한다. */
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (!busy) onPublish(); }

  return <dialog ref={dialog} className="publish-dialog" onCancel={(event) => { if (busy) event.preventDefault(); else onClose(); }}
    onClose={onClose} aria-labelledby="publish-title">
    <form onSubmit={submit}>
      <div className="publish-heading"><h2 id="publish-title">출간 확인</h2>
        <button type="button" onClick={onClose} disabled={busy} aria-label="출간 창 닫기">×</button></div>
      <p className="publish-intro">{title || "제목 없음"}</p>
      <label htmlFor="publish-slug">글 주소</label>
      <input id="publish-slug" value={slug} maxLength={160} disabled={busy} onChange={(event) => onSlug(event.target.value)}
        placeholder="example-post" autoComplete="off" />
      <p className="field-help">소문자 영숫자로 시작·끝을 맞추고 단일 하이픈으로 연결해 주세요.</p>
      <label htmlFor="publish-visibility">열람 범위</label>
      <select id="publish-visibility" value={visibility} disabled={busy}
        onChange={(event) => onVisibility(event.target.value as "PUBLIC" | "PRIVATE")}>
        <option value="PUBLIC">전체 공개</option><option value="PRIVATE">로그인 회원 공개</option>
      </select>
      <p className="field-help">출간은 저장된 편집본을 원문에 반영합니다. 기존 글의 최초 출간일은 유지됩니다.</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="publish-actions"><button type="button" className="small-button" onClick={onClose} disabled={busy}>취소</button>
        <button type="submit" className="primary-button" disabled={busy}>{busy ? "출간 중…" : "출간하기"}</button></div>
    </form>
  </dialog>;
}
