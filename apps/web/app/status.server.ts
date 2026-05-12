import "server-only";
import { checkApiStatus } from "./status";

/**
 * 서버 전용 주소를 읽어 {@link checkApiStatus}의 공개 결과만 홈에 전달.
 * @returns 내부 주소와 원본 응답을 포함하지 않은 연결 결과
 */
export function getApiStatus() {
  return checkApiStatus(process.env.API_BASE_URL);
}
