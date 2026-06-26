"use client";

import { AttachmentImage } from "@/components/attachment-image";
import type { ImageData } from "@/lib/editor-image";
import "./image-block.css";

type Props = { image: ImageData; disabled: boolean; onChange: (image: ImageData) => void; onDelete: () => void;
  rootRef: (node: HTMLDivElement | null) => void; moveAbove: () => void; moveBelow: () => void };

/** 관리자 첨부의 미리보기와 캡션·너비·정렬·문서 제거 조작을 묶는다. */
export function ImageBlock({ image, disabled, onChange, onDelete, rootRef, moveAbove, moveBelow }: Props) {
  return <div className="editor-image-block" role="group" tabIndex={0} ref={rootRef}
    aria-label="이미지 블록. 위아래 화살표로 이웃 블록 이동"
    onKeyDown={(event) => {
      if (event.target !== event.currentTarget) return;
      if (event.key === "ArrowUp") { event.preventDefault(); moveAbove(); }
      if (event.key === "ArrowDown") { event.preventDefault(); moveBelow(); }
      if ((event.key === "Backspace" || event.key === "Delete") && !disabled) { event.preventDefault(); onDelete(); }
    }}>
    <AttachmentImage image={image} source={{ kind: "admin" }} />
    <div className="editor-image-fields">
      <label>설명·대체 텍스트<input type="text" value={image.caption} disabled={disabled} maxLength={500}
        onChange={(event) => onChange({ ...image, caption: event.target.value })} /></label>
      <label>너비 {image.width}%<input type="range" min={20} max={100} step={1} value={image.width} disabled={disabled}
        onChange={(event) => onChange({ ...image, width: Number(event.target.value) })} /></label>
      <label>정렬<select value={image.align} disabled={disabled}
        onChange={(event) => onChange({ ...image, align: event.target.value as ImageData["align"] })}>
        <option value="left">왼쪽</option><option value="center">가운데</option><option value="right">오른쪽</option>
      </select></label>
      <button type="button" className="small-button" disabled={disabled} onClick={onDelete}>문서에서 이미지 제거</button>
    </div>
  </div>;
}
