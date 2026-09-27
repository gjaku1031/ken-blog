"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useAuth } from "../auth-provider";
import "./admin-design.css";

const tabs = [["/admin/", "대시보드"], ["/admin/posts/", "글 관리"],
  ["/admin/members/", "회원 관리"], ["/admin/categories/", "분류 관리"], ["/admin/stacks/", "기술 스택"],
  ["/admin/profile/", "홈 소개"]] as const;

/** {@link useAuth}의 ADMIN 권한이 확인된 때에만 원본 관리 탐색과 하위 페이지를 렌더한다. */
export function AdminShell({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const pathname = usePathname();
  if (auth.status === "checking") return <main id="main-content" className="page-container admin-page" role="status">관리자 세션을 확인하고 있습니다…</main>;
  if (auth.status === "error") return <main id="main-content" className="page-container admin-page"><p role="alert">API 연결을 확인해 주세요.</p>
    <button type="button" className="small-button" onClick={() => void auth.refresh()}>다시 시도</button></main>;
  if (auth.status !== "authenticated" || auth.user?.role !== "ADMIN") return <main id="main-content" className="page-container admin-page">
    <h1>관리자 로그인</h1><Link className="primary-button" href={`/login/?returnTo=${encodeURIComponent(pathname)}`}>로그인</Link></main>;
  return <main id="main-content" className="page-container admin-page admin-layout"><aside className="admin-nav" aria-label="관리 메뉴">
    <span>관리</span><nav>{tabs.map(([href, label]) => <Link key={href} href={href}
      aria-current={pathname === href || pathname.endsWith(href) ||
        href === "/admin/posts/" && pathname.startsWith("/admin/drafts") ? "page" : undefined}>{label}</Link>)}</nav></aside>
    <section className="admin-content">{children}</section></main>;
}
