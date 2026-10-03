import { sitePath } from './site-path';
import { mutate, clearCsrf, HttpError } from './admin-api';

/**
 * 관리자 여부에 따라 작성·로그아웃 버튼과 관리 링크 갱신
 */
export function updateHeaderSession(admin: boolean): void {
  document.querySelectorAll<HTMLElement>('[data-admin-write], #logout').forEach(element => { element.hidden = !admin; });
  const link = document.getElementById('admin-link');
  if (link) link.textContent = admin ? '관리' : '관리자';
}

/**
 * 공개 페이지와 관리자 화면에서 같은 검색·테마·로그아웃 동작을 사용함
 *
 * 1. 첫 페인트에 적용된 테마를 이어받고 사용자 전환 연결
 * 2. 검색 기록·페이지 이동·빈 검색어 처리를 화면에 맞춰 선택
 * 3. 검색 열기·닫기·키보드·제출 동작 연결
 * 4. 한글 조합 중에는 이동을 보류하고 검색을 지연 실행
 * 5. 로그아웃 또는 세션 만료 시 헤더 인증 상태 갱신
 */
export function connectHeader(options: {
  /**
   * 검색어에 맞춘 현재 목록 갱신 콜백
   */
  onSearch?: () => void;

  /**
   * 테마 변경 반영 콜백
   */
  onThemeChange?: (theme: 'light' | 'dark') => void;

  /**
   * 로그아웃 후 화면 갱신 콜백
   */
  onLogout?: () => void;

  /**
   * 작업 실패 안내 콜백
   */
  onError?: (error: Error) => void;
} = {}): void {
  /**
   * head에서 결정한 테마를 이어받고, 사용자 조작만 저장함
   */
  function setTheme(theme: "light" | "dark", persist = false): void {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    if (persist) {
      try { localStorage.setItem("ken-blog-theme", theme); } catch { /* 저장소가 막혀도 현재 화면의 테마는 유지함 */ }
    }
    const toggle = document.querySelector<HTMLButtonElement>("#theme-toggle");
    if (toggle) { toggle.setAttribute("aria-checked", String(theme === "dark")); toggle.title = theme === "dark" ? "다크 모드 켜짐" : "다크 모드 꺼짐"; }
    options.onThemeChange?.(theme);
  }

  // 첫 페인트에 적용된 테마를 이어받고 사용자 전환 연결
  setTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
  document.querySelector<HTMLButtonElement>("#theme-toggle")?.addEventListener("click", () => setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark", true));

  /**
   * 현재 화면 경로 종류
   */
  const route = document.body.dataset.route;
  const searchPath = sitePath('search/');
  const homePath = sitePath('posts/');
  const searchUnit = document.querySelector<HTMLElement>(".header-search-unit");
  const searchToggle = document.querySelector<HTMLButtonElement>("#header-search-toggle");
  const searchClose = document.querySelector<HTMLButtonElement>("#header-search-close");
  const searchForm = document.querySelector<HTMLFormElement>(".header-search");
  const search = document.querySelector<HTMLInputElement>("#site-search");
  let searchTimer: number | undefined;
  let searchComposing = false;

  // 검색 기록·페이지 이동·빈 검색어 처리를 화면에 맞춰 선택

  /**
   * 검색 화면에서는 주소만 바꾸고, 다른 화면에서는 전체 검색 결과로 이동함
   */
  function navigateSearch(submitted: boolean): void {
    const value = search?.value.trim() ?? "";
    if (!value) {
      if (route === "search") location.assign(homePath);
      return;
    }
    const target = `${searchPath}?q=${encodeURIComponent(value)}`;
    if (route === "search") {
      if (location.pathname + location.search !== target) {
        if (submitted) history.pushState(history.state, "", target);
        else history.replaceState(history.state, "", target);
      }
      options.onSearch?.();
    } else if (submitted) location.assign(target);
    else location.replace(target);
  }

  /**
   * 입력이 잠시 멈추면 이동하되 한글 조합 중에는 대기함
   */
  function scheduleSearch(): void {
    window.clearTimeout(searchTimer);
    if (!searchComposing) searchTimer = window.setTimeout(() => navigateSearch(false), 180);
  }

  /**
   * 검색창을 접을 때 예약된 이동을 취소하고 검색 결과에서는 홈으로 돌아감
   */
  function openSearch(open: boolean): void {
    if (!open) {
      window.clearTimeout(searchTimer);
      if (route === "search") location.assign(homePath);
    }
    searchUnit?.classList.toggle("is-open", open);
    searchToggle?.setAttribute("aria-expanded", String(open));
    searchToggle?.setAttribute("aria-label", open ? "검색 닫기" : "검색 열기");
    searchForm?.setAttribute("aria-hidden", String(!open));
    if (searchForm) searchForm.inert = !open;
    if (open) search?.focus({ preventScroll: true });
  }
  // 검색 열기·닫기·키보드·제출 동작 연결
  searchToggle?.addEventListener("click", () => openSearch(!searchUnit?.classList.contains("is-open")));
  searchClose?.addEventListener("click", () => { openSearch(false); searchToggle?.focus(); });
  searchForm?.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { event.preventDefault(); openSearch(false); searchToggle?.focus(); }
    if (event.key === "Enter" && event.isComposing) event.preventDefault();
  });
  searchForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    if (searchComposing) return;
    window.clearTimeout(searchTimer);
    navigateSearch(true);
  });

  // 한글 조합 중에는 이동을 보류하고 검색을 지연 실행
  search?.addEventListener("input", () => {
    scheduleSearch();
  });
  search?.addEventListener("compositionstart", () => { searchComposing = true; window.clearTimeout(searchTimer); });
  search?.addEventListener("compositionend", () => { searchComposing = false; scheduleSearch(); });
  window.addEventListener("popstate", () => {
    if (route !== "search" || !search) return;
    window.clearTimeout(searchTimer);
    search.value = new URLSearchParams(location.search).get("q") ?? "";
    options.onSearch?.();
  });

  if (route === "search" && search) {
    search.value = new URLSearchParams(location.search).get("q") ?? "";
    if (!search.value.trim()) location.replace(homePath);
    else requestAnimationFrame(() => {
      // 첫 프레임을 기다리는 동안 사용자가 시작한 키보드·포인터 탐색의 포커스 보존
      if (document.activeElement === document.body) search.focus({ preventScroll: true });
    });
  }
  // 로그아웃 또는 세션 만료 시 헤더 인증 상태 갱신
  document.getElementById('logout')?.addEventListener('click', async () => {
    const button = document.getElementById('logout') as HTMLButtonElement;
    button.disabled = true;
    try {
      await mutate('/auth/logout', 'POST');
      clearCsrf(); updateHeaderSession(false); options.onLogout?.();
    } catch (error) {
      if (error instanceof HttpError && error.status === 401) {
        clearCsrf(); updateHeaderSession(false); options.onLogout?.();
      } else options.onError?.(error instanceof Error ? error : new Error('로그아웃에 실패했습니다.'));
    } finally { button.disabled = false; }
  });

}
