/**
 * CSRF 토큰 응답
 */
type Csrf = {
  /**
   * CSRF 토큰 요청 헤더명
   */
  headerName: string;

  /**
   * 세션별 CSRF 토큰
   */
  token: string
};

/**
 * 관리자 API 기준 URL
 */
const apiBase = document.body.dataset.apiBase ?? '';

/**
 * 현재 세션의 CSRF 토큰
 */
let csrf: Csrf | null = null;

/**
 * 현재 세션의 CSRF 토큰 캐시 제거
 */
export function clearCsrf() { csrf = null; }

/**
 * HTTP 상태를 보존하는 관리자 요청 오류
 */
export class HttpError extends Error {
  /**
   * HTTP 상태와 오류 메시지 설정
   */
  constructor(
    /**
     * HTTP 상태
     */
    readonly status: number, message: string) { super(message); }
}

/**
 * CSRF·세션 쿠키를 포함한 API 요청과 오류 변환
 *
 * 1. API 주소 확인, 변경 요청에는 CSRF 토큰 준비
 * 2. 쿠키 포함·캐시 금지·리다이렉트 거부로 요청
 * 3. 오류 본문·상태를 읽어 인증 실패와 일반 실패 구분
 * 4. 빈 성공 응답 또는 JSON 반환
 */
export async function request<T>(path: string, method = 'GET', body?: object): Promise<T> {
  // API 주소 확인, 변경 요청에는 CSRF 토큰 준비
  if (!apiBase) throw new Error('관리자 연결 주소가 설정되지 않았습니다.');
  const headers = new Headers({ Accept: 'application/json' });
  if (method !== 'GET') {
    if (!csrf) await refreshCsrf();
    if (csrf) headers.set(csrf.headerName, csrf.token);
  }
  if (body) headers.set('Content-Type', 'application/json');
  let response: Response;
  try {
    // 쿠키 포함·캐시 금지·리다이렉트 거부로 요청
    response = await fetch(new URL('/api/v1' + path, apiBase), {
      method, headers, credentials: 'include', cache: 'no-store', redirect: 'error',
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('관리자 연결에 실패했습니다. 인터넷 연결과 브라우저의 사이트 간 쿠키 허용 설정을 확인하세요.');
  }
  // 오류 본문·상태를 읽어 인증 실패와 일반 실패 구분
  if (!response.ok) {
    let detail = '';
    try {
      const problem = await response.json() as {
        /**
         * 오류 상세 설명
         */
        detail?: unknown;

        /**
         * 제목
         */
        title?: unknown
      };
      detail = typeof problem.detail === 'string' ? problem.detail : typeof problem.title === 'string' ? problem.title : '';
    } catch { /* 응답 본문이 없는 오류 */ }
    if (response.status === 401) throw new HttpError(401, '로그인이 만료되었습니다. 다시 로그인하세요.');
    if (response.status === 403) throw new HttpError(403, '요청이 거부되었습니다. 페이지를 새로고침한 뒤 다시 시도하세요.');
    throw new HttpError(response.status, detail || `요청에 실패했습니다. HTTP ${response.status}`);
  }
  // 빈 성공 응답 또는 JSON 반환
  if (response.status === 204) return undefined as T;
  return await response.json() as T;
}

/**
 * 현재 세션의 CSRF 토큰 갱신
 */
export async function refreshCsrf(): Promise<void> {
  csrf = await request<Csrf>('/auth/csrf');
  if (!csrf || !csrf.headerName || !csrf.token) throw new Error('로그인 보호 토큰을 받지 못했습니다.');
}

/**
 * 관리자 변경 요청, CSRF 거부 시 토큰 캐시 제거 후 오류 전달
 */
export async function mutate<T>(path: string, method: string, body?: object): Promise<T> {
  try { return await request<T>(path, method, body); }
  catch (error) {
    if (error instanceof HttpError && error.status === 403) csrf = null;
    throw error;
  }
}
