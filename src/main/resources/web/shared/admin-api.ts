type Csrf = { headerName: string; token: string };
const apiBase = document.body.dataset.apiBase ?? '';
let csrf: Csrf | null = null;
export function clearCsrf() { csrf = null; }
export class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
export async function request<T>(path: string, method = 'GET', body?: object): Promise<T> {
  if (!apiBase) throw new Error('관리자 연결 주소가 설정되지 않았습니다.');
  const headers = new Headers({ Accept: 'application/json' });
  if (method !== 'GET') {
    if (!csrf) await refreshCsrf();
    if (csrf) headers.set(csrf.headerName, csrf.token);
  }
  if (body) headers.set('Content-Type', 'application/json');
  let response: Response;
  try {
    response = await fetch(new URL('/api/v1' + path, apiBase), {
      method, headers, credentials: 'include', cache: 'no-store', redirect: 'error',
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('관리자 연결에 실패했습니다. 인터넷 연결과 브라우저의 사이트 간 쿠키 허용 설정을 확인하세요.');
  }
  if (!response.ok) {
    let detail = '';
    try {
      const problem = await response.json() as { detail?: unknown; title?: unknown };
      detail = typeof problem.detail === 'string' ? problem.detail : typeof problem.title === 'string' ? problem.title : '';
    } catch { /* 응답 본문이 없는 오류 */ }
    if (response.status === 401) throw new HttpError(401, '로그인이 만료되었습니다. 다시 로그인하세요.');
    if (response.status === 403) throw new HttpError(403, '요청이 거부되었습니다. 페이지를 새로고침한 뒤 다시 시도하세요.');
    throw new HttpError(response.status, detail || `요청에 실패했습니다. HTTP ${response.status}`);
  }
  if (response.status === 204) return undefined as T;
  return await response.json() as T;
}
export async function refreshCsrf(): Promise<void> {
  csrf = await request<Csrf>('/auth/csrf');
  if (!csrf || !csrf.headerName || !csrf.token) throw new Error('로그인 보호 토큰을 받지 못했습니다.');
}
export async function mutate<T>(path: string, method: string, body?: object): Promise<T> {
  try { return await request<T>(path, method, body); }
  catch (error) {
    if (error instanceof HttpError && error.status === 403) csrf = null;
    throw error;
  }
}
