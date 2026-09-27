import { Suspense } from "react";
import { HomeSummary } from "@/components/home-summary";
import { PostFeed } from "@/components/post-feed";

/** 저장된 프로필·실제 글쓰기 기록과 Tech·Notes 혼합 피드를 홈에 표시한다. */
export default function HomePage() {
  return <main id="main-content" className="page-container home-page">
    <Suspense fallback={<p role="status">소개를 불러오고 있습니다…</p>}><HomeSummary /></Suspense>
    <Suspense fallback={<div className="message-card card" role="status">글을 불러오고 있습니다…</div>}>
      <PostFeed mode="home" /></Suspense>
  </main>;
}
