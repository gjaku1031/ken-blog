"use client";

import { useState } from "react";
import { AttachmentImage } from "@/components/attachment-image";
import type { ImageData } from "@/lib/editor-image";
import "./image-block.css";

type Props = { image: ImageData; disabled: boolean; onChange: (image: ImageData) => void; onDelete: () => void;
  rootRef: (node: HTMLDivElement | null) => void; moveAbove: () => void; moveBelow: () => void };

/** {@link ImageBlock}의 정렬 방향을 컨테이너 안 이미지 위치로 표시한다. */
function AlignmentIcon({ align }: { align: ImageData["align"] }) {
  const x = align === "left" ? 4 : align === "center" ? 7.5 : 11;
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
    <rect x="2" y="4" width="20" height="16" rx="2" stroke="currentColor" strokeWidth="1.5" opacity=".55" />
    <rect x={x} y="7" width="9" height="10" rx="1" fill="currentColor" />
  </svg>;
}

/** {@link AlignmentIcon}과 수치형 위치 보간으로 정렬·너비 변경을 보여주고 OCI 첨부 미리보기를 유지한다. */
export function ImageBlock({ image, disabled, onChange, onDelete, rootRef, moveAbove, moveBelow }: Props) {
  const [selected, setSelected] = useState(false);
  const left = image.align === "left" ? 0 : image.align === "center" ? (100 - image.width) / 2 : 100 - image.width;
  return <div className="editor-image-block" role="group" tabIndex={0} ref={rootRef}
    aria-label="이미지 블록. 클릭하면 정렬과 너비를 편집합니다"
    onFocus={() => setSelected(true)} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setSelected(false); }}
    onKeyDown={(event) => {
      if (event.target !== event.currentTarget) return;
      if (event.key === "ArrowUp") { event.preventDefault(); moveAbove(); }
      if (event.key === "ArrowDown") { event.preventDefault(); moveBelow(); }
      if ((event.key === "Backspace" || event.key === "Delete") && !disabled) { event.preventDefault(); onDelete(); }
      if (event.key === "Escape") setSelected(false);
    }}>
    <div className="editor-image-stage">
      {selected && <div className="editor-image-toolbar" role="toolbar" aria-label="이미지 설정">
        {(["left", "center", "right"] as const).map((align) => {
          const label = align === "left" ? "왼쪽" : align === "center" ? "가운데" : "오른쪽";
          return <button type="button" key={align}
          disabled={disabled} className={image.align === align ? "active" : ""}
          title={`${label} 정렬`} aria-label={`${label} 정렬`} aria-pressed={image.align === align}
          onClick={() => onChange({ ...image, align })}><AlignmentIcon align={align} /></button>;
        })}
        <span className="sep" />
        {[25, 50, 75, 100].map((width) => <button type="button" key={width} disabled={disabled}
          className={image.width === width ? "active" : ""} aria-pressed={image.width === width}
          onClick={() => onChange({ ...image, width })}>{width}%</button>)}
        <input type="range" min={20} max={100} step={5} value={image.width} disabled={disabled} aria-label="이미지 너비"
          onChange={(event) => onChange({ ...image, width: Number(event.target.value) })} />
        <span className="sep" /><button type="button" className="delete" disabled={disabled} onClick={onDelete}>삭제</button>
      </div>}
      <div className={`editor-image-figure${selected ? " selected" : ""}`} style={{ width: `${image.width}%`,
        marginLeft: `${left}%` }} onClick={() => setSelected(true)}>
        <AttachmentImage image={{ ...image, caption: "", width: 100, align: "center" }} source={{ kind: "admin" }} />
        {selected && <input type="text" aria-label="이미지 캡션" placeholder="캡션 (선택)" value={image.caption} maxLength={500}
          disabled={disabled} onChange={(event) => onChange({ ...image, caption: event.target.value })} />}
        {!selected && image.caption && <span className="editor-image-caption">{image.caption}</span>}
      </div>
    </div>
  </div>;
}
