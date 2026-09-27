"use client";

import { useState } from "react";
import { AttachmentImage } from "@/components/attachment-image";
import type { ImageData } from "@/lib/editor-image";
import "./image-block.css";

type Props = { image: ImageData; disabled: boolean; onChange: (image: ImageData) => void; onDelete: () => void;
  rootRef: (node: HTMLDivElement | null) => void; moveAbove: () => void; moveBelow: () => void };

/** 선택 시에만 원본 이미지 정렬·너비 도구를 띄우고 OCI 첨부 미리보기를 유지한다. */
export function ImageBlock({ image, disabled, onChange, onDelete, rootRef, moveAbove, moveBelow }: Props) {
  const [selected, setSelected] = useState(false);
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
    <div className={`editor-image-figure${selected ? " selected" : ""}`} style={{ width: `${image.width}%`,
      marginLeft: image.align === "right" ? "auto" : image.align === "center" ? "auto" : 0,
      marginRight: image.align === "left" ? "auto" : image.align === "center" ? "auto" : 0 }}
      onClick={() => setSelected(true)}>
      {selected && <div className="editor-image-toolbar" role="toolbar" aria-label="이미지 설정">
        {(["left", "center", "right"] as const).map((align) => <button type="button" key={align}
          disabled={disabled} className={image.align === align ? "active" : ""}
          aria-label={`${align === "left" ? "왼쪽" : align === "center" ? "가운데" : "오른쪽"} 정렬`}
          onClick={() => onChange({ ...image, align })}>{align === "left" ? "☷" : align === "center" ? "≡" : "☰"}</button>)}
        <span className="sep" />
        {[25, 50, 75, 100].map((width) => <button type="button" key={width} disabled={disabled}
          className={image.width === width ? "active" : ""} onClick={() => onChange({ ...image, width })}>{width}%</button>)}
        <input type="range" min={20} max={100} step={5} value={image.width} disabled={disabled} aria-label="이미지 너비"
          onChange={(event) => onChange({ ...image, width: Number(event.target.value) })} />
        <span className="sep" /><button type="button" className="delete" disabled={disabled} onClick={onDelete}>삭제</button>
      </div>}
      <AttachmentImage image={{ ...image, caption: "", width: 100, align: "center" }} source={{ kind: "admin" }} />
      {selected && <input type="text" aria-label="이미지 캡션" placeholder="캡션 (선택)" value={image.caption} maxLength={500}
        disabled={disabled} onChange={(event) => onChange({ ...image, caption: event.target.value })} />}
      {!selected && image.caption && <span className="editor-image-caption">{image.caption}</span>}
    </div>
  </div>;
}
