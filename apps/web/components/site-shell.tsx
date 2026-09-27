"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAuth } from "./auth-provider";
import { PublicAnalytics, disablePublicAnalytics } from "./public-analytics";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

/** 원본 시안의 회전된 드릴 비트 로고를 벡터 경로로 표시한다. {@link DrillLogo} */
function DrillLogo() {
  return <svg width="32" height="32" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2.6"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <g transform="rotate(-45 24 24)">
      <path d="M8 12.5 L45 24 L8 35.5 Z" />
      <path d="M14 14.4 Q17.5 24 14 33.6 M22 16.9 Q24.8 24 22 31.1 M30 19.4 Q32 24 30 28.6 M37 21.6 Q38.2 24 37 26.4" />
    </g>
  </svg>;
}

/** 원본 헤더의 선형 아이콘을 {@link SiteShell} 버튼에 표시한다. */
function HeaderIcon({ name }: { name: "search" | "moon" | "sun" | "close" }) {
  const shared = { width: 19, height: 19, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2,
    strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true as const };
  if (name === "search") return <svg {...shared}><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 5 5" /></svg>;
  if (name === "moon") return <svg {...shared}><path d="M20.6 14.1A8.6 8.6 0 0 1 9.9 3.4 8.6 8.6 0 1 0 20.6 14.1Z" /></svg>;
  if (name === "sun") return <svg {...shared}><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" /></svg>;
  return <svg {...shared}><path d="M5 5l14 14M19 5 5 19" /></svg>;
}

