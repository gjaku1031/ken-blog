import { Suspense } from "react";
import { PostFeed } from "@/components/post-feed";

/** 분류·태그 URL 필터를 공유하는 Tech 전용 정적 경로. */
export default function TechPage() {
  return <main id="main-content" className="page-container tech-page">
    <Suspense fallback={<div className="message-card card" role="status">Tech 글을 준비하고 있습니다…</div>}><PostFeed mode="tech" /></Suspense>
  </main>;
}
