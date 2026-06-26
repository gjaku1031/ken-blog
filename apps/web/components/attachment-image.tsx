"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { ApiFailure, apiFailureMessage } from "@/lib/api";
import { fetchAttachmentContent } from "@/lib/attachments";
import type { ImageData } from "@/lib/editor-image";
import { useAuth } from "./auth-provider";

export type AttachmentSource = { kind: "admin" } | { kind: "post"; postId: number };
type ImageState = { key: string; status: "loading" | "ready" | "error"; url: string; width: number; height: number; message: string };

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

/** 권한별 content API로 받은 임시 blob URL을 수명 동안만 표시하고 해제한다. */
export function AttachmentImage({ image, source }: { image: ImageData; source: AttachmentSource }) {
  const auth = useAuth();
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<ImageState>({ key: "", status: "loading", url: "", width: 1, height: 1, message: "" });
  const sourceId = source.kind === "post" ? source.postId : 0;
  const requestKey = `${auth.epoch}:${source.kind}:${sourceId}:${image.attachmentId}:${retry}`;

  useEffect(() => {
    const controller = new AbortController();
    let objectUrl = "";
    setState({ key: requestKey, status: "loading", url: "", width: 1, height: 1, message: "" });
    void (async () => {
      try {
        if (!Number.isSafeInteger(image.attachmentId) || image.attachmentId <= 0 ||
          (source.kind === "post" && (!Number.isSafeInteger(sourceId) || sourceId <= 0))) throw new Error("잘못된 이미지 ID");
        if (source.kind === "admin" && (auth.status !== "authenticated" || auth.user?.role !== "ADMIN"))
          throw new Error("관리자 로그인이 필요합니다.");
        const credentials = await auth.readCredentials(controller.signal);
        if (source.kind === "admin" && credentials !== "include") throw new Error("관리자 로그인이 필요합니다.");
        const path = source.kind === "admin" ? `/api/v1/admin/attachments/${image.attachmentId}/content` :
          `/api/v1/posts/${sourceId}/attachments/${image.attachmentId}/content`;
        const blob = await fetchAttachmentContent(path, credentials, controller.signal);
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        const dimensions = await new Promise<{ width: number; height: number }>((resolve, reject) => {
          const probe = new window.Image();
          const settle = (error?: Error) => { clearTimeout(timer); controller.signal.removeEventListener("abort", abort);
            probe.onload = null; probe.onerror = null;
            if (error) reject(error); else resolve({ width: probe.naturalWidth, height: probe.naturalHeight }); };
          const abort = () => settle(new Error("이미지 요청 취소"));
          const timer = setTimeout(() => settle(new Error("이미지 해석 시간 초과")), 8_000);
          controller.signal.addEventListener("abort", abort, { once: true });
          probe.onload = () => settle();
          probe.onerror = () => settle(new Error("이미지 해석 실패"));
          probe.src = objectUrl;
        });
        if (controller.signal.aborted) return;
        if (!dimensions.width || !dimensions.height) throw new Error("이미지 크기 오류");
        setState({ key: requestKey, status: "ready", url: objectUrl, ...dimensions, message: "" });
      } catch (error) {
        if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = ""; }
        if (error instanceof ApiFailure && error.status === 401) auth.expire();
        if (!controller.signal.aborted) setState({ key: requestKey, status: "error", url: "", width: 1, height: 1,
          message: error instanceof Error && !("kind" in error) ? "이미지를 표시할 수 없습니다." : imageFailureMessage(error) });
      }
    })();
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [auth.epoch, auth.expire, auth.readCredentials, auth.status, auth.user?.role, image.attachmentId, source.kind, sourceId, requestKey]);

  const alt = image.caption || `첨부 이미지 ${image.attachmentId}`;
  const visible: ImageState = state.key === requestKey ? state : { key: requestKey, status: "loading", url: "", width: 1, height: 1, message: "" };
  return <span className={`attachment-image attachment-align-${image.align}`} style={{ width: `${image.width}%` }}>
    {visible.status === "ready" && <Image src={visible.url} alt={alt} width={visible.width} height={visible.height}
      sizes="(max-width: 760px) 100vw, 760px" unoptimized />}
    {visible.status === "loading" && <span className="blocked-image" role="status">이미지를 불러오고 있습니다: {alt}</span>}
    {visible.status === "error" && <span className="blocked-image" role="status">{visible.message} ({alt}) <button type="button"
      onClick={() => setRetry((current) => current + 1)}>이미지 다시 시도</button></span>}
    {image.caption && <span className="attachment-caption">{image.caption}</span>}
  </span>;
}
