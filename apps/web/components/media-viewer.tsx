"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import "./media-viewer.css";

type MediaViewerProps = {
  title: string;
  onClose: () => void;
  src?: string;
  alt?: string;
  width?: number;
  height?: number;
  maxFitScale?: number;
  children?: ReactNode;
};

const MIN_ZOOM = 0.005;
const MAX_ZOOM = 8;

/** 읽기 화면의 이미지와 도식에 공통 확대 동작을 제공한다. */
export function MediaOpenButton({ label, onClick }: { label: string; onClick: () => void }) {
  return <button type="button" className="media-open-button" aria-label={label} title={label} onClick={onClick}>
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <circle cx="10.8" cy="10.8" r="6.6" /><path d="m16 16 5 5M10.8 8v5.6M8 10.8h5.6" />
    </svg><span>확대</span>
  </button>;
}

/** 확대율을 화면 크기와 매체별 최대 배율에 맞춰 계산한다. */
function fitScale(width: number, height: number, viewport: HTMLElement, maxFitScale: number): number {
  return Math.min(maxFitScale, (viewport.clientWidth - 32) / width, (viewport.clientHeight - 32) / height);
}

/** 권한 확인이 끝난 이미지 또는 안전한 도식을 모달에서 확대하고 스크롤로 탐색한다. */
export function MediaViewer({ title, onClose, src, alt, width, height, maxFitScale = 2, children }: MediaViewerProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const [size, setSize] = useState({ width: width ?? 0, height: height ?? 0 });
  const [scale, setScale] = useState(1);
  const [fitted, setFitted] = useState(true);

  /** 현재 뷰포트 크기에 맞는 확대율을 적용한다. */
  const fit = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport || size.width <= 0 || size.height <= 0) return;
    setScale(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, fitScale(size.width, size.height, viewport, maxFitScale))));
    setFitted(true);
    viewport.scrollTo(0, 0);
  }, [size.width, size.height, maxFitScale]);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = "hidden";
    dialog.querySelector<HTMLButtonElement>(".media-viewer-close")?.focus();
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
      if (openerRef.current?.isConnected) openerRef.current.focus({ preventScroll: true });
    };
  }, []);

  useLayoutEffect(() => {
    if (width && height) { setSize({ width, height }); return; }
    const content = contentRef.current;
    if (!content) return;
    const measure = () => setSize({ width: content.offsetWidth, height: content.offsetHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    return () => observer.disconnect();
  }, [width, height, children]);

  useLayoutEffect(() => {
    if (fitted) fit();
  }, [fit, fitted]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const observer = new ResizeObserver(() => { if (fitted) fit(); });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [fit, fitted]);

  /** 버튼과 키보드 명령으로 배율을 조절한다. */
  const zoom = (factor: number) => {
    setFitted(false);
    setScale((current) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Number((current * factor).toFixed(3)))));
  };

  if (typeof document === "undefined") return null;
  return createPortal(<dialog className="media-viewer" ref={dialogRef} aria-label={title} onClose={onClose}
    onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    onKeyDown={(event) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === "+" || event.key === "=") { event.preventDefault(); zoom(1.25); }
      if (event.key === "-") { event.preventDefault(); zoom(0.8); }
      if (event.key === "0") { event.preventDefault(); fit(); }
    }}>
    <div className="media-viewer-panel">
      <div className="media-viewer-toolbar">
        <strong className="media-viewer-title">{title}</strong>
        <div className="media-viewer-actions" role="group" aria-label="확대 조절">
          <button type="button" aria-label="축소" title="축소" disabled={scale <= MIN_ZOOM} onClick={() => zoom(0.8)}>−</button>
          <span className="media-viewer-percent" aria-live="off">{Math.round(scale * 1000) / 10}%</span>
          <button type="button" aria-label="확대" title="확대" disabled={scale >= MAX_ZOOM} onClick={() => zoom(1.25)}>+</button>
          <button type="button" onClick={fit}>화면에 맞춤</button>
        </div>
        <button type="button" className="media-viewer-close" onClick={onClose} aria-label="닫기" title="닫기">×</button>
      </div>
      <div className="media-viewer-viewport" ref={viewportRef} tabIndex={0} role="group"
        aria-label={`${title}, 확대된 콘텐츠. 스크롤로 이동 가능`}>
        <div className="media-viewer-stage" style={{ width: size.width * scale, height: size.height * scale }}>
          <div className="media-viewer-content" ref={contentRef} style={{ transform: `scale(${scale})` }}>
            {src ? <img src={src} alt={alt ?? title} width={width} height={height} style={{ width, height }} /> : children}
          </div>
        </div>
      </div>
    </div>
  </dialog>, document.body);
}
