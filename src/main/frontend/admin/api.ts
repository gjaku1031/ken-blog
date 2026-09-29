/** 관리자 UI 전용 세션·CSRF 요청 경계. 오류 본문은 화면이나 로그에 노출하지 않는다. */
export class ApiError extends Error {
  constructor(readonly status: number, readonly kind: 'http' | 'network' | 'response' | 'timeout' = 'http',
    readonly code: string | null = null) {
    super(kind);
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'CONTENT_WRITE_LOCKED') return 'Pages 배포 중이라 서버에 저장할 수 없습니다. 입력한 원문은 이 화면에 남아 있습니다.';
    if (error.status === 401) return '로그인 세션이 만료되었습니다. 다시 로그인해 주세요.';
    if (error.status === 403) return '권한이나 보안 토큰을 확인할 수 없습니다. 새로고침 후 다시 시도해 주세요.';
    if (error.status === 404) return '요청한 항목을 찾지 못했습니다. 목록을 다시 확인해 주세요.';
    if (error.status === 409) return '다른 변경과 충돌했습니다. 입력한 내용은 유지됩니다. 최신 저장본을 확인해 주세요.';
    if (error.status === 423) return '배포가 진행 중이라 변경할 수 없습니다. 배포가 끝난 뒤 다시 시도해 주세요.';
    if (error.status === 429) return '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.';
    if (error.status === 400 || error.status === 413 || error.status === 415) return '입력 형식이나 파일 크기를 확인해 주세요. 입력한 내용은 유지됩니다.';
    if (error.status === 503) return '서버나 저장소에 잠시 연결할 수 없습니다. 다시 시도해 주세요.';
    if (error.kind === 'timeout') return '응답 시간이 초과되었습니다. 다시 시도해 주세요.';
    if (error.kind === 'network') return '서버에 연결할 수 없습니다. 연결 상태를 확인해 주세요.';
  }
  return '요청을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.';
}

type Csrf = { headerName: string; token: string };
const BASE = '/api/v1';

/** API_BASE의 기본값은 관리자 페이지와 같은 출처다. */
export const API_BASE = BASE;

export class AdminApi {
  private csrf: Csrf | null = null;

  private async request(path: string, method = 'GET', body?: unknown, signal?: AbortSignal, form = false): Promise<unknown> {
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const timer = window.setTimeout(abort, form ? 30_000 : 15_000);
    try {
      if (signal?.aborted) controller.abort();
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (method !== 'GET') {
        const token = this.csrf ?? await this.fetchCsrf(signal);
        headers[token.headerName] = token.token;
      }
      if (body !== undefined && !form) headers['Content-Type'] = 'application/json';
      const response = await fetch(`${BASE}${path}`, {
        method, body: form ? body as FormData : body === undefined ? undefined : JSON.stringify(body),
        headers, credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: controller.signal,
      });
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) this.csrf = null;
        let code: string | null = null;
        if (response.status === 409 && (response.headers.get('Content-Type') ?? '').includes('json')) {
          try {
            const problem = await response.json() as { code?: unknown };
            if (problem?.code === 'CONTENT_WRITE_LOCKED') code = problem.code;
          } catch { /* 안정적인 오류 코드 외 서버 본문은 표시하지 않는다. */ }
        }
        throw new ApiError(response.status, 'http', code);
      }
      if (response.status === 204) return null;
      const contentType = response.headers.get('Content-Type') ?? '';
      if (!contentType.includes('json')) throw new ApiError(0, 'response');
      try { return await response.json() as unknown; }
      catch { throw new ApiError(0, 'response'); }
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (signal?.aborted) throw error;
      throw new ApiError(0, controller.signal.aborted ? 'timeout' : 'network');
    } finally {
      window.clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  }

  private async fetchCsrf(signal?: AbortSignal): Promise<Csrf> {
    const response = await this.request('/auth/csrf', 'GET', undefined, signal) as Partial<Csrf>;
    if (response?.headerName !== 'X-CSRF-TOKEN' || typeof response.token !== 'string' || !response.token)
      throw new ApiError(0, 'response');
    this.csrf = { headerName: response.headerName, token: response.token };
    return this.csrf;
  }

  async me(): Promise<{ username: string; role: string }> {
    const value = await this.request('/auth/me') as { username?: unknown; role?: unknown };
    if (typeof value?.username !== 'string' || value.role !== 'ADMIN') throw new ApiError(403);
    return { username: value.username, role: value.role };
  }

  async login(password: string, verificationCode: string, rememberMe: boolean): Promise<void> {
    this.csrf = null;
    await this.fetchCsrf();
    const value = await this.request('/auth/login', 'POST', { password, verificationCode, rememberMe }) as { role?: unknown };
    if (value?.role !== 'ADMIN') throw new ApiError(403);
    this.csrf = null;
    await this.fetchCsrf();
  }

  async logout(): Promise<void> {
    try { await this.request('/auth/logout', 'POST'); }
    finally { this.csrf = null; }
  }

  get<T>(path: string, signal?: AbortSignal): Promise<T> { return this.request(path, 'GET', undefined, signal) as Promise<T>; }
  write<T>(method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
    return this.request(path, method, body) as Promise<T>;
  }
  upload<T>(path: string, form: FormData): Promise<T> { return this.request(path, 'POST', form, undefined, true) as Promise<T>; }
}
