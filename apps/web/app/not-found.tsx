import Link from "next/link";

/** 공유 {@link import("@/components/site-shell").SiteShell} 안에서 잘못된 정적 주소를 안내한다. */
export default function NotFound() {
  return <main id="main-content" className="page-container not-found-page">
    <div className="not-found-content">
      <span className="not-found-code mono" aria-hidden="true">404</span>
      <h1>페이지를 찾을 수 없습니다</h1>
      <p>주소를 다시 확인하거나 다른 페이지로 이동해 주세요.</p>
      <div className="not-found-actions">
        <Link href="/" className="primary-button">홈으로</Link>
        <Link href="/projects/" className="not-found-secondary">프로젝트 목록</Link>
      </div>
    </div>
  </main>;
}
