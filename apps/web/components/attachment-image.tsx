"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { ApiFailure, apiFailureMessage } from "@/lib/api";
import { fetchAttachmentContent } from "@/lib/attachments";
import type { ImageData } from "@/lib/editor-image";
import { useAuth } from "./auth-provider";
import { MediaOpenButton, MediaViewer } from "./media-viewer";

export type AttachmentSource = { kind: "admin" } | { kind: "post"; postId: number };
type ImageVariant = { status: "loading" | "ready" | "error"; url: string; width: number; height: number; message: string };
type ImageState = { key: string; primary: ImageVariant; dark: ImageVariant };
type DocumentTheme = "light" | "dark";

const loadingImage: ImageVariant = { status: "loading", url: "", width: 1, height: 1, message: "" };

/** 첨부 조회 오류를 저장소와 권한 상황에 맞는 짧은 안내로 바꾼다. */
function imageFailureMessage(error: unknown): string {
  if (error instanceof ApiFailure) {
    if (error.status === 404) return "이 글에서 읽을 수 없는 이미지입니다.";
    if (error.status === 401) return "로그인이 만료되었습니다.";
    if (error.status === 403) return "이미지 열람 권한이 없습니다.";
    if (error.status === 503) return "이미지 저장소 또는 API 연결이 일시적으로 불가능합니다.";
  }
  return apiFailureMessage(error);
}

/**
 * 권한별 content API에서 두 테마 첨부를 함께 준비하고 현재 테마의 이미지 하나만 표시한다.
 * 요청 키가 바뀌면 이전 결과를 가리고, 생성한 blob URL은 요청 수명이 끝날 때 해제한다.
 */
