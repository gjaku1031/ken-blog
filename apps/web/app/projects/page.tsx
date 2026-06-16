import Link from "next/link";

/** 아직 데이터 API가 없는 Projects의 준비 상태를 명시한다. */
export default function ProjectsPage() {
  return <main id="main-content" className="page-container coming-page"><div className="card coming-card">
    <p className="eyebrow">Projects</p><h1>프로젝트 화면을 준비 중입니다.</h1>
    <p>프로젝트 기록을 준비 중입니다.</p>
    <Link href="/tech/">Tech 글 읽기 →</Link>
  </div></main>;
}
