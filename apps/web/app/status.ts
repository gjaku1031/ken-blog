/** 브라우저에 공개할 수 있는 API 연결 결과. 내부 주소와 응답 본문 제외. */
export type StatusResult = {
  kind:
    | "checking"
    | "up"
    | "missing-config"
    | "invalid-config"
    | "insecure-config"
    | "http-error"
    | "network-error"
    | "timeout"
    | "invalid-response";
};

const REQUEST_TIMEOUT_MS = 3_000;

/**
 * API 기본 주소를 상태 조회 URL로 변환.
 * HTTP(S) 원본 주소만 허용하며 인증 정보, 경로, 쿼리, 프래그먼트는 거부.
 * @param baseUrl 공개 API 기본 주소
 * @param pageProtocol 현재 페이지의 프로토콜
 * @returns 유효한 상태 조회 URL 또는 설정 오류 결과
 */
function statusUrl(baseUrl: string | undefined, pageProtocol: string | undefined): URL | StatusResult {
  if (!baseUrl?.trim()) return { kind: "missing-config" };

  try {
    const url = new URL(baseUrl);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      return { kind: "invalid-config" };
    }
    if (pageProtocol === "https:" && url.protocol === "http:") {
      return { kind: "insecure-config" };
    }
    return new URL("/api/v1/status", url);
  } catch {
    return { kind: "invalid-config" };
  }
}

/**
 * 상태 본문이 Spring의 프로세스 응답 계약인 `{ status: "UP" }`인지 확인.
 * @returns 계약에 맞으면 참; 파싱 가능한 다른 JSON 형태면 거짓
 */
function isUpResponse(body: unknown): boolean {
  return body !== null && typeof body === "object" && !Array.isArray(body) &&
    "status" in body && body.status === "UP";
}

/**
 * Spring 상태 API를 캐시 없이 조회하고 공개 가능한 결과만 반환.
 * 3초 제한은 연결과 본문 읽기 전체에 적용하며 요청이 끝나면 타이머 해제.
 * 네트워크 및 본문 오류는 결과로 변환하며 원본 예외는 전달하지 않음.
 * @param baseUrl 브라우저가 요청할 공개 API 기본 주소
 * @param fetcher 테스트에서 교체할 수 있는 Fetch 구현
 * @param pageProtocol 현재 페이지의 프로토콜. HTTPS 페이지에서 HTTP API 요청을 차단하는 데 사용
 * @returns 원본 응답 정보가 제거된 공개 연결 결과
 */
export async function checkApiStatus(
  baseUrl: string | undefined,
  fetcher: typeof fetch = fetch,
  pageProtocol: string | undefined = globalThis.location?.protocol,
): Promise<StatusResult> {
  const url = statusUrl(baseUrl, pageProtocol);
  if (!(url instanceof URL)) return url;

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<StatusResult>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ kind: "timeout" });
    }, REQUEST_TIMEOUT_MS);
  });

  const request = (async (): Promise<StatusResult> => {
    let response: Response;
    try {
      response = await fetcher(url, {
        cache: "no-store",
        credentials: "omit",
        mode: "cors",
        headers: { Accept: "application/json" },
        redirect: "error",
        signal: controller.signal,
      });
    } catch {
      return { kind: controller.signal.aborted ? "timeout" : "network-error" };
    }

    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      return { kind: "http-error" };
    }

    try {
      const body: unknown = await response.json();
      return { kind: isUpResponse(body) ? "up" : "invalid-response" };
    } catch {
      return { kind: controller.signal.aborted ? "timeout" : "invalid-response" };
    }
  })();

  try {
    return await Promise.race([request, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