export function AttachmentImage({ image, source }: { image: ImageData; source: AttachmentSource }) {
  const auth = useAuth();
  const [retry, setRetry] = useState(0);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [theme, setTheme] = useState<DocumentTheme | null>(null);
  const [state, setState] = useState<ImageState>({ key: "", primary: loadingImage, dark: loadingImage });
  const sourceId = source.kind === "post" ? source.postId : 0;
  const requestKey = `${auth.epoch}:${source.kind}:${sourceId}:${image.attachmentId}:${image.darkAttachmentId ?? 0}:${retry}`;

  /** 초기 다크 화면에 라이트 이미지를 잠시 보이지 않도록 테마 확인 전에는 쌍 이미지를 기다린다. */
  useEffect(() => {
    if (image.darkAttachmentId === undefined) return;
    const update = () => setTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, [image.darkAttachmentId]);

  /** 첨부 요청이 바뀌면 이전 매체의 확대 상태를 지운다. */
  useEffect(() => setOpenKey(null), [requestKey]);

  useEffect(() => {
    const controller = new AbortController();
    const objectUrls = new Set<string>();
    setState({ key: requestKey, primary: loadingImage, dark: loadingImage });

    /** 요청 결과가 현재 매체에 속할 때만 해당 테마의 표시 상태를 갱신한다. */
    const update = (variant: "primary" | "dark", result: ImageVariant) => {
      if (!controller.signal.aborted) setState((current) => current.key === requestKey ? { ...current, [variant]: result } : current);
    };

    /** 한 첨부의 바이트와 크기를 확인한 뒤 다른 테마 요청과 독립적으로 결과를 반영한다. */
    const load = async (id: number, variant: "primary" | "dark", credentials: RequestCredentials) => {
      let objectUrl = "";
      try {
        const path = source.kind === "admin" ? `/api/v1/admin/attachments/${id}/content` :
          `/api/v1/posts/${sourceId}/attachments/${id}/content`;
        const blob = await fetchAttachmentContent(path, credentials, controller.signal);
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        objectUrls.add(objectUrl);
        const dimensions = await new Promise<{ width: number; height: number }>((resolve, reject) => {
          const probe = new window.Image();
          let settled = false;
          const settle = (error?: Error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            controller.signal.removeEventListener("abort", abort);
            probe.onload = null; probe.onerror = null;
            if (error) reject(error); else resolve({ width: probe.naturalWidth, height: probe.naturalHeight });
          };
          const abort = () => settle(new Error("이미지 요청 취소"));
          const timer = setTimeout(() => settle(new Error("이미지 해석 시간 초과")), 8_000);
          controller.signal.addEventListener("abort", abort, { once: true });
          probe.onload = () => settle();
          probe.onerror = () => settle(new Error("이미지 해석 실패"));
          probe.src = objectUrl;
        });
        if (controller.signal.aborted) return;
        if (!dimensions.width || !dimensions.height) throw new Error("이미지 크기 오류");
        update(variant, { status: "ready", url: objectUrl, ...dimensions, message: "" });
      } catch (error) {
        if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrls.delete(objectUrl); }
        if (error instanceof ApiFailure && error.status === 401) auth.expire();
        update(variant, { status: "error", url: "", width: 1, height: 1,
          message: error instanceof Error && !("kind" in error) ? "이미지를 표시할 수 없습니다." : imageFailureMessage(error) });
      }
    };

    void (async () => {
      try {
        if (!Number.isSafeInteger(image.attachmentId) || image.attachmentId <= 0 ||
          (image.darkAttachmentId !== undefined && (!Number.isSafeInteger(image.darkAttachmentId) || image.darkAttachmentId <= 0)) ||
          (source.kind === "post" && (!Number.isSafeInteger(sourceId) || sourceId <= 0))) throw new Error("잘못된 이미지 ID");
        if (source.kind === "admin" && (auth.status !== "authenticated" || auth.user?.role !== "ADMIN"))
          throw new Error("관리자 로그인이 필요합니다.");
        const credentials = await auth.readCredentials(controller.signal);
        if (controller.signal.aborted) return;
        if (source.kind === "admin" && credentials !== "include") throw new Error("관리자 로그인이 필요합니다.");
        void load(image.attachmentId, "primary", credentials);
        if (image.darkAttachmentId !== undefined) void load(image.darkAttachmentId, "dark", credentials);
      } catch (error) {
        if (error instanceof ApiFailure && error.status === 401) auth.expire();
        const failure: ImageVariant = { status: "error", url: "", width: 1, height: 1,
          message: error instanceof Error && !("kind" in error) ? "이미지를 표시할 수 없습니다." : imageFailureMessage(error) };
        update("primary", failure);
        if (image.darkAttachmentId !== undefined) update("dark", failure);
      }
    })();
    return () => { controller.abort(); for (const url of objectUrls) URL.revokeObjectURL(url); objectUrls.clear(); };
  }, [auth.epoch, auth.expire, auth.readCredentials, auth.status, auth.user?.role, image.attachmentId,
    image.darkAttachmentId, source.kind, sourceId, requestKey]);

  const alt = image.caption || `첨부 이미지 ${image.attachmentId}`;
  const current = state.key === requestKey ? state : { key: requestKey, primary: loadingImage, dark: loadingImage };
  const desired = image.darkAttachmentId !== undefined && theme === "dark" ? current.dark : current.primary;
  const fallback = image.darkAttachmentId !== undefined && theme === "dark" ? current.primary : current.dark;
  const visible = image.darkAttachmentId !== undefined && theme === null ? loadingImage :
    desired.status === "error" && image.darkAttachmentId !== undefined && fallback.status !== "error" ? fallback : desired;

  /** 테마 전환 중 선택한 이미지가 아직 준비되지 않았으면 확대 창을 닫아 자동 재열림을 막는다. */
  useEffect(() => {
    if (openKey === requestKey && visible.status !== "ready") setOpenKey(null);
  }, [openKey, requestKey, visible.status]);

  return <span className={`attachment-image attachment-align-${image.align}`} style={{ width: `${image.width}%` }}>
    {visible.status === "ready" && <span className="attachment-image-view">
      <Image src={visible.url} alt={alt} width={visible.width} height={visible.height}
        sizes="(max-width: 760px) 100vw, 760px" unoptimized />
      {source.kind === "post" && <MediaOpenButton label={`${alt} 확대해서 보기`} onClick={() => setOpenKey(requestKey)} />}
    </span>}
    {visible.status === "loading" && <span className="blocked-image" role="status">이미지를 불러오고 있습니다: {alt}</span>}
    {visible.status === "error" && <span className="blocked-image" role="status">{visible.message} ({alt}) <button type="button"
      onClick={() => setRetry((current) => current + 1)}>이미지 다시 시도</button></span>}
    {image.caption && <span className="attachment-caption">{image.caption}</span>}
    {source.kind === "post" && visible.status === "ready" && openKey === requestKey &&
      <MediaViewer title={alt} src={visible.url} alt={alt} width={visible.width} height={visible.height}
        onClose={() => setOpenKey(null)} />}
  </span>;
}
