import { connection } from "next/server";
import { getApiStatus } from "./status.server";
import type { StatusResult } from "./status";

/** 조회 결과에 맞는 공개 안내 문구 반환. 내부 주소와 API 응답 원문 제외. */
function statusMessage(result: StatusResult): string {
  switch (result.kind) {
    case "up":
      return "API 프로세스가 요청에 응답하고 있습니다.";
    case "missing-config":
      return "API 연결 주소가 설정되지 않았습니다.";
    case "invalid-config":
      return "API 연결 설정을 확인해 주세요.";
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

/** 요청 시점에 API 프로세스 상태를 조회하여 홈의 연결 안내 표시. */
export default async function HomePage() {
  await connection();
  const result = await getApiStatus();

  return (
    <main className="home">
      <h1>Ken Blog</h1>
      <p>프로젝트를 준비하고 있습니다.</p>
      <section className="status" aria-labelledby="api-status-title">
        <h2 id="api-status-title">API 연결 상태</h2>
        <p role="status">{statusMessage(result)}</p>
        {result.kind === "up" && (
          <p className="status-note">이 표시는 API 프로세스의 응답만 확인합니다.</p>
        )}
      </section>
    </main>
  );
}