/** 정적 라우트에 공유하는 네비게이션·테마·세션 표시·푸터. {@link SiteShell} */
export function SiteShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const currentPath = (pathname.startsWith(basePath) ? pathname.slice(basePath.length) : pathname) || "/";
  const auth = useAuth();
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [logoutError, setLogoutError] = useState("");
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchKeyboardFocus, setSearchKeyboardFocus] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const searchToggle = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    /** {@link SiteShell}의 검색 입력으로 Tab 이동할 때만 포커스 테두리를 표시한다. */
    const keyboard = (event: KeyboardEvent) => { if (event.key === "Tab") setSearchKeyboardFocus(true); };
    /** {@link SiteShell}의 포인터 입력에서는 원본의 중립 테두리를 유지한다. */
    const pointer = () => setSearchKeyboardFocus(false);
    document.addEventListener("keydown", keyboard);
    document.addEventListener("pointerdown", pointer);
    return () => { document.removeEventListener("keydown", keyboard); document.removeEventListener("pointerdown", pointer); };
  }, []);

  useEffect(() => {
    if (currentPath === "/search/") {
      setSearchOpen(true);
      setSearch(new URLSearchParams(window.location.search).get("q") ?? "");
    }
  }, [currentPath]);

  useEffect(() => {
    if (!searchOpen) return;
    // 컨테이너의 첫 확장 프레임을 그린 뒤 입력에 초점을 옮긴다.
    let nextFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      nextFrame = requestAnimationFrame(() => searchInput.current?.focus({ preventScroll: true }));
    });
    return () => { cancelAnimationFrame(firstFrame); cancelAnimationFrame(nextFrame); };
  }, [searchOpen]);

  useEffect(() => {
    if (!searchOpen) return;
    const value = search.trim();
    if (!value) { if (currentPath === "/search/") router.replace("/"); return; }
    const timer = window.setTimeout(() => {
      const target = `/search/?q=${encodeURIComponent(value)}`;
      if (window.location.pathname + window.location.search !== `${basePath}${target}`) {
        disablePublicAnalytics(); router.replace(target);
      }
    }, 180);
    return () => window.clearTimeout(timer);
  }, [search, searchOpen, currentPath, router]);

  useEffect(() => {
    let saved: string | null = null;
    try { saved = window.localStorage.getItem("ken-blog-theme"); } catch { /* 저장소가 차단된 브라우저에서도 기본 테마를 표시한다. */ }
    const next = saved === "dark" || saved === "light" ? saved :
      window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    setTheme(next);
    document.documentElement.dataset.theme = next;
  }, []);

  useEffect(() => {
    const beforeNavigation = (event: MouseEvent) => {
      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (anchor instanceof HTMLAnchorElement && anchor.origin === window.location.origin && anchor.href !== window.location.href) {
        disablePublicAnalytics();
      }
    };
    document.addEventListener("click", beforeNavigation, true);
    window.addEventListener("popstate", disablePublicAnalytics);
    return () => { document.removeEventListener("click", beforeNavigation, true);
      window.removeEventListener("popstate", disablePublicAnalytics); };
  }, [currentPath]);

  /** 사용자가 고른 색을 로컬에만 저장하고 즉시 적용한다. {@link toggleTheme} */
  function toggleTheme() {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try { window.localStorage.setItem("ken-blog-theme", next); } catch { /* 선택은 현재 화면에만 적용한다. */ }
  }

  /** 클라이언트 이동과 Pages basePath를 모두 고려해 현재 메뉴를 표시한다. {@link isCurrent} */
  function isCurrent(path: string) {
    if (path === "/" && currentPath === "/search/") return true;
    if (path === "/projects/" && currentPath === "/project/") return true;
    return currentPath === path || (path !== "/" && currentPath.startsWith(path));
  }

  /** 먼저 화면 세션을 비운 뒤 서버 세션 삭제 오류만 공개 안내로 표시한다. {@link handleLogout} */
  async function handleLogout() {
    setLogoutError("");
    try { await auth.logout(); }
    catch { setLogoutError("서버 로그아웃을 완료하지 못했습니다. 연결을 확인해 주세요."); }
  }

  /** 검색어만 지우고 {@link searchInput}에 포커스를 유지한다. */
  function clearSearch() {
    setSearch("");
    searchInput.current?.focus();
  }

  /** 검색 입력을 접고 열기 버튼에 초점을 돌려 키보드 탐색을 이어간다. {@link SiteShell} */
  function closeSearch(clear: boolean) {
    setSearchOpen(false);
    if (clear) setSearch("");
    if (currentPath === "/search/") router.push("/");
    requestAnimationFrame(() => searchToggle.current?.focus());
  }

  return <div className="site-root">
    <PublicAnalytics />
    <a className="skip-link" href="#main-content">본문으로 건너뛰기</a>
    <header className="site-header">
      <div className="header-inner">
        <Link href="/" className="brand" aria-label="ken.blog 홈"><DrillLogo /><span>ken<span className="brand-dot">.</span>blog</span></Link>
        <nav className="main-nav" aria-label="주 메뉴">
          {([["/", "Home"], ["/tech/", "Tech"], ["/projects/", "Projects"], ["/notes/", "Notes"]] as const).map(([href, label]) =>
            <Link key={href} href={href} aria-current={isCurrent(href) ? "page" : undefined}>{label}</Link>)}
        </nav>
        <div className="header-actions">
          <div className={`header-search-unit${searchOpen ? " is-open" : ""}`} data-keyboard-focus={searchKeyboardFocus}>
            <button ref={searchToggle} type="button" className="header-search-toggle"
              aria-label={searchOpen ? "검색 닫기" : "검색 열기"} aria-expanded={searchOpen} aria-controls="site-search"
              onClick={() => { if (searchOpen) closeSearch(false); else setSearchOpen(true); }}><HeaderIcon name="search" /></button>
            <form className="header-search" role="search" aria-hidden={!searchOpen}
              inert={!searchOpen} onKeyDown={(event) => {
              if (event.key === "Escape") { event.preventDefault(); closeSearch(false); }
              }} onSubmit={(event) => {
                event.preventDefault(); const value = search.trim(); if (value) { disablePublicAnalytics(); router.push(`/search/?q=${encodeURIComponent(value)}`); }
              }}><label className="sr-only" htmlFor="site-search">글 검색</label>
              <input ref={searchInput} id="site-search" type="search" value={search}
                onChange={(event) => setSearch(event.target.value)} placeholder="제목 · 본문 · 태그 검색" />
              {search && <button type="button" className="header-search-clear" aria-label="검색어 지우기" onClick={clearSearch}>
                <HeaderIcon name="close" /></button>}
              <button type="button" className="header-search-close" aria-label="검색 닫기"
                onClick={() => closeSearch(true)}><HeaderIcon name="close" /></button></form>
          </div>
          <button type="button" className="theme-switch" role="switch" aria-checked={theme === "dark"}
            aria-label="다크 모드" title={theme === "dark" ? "다크 모드 켜짐" : "다크 모드 꺼짐"} onClick={toggleTheme}>
            <span className="theme-switch-track"><span className="theme-switch-thumb">
              <HeaderIcon name={theme === "dark" ? "moon" : "sun"} /></span></span>
          </button>
          {auth.status === "authenticated" && auth.user?.role === "ADMIN" &&
            <Link href="/admin/" className="header-text-button">관리</Link>}
          {auth.status === "authenticated" && auth.user ? <>
            <span className="account-avatar" title={auth.user.username} aria-label={`${auth.user.username} 계정`}>
              {auth.user.username.slice(0, 1).toUpperCase()}</span>
            <button type="button" className="header-text-button" onClick={() => void handleLogout()}>로그아웃</button>
          </> : <Link href="/login/" className="header-text-button" aria-label="관리자 로그인">관리자</Link>}
        </div>
      </div>
      {logoutError && <p className="header-alert" role="alert">{logoutError}</p>}
    </header>
    <div className="site-content">{children}</div>
    {!currentPath.startsWith("/write/") && <footer className="site-footer"><span>© 2026 ken.blog</span><div>
      <a href="https://github.com/gjaku1031/ken-blog" target="_blank" rel="noreferrer noopener">GitHub</a>
      <Link href="/admin/">관리자</Link>
    </div></footer>}
  </div>;
}
