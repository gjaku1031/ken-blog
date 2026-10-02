import { mutate, clearCsrf, HttpError } from './admin-api';

export function updateHeaderSession(admin: boolean): void {
  document.querySelectorAll<HTMLElement>('[data-admin-write], #logout').forEach(element => { element.hidden = !admin; });
  const link = document.getElementById('admin-link');
  if (link) link.textContent = admin ? '관리' : '관리자';
}

/** 공개 페이지와 관리자 화면에서 같은 검색·테마·로그아웃 동작을 사용한다. */
export function connectHeader(options: {
  onSearch?: () => void;
  onThemeChange?: (theme: 'light' | 'dark') => void;
  onLogout?: () => void;
  onError?: (error: Error) => void;
} = {}): void {
  /** head에서 결정한 테마를 이어받고, 사용자 조작만 저장한다. */
  function setTheme(theme: "light" | "dark", persist = false): void {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    if (persist) {
      try { localStorage.setItem("ken-blog-theme", theme); } catch { /* 저장소가 막혀도 현재 화면의 테마는 유지한다. */ }
    }
    const toggle = document.querySelector<HTMLButtonElement>("#theme-toggle");
    if (toggle) { toggle.setAttribute("aria-checked", String(theme === "dark")); toggle.title = theme === "dark" ? "다크 모드 켜짐" : "다크 모드 꺼짐"; }
    options.onThemeChange?.(theme);
  }

  setTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
  document.querySelector<HTMLButtonElement>("#theme-toggle")?.addEventListener("click", () => setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark", true));

  /** 원본 헤더 검색 UI를 정적 결과 주소와 연결한다. */
  const route = document.body.dataset.route;
  const searchPath = "/ken-blog/search/";
  const homePath = "/ken-blog/posts/";
  const searchUnit = document.querySelector<HTMLElement>(".header-search-unit");
  const searchToggle = document.querySelector<HTMLButtonElement>("#header-search-toggle");
  const searchClose = document.querySelector<HTMLButtonElement>("#header-search-close");
  const searchForm = document.querySelector<HTMLFormElement>(".header-search");
  const search = document.querySelector<HTMLInputElement>("#site-search");
  let searchTimer: number | undefined;
  let searchComposing = false;

  /** 검색 화면에서는 주소만 바꾸고, 다른 화면에서는 전체 검색 결과로 이동한다. */
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

  /** 원본 검색창처럼 입력이 잠시 멈추면 이동하되 한글 조합 중에는 기다린다. */
  function scheduleSearch(): void {
    window.clearTimeout(searchTimer);
    if (!searchComposing) searchTimer = window.setTimeout(() => navigateSearch(false), 180);
  }

  /** 검색창을 접을 때 예약된 이동을 취소하고 검색 결과에서는 홈으로 돌아간다. */
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


  search?.addEventListener("input", () => {
    if (route === "search") options.onSearch?.();
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
    else requestAnimationFrame(() => search.focus({ preventScroll: true }));
  }
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
