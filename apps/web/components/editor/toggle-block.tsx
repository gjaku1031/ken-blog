"use client";

import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import "./toggle-block.css";

type Props = {
  id: string; title: string; disabled: boolean; focusTitle: number; children: ReactNode;
  onTitle: (title: string) => void; onTitleEnter: () => void; onUnwrap: () => void; onDelete: () => void;
  rootRef: (node: HTMLDivElement | null) => void; moveAbove: () => void; moveBelow: () => void;
};

/** 접기의 제목과 내부 편집기를 한 포커스·이동 그룹으로 표시한다. */
export function ToggleBlock({ id, title, disabled, focusTitle, children, onTitle, onTitleEnter,
  onUnwrap, onDelete, rootRef, moveAbove, moveBelow }: Props) {
  const root = useRef<HTMLDivElement | null>(null);
  const titleInput = useRef<HTMLInputElement | null>(null);
  const composing = useRef(false);
  useEffect(() => { if (focusTitle > 0) titleInput.current?.focus(); }, [focusTitle]);

  /** 조합 중 Enter를 본문 이동으로 오인하지 않고 Escape는 그룹 선택으로 돌린다. */
  function titleKey(event: KeyboardEvent<HTMLInputElement>) {
    if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "Enter") { event.preventDefault(); onTitleEnter(); }
    if (event.key === "Escape") { event.preventDefault(); root.current?.focus(); }
  }

  return <div className="editor-toggle-block" role="group" tabIndex={0}
    aria-label="접기 블록. 위아래 화살표로 이웃 블록 이동" ref={(node) => { root.current = node; rootRef(node); }}
    onKeyDown={(event) => { if (event.target !== root.current) return;
      if (event.key === "ArrowUp") { event.preventDefault(); moveAbove(); }
      if (event.key === "ArrowDown") { event.preventDefault(); moveBelow(); }
    }}>
    <div className="editor-toggle-title"><label htmlFor={`${id}-title`}>접기 제목</label>
      <input id={`${id}-title`} ref={titleInput} type="text" value={title} disabled={disabled}
        placeholder="접기 제목 · Enter로 안쪽 쓰기" onChange={(event) => onTitle(event.target.value)}
        onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
        onKeyDown={titleKey} /></div>
    <div className="editor-toggle-inner" role="group" aria-label="접기 안쪽 본문">{children}</div>
    <div className="editor-toggle-actions">
      <button type="button" disabled={disabled} onClick={onUnwrap}>접기 해제 · 내용 유지</button>
      <button type="button" disabled={disabled} onClick={() => {
        if (window.confirm("접기 제목과 안쪽 내용을 모두 삭제할까요?")) onDelete();
      }}>접기 전체 삭제</button>
    </div>
  </div>;
}
