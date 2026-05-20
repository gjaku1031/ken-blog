"use client";

import { useEffect, useState } from "react";
import { checkApiStatus, type StatusResult } from "./status";

const publicApiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;

/** 공개 연결 결과를 사용자가 읽을 수 있는 안내로 변환. */
function statusMessage(result: StatusResult): string {
  switch (result.kind) {
    case "checking":
      return "API 연결 상태를 확인하고 있습니다.";
    case "up":
      return "API 프로세스가 요청에 응답하고 있습니다.";
    case "missing-config":
      return "공개 API 주소가 아직 설정되지 않았습니다.";
    case "invalid-config":
      return "공개 API 주소 설정을 확인해 주세요.";
    case "insecure-config":
      return "HTTPS 페이지에서는 HTTP API에 연결할 수 없습니다.";
    case "http-error":
      return "API가 요청을 정상적으로 처리하지 못했습니다.";
    case "network-error":
      return "API에 연결할 수 없습니다.";
    case "timeout":
      return "API 응답 시간이 초과되었습니다.";
    case "invalid-response":
      return "API 응답 형식을 확인할 수 없습니다.";
  }
}

/** 페이지 로드 후 브라우저에서 공개 API를 조회하여 상태 안내 갱신. */
export default function StatusPanel() {
  const [result, setResult] = useState<StatusResult>({
    kind: publicApiBaseUrl ? "checking" : "missing-config",
  });

  useEffect(() => {
    if (!publicApiBaseUrl) return;
    let mounted = true;
    void checkApiStatus(publicApiBaseUrl, fetch, window.location.protocol).then((next) => {
      if (mounted) setResult(next);
    });
    return () => { mounted = false; };
  }, []);

  return (
    <section className="status" aria-labelledby="api-status-title">
      <h2 id="api-status-title">API 연결 상태</h2>
      <p role="status">{statusMessage(result)}</p>
      {result.kind === "up" && (
        <p className="status-note">이 표시는 API 프로세스의 응답만 확인합니다.</p>
      )}
    </section>
  );
}
