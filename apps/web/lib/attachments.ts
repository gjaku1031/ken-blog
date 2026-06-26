import { ApiFailure, apiUrl } from "./api";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_UPLOAD_RESPONSE_BYTES = 4096;

/** 서버가 준비한 이미지 첨부의 공개 가능한 메타데이터만 담는다. */
export type UploadedAttachment = { id: number; contentType: "image/jpeg" | "image/png"; byteSize: number };

/** 실패·과대 응답에 메모리를 쓰지 않도록 스트림을 상한까지 읽는다. */
async function readBounded(response: Response, limit: number, signal: AbortSignal): Promise<Uint8Array> {
  const length = Number(response.headers.get("Content-Length"));
  if (Number.isFinite(length) && length > limit) throw new ApiFailure("response");
  if (!response.body) throw new ApiFailure("response");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (signal.aborted) throw new DOMException("요청이 취소되었습니다", "AbortError");
      size += value.byteLength;
      if (size > limit) throw new ApiFailure("response");
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => undefined); }
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
  return output;
}

/** 외부 취소와 시간 제한을 결합하고 타이머를 요청 후 정리한다. */
async function boundedRequest<T>(signal: AbortSignal | undefined, timeout: number,
  run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) controller.abort();
  const timer = setTimeout(abort, timeout);
  try { return await run(controller.signal); }
  catch (error) {
    if (signal?.aborted) throw new DOMException("요청이 취소되었습니다", "AbortError");
    if (controller.signal.aborted) throw new ApiFailure("timeout");
    if (error instanceof ApiFailure) throw error;
    throw new ApiFailure("network");
  } finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
}

/** JPEG/PNG 한 파일만 관리자 multipart 업로드로 전달하고 READY 응답을 검증한다. */
export async function uploadAttachment(file: File, csrf: { headerName: string; token: string }, signal?: AbortSignal): Promise<UploadedAttachment> {
  if (!["image/jpeg", "image/png"].includes(file.type) || file.size === 0 || file.size > MAX_IMAGE_BYTES)
    throw new ApiFailure("response");
  if (csrf.headerName !== "X-CSRF-TOKEN" || !csrf.token) throw new ApiFailure("response");
  const url = apiUrl("/api/v1/admin/attachments");
  const body = new FormData();
  body.set("file", file, file.name);
  return boundedRequest(signal, 30_000, async (requestSignal) => {
    const response = await fetch(url, { method: "POST", body, headers: { Accept: "application/json", [csrf.headerName]: csrf.token },
      credentials: "include", mode: "cors", redirect: "error", cache: "no-store", signal: requestSignal });
    if (!response.ok) throw new ApiFailure("http", response.status);
    if (response.status !== 201 || !response.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) throw new ApiFailure("response");
    const bytes = await readBounded(response, MAX_UPLOAD_RESPONSE_BYTES, requestSignal);
    let value: unknown;
    try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
    catch { throw new ApiFailure("response"); }
    if (!value || typeof value !== "object") throw new ApiFailure("response");
    const data = value as Record<string, unknown>;
    if (typeof data.id !== "number" || !Number.isSafeInteger(data.id) || data.id <= 0 || data.status !== "READY" ||
      (data.contentType !== "image/jpeg" && data.contentType !== "image/png") ||
      typeof data.byteSize !== "number" || !Number.isSafeInteger(data.byteSize) || data.byteSize < 1 || data.byteSize > MAX_IMAGE_BYTES)
      throw new ApiFailure("response");
    return { id: data.id, contentType: data.contentType, byteSize: data.byteSize };
  });
}

/** 서버 권한이 허용한 ID의 이미지 바이트만 읽고 MIME·크기·매직 바이트를 검사한다. */
export async function fetchAttachmentContent(path: string, credentials: RequestCredentials, signal?: AbortSignal): Promise<Blob> {
  const url = apiUrl(path);
  return boundedRequest(signal, 20_000, async (requestSignal) => {
    const response = await fetch(url, { method: "GET", credentials, mode: "cors", redirect: "error", cache: "no-store",
      headers: { Accept: "image/jpeg, image/png" }, signal: requestSignal });
    if (!response.ok) throw new ApiFailure("http", response.status);
    const type = response.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase();
    if (type !== "image/jpeg" && type !== "image/png") throw new ApiFailure("response");
    const bytes = await readBounded(response, MAX_IMAGE_BYTES, requestSignal);
    const jpeg = type === "image/jpeg" && bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    const png = type === "image/png" && bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((part, index) => bytes[index] === part);
    if (!jpeg && !png) throw new ApiFailure("response");
    return new Blob([bytes.buffer as ArrayBuffer], { type });
  });
}
