"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { useAuth } from "./auth-provider";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

/** 원본 시안의 회전된 드릴 비트 로고를 벡터 경로로 표시한다. */
function DrillLogo() {
  return <svg width="32" height="32" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2.6"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <g transform="rotate(-45 24 24)">
      <path d="M8 12.5 L45 24 L8 35.5 Z" />
      <path d="M14 14.4 Q17.5 24 14 33.6 M22 16.9 Q24.8 24 22 31.1 M30 19.4 Q32 24 30 28.6 M37 21.6 Q38.2 24 37 26.4" />
    </g>
  </svg>;
}

/** 정적 라우트에 공유하는 네비게이션·테마·세션 표시·푸터. */
export function SiteShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const auth = useAuth();
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [logoutError, setLogoutError] = useState("");

  useEffect(() => {
    let saved: string | null = null;
    try { saved = window.localStorage.getItem("ken-blog-theme"); } catch { /* 저장소가 차단된 브라우저에서도 기본 테마를 표시한다. */ }
    const next = saved === "dark" || saved === "light" ? saved :
      window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    setTheme(next);
    document.documentElement.dataset.theme = next;
  }, []);

  /** 사용자가 고른 색을 로컬에만 저장하고 즉시 적용한다. */
  function toggleTheme() {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try { window.localStorage.setItem("ken-blog-theme", next); } catch { /* 선택은 현재 화면에만 적용한다. */ }
  }

  /** 클라이언트 이동과 Pages basePath를 모두 고려해 현재 메뉴를 표시한다. */
  function isCurrent(path: string) {
    const current = (pathname.startsWith(basePath) ? pathname.slice(basePath.length) : pathname) || "/";
    return current === path || (path !== "/" && current.startsWith(path));
  }

  /** 먼저 화면 세션을 비운 뒤 서버 세션 삭제 오류만 공개 안내로 표시한다. */
  async function handleLogout() {
    setLogoutError("");
    try { await auth.logout(); }
    catch { setLogoutError("서버 로그아웃을 완료하지 못했습니다. 연결을 확인해 주세요."); }
  }

  return <div className="site-root">
    <a className="skip-link" href="#main-content">본문으로 건너뛰기</a>
    <header className="site-header">
      <div className="header-inner">
        <Link href="/" className="brand" aria-label="ken.blog 홈"><DrillLogo /><span>ken<span className="brand-dot">.</span>blog</span></Link>
        <nav className="main-nav" aria-label="주 메뉴">
          {([["/", "Home"], ["/tech/", "Tech"], ["/projects/", "Projects"], ["/notes/", "Notes"]] as const).map(([href, label]) =>
            <Link key={href} href={href} aria-current={isCurrent(href) ? "page" : undefined}>{label}</Link>)}
        </nav>
        <div className="header-actions">
          <button type="button" className="icon-button" onClick={toggleTheme}
            aria-label={theme === "light" ? "다크 모드로 전환" : "라이트 모드로 전환"} title={theme === "light" ? "다크 모드" : "라이트 모드"}>
            {theme === "light" ? "☾" : "☀"}
          </button>
          {auth.status === "authenticated" && auth.user ? <>
            <span className="account-name">{auth.user.username}</span>
            <button type="button" className="header-text-button" onClick={() => void handleLogout()}>로그아웃</button>
          </> : <Link href="/login/" className="header-text-button">로그인</Link>}
        </div>
      </div>
      {logoutError && <p className="header-alert" role="alert">{logoutError}</p>}
    </header>
    <div className="site-content">{children}</div>
    <footer className="site-footer"><span>© 2026 ken.blog</span><div>
      <a href="https://github.com/gjaku1031/ken-blog" target="_blank" rel="noreferrer noopener">GitHub</a>
      <Link href="/login/">관리자</Link>
    </div></footer>
  </div>;
}
