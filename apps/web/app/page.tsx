import { Suspense } from "react";
import { HomeSummary } from "@/components/home-summary";
import { PostFeed } from "@/components/post-feed";
import { getPublicContent } from "@/lib/public-content";
import { canonicalUrl } from "@/lib/seo";
import type { Metadata } from "next";

const title = "ken.blog | Tech·Projects·Notes";
const description = "기술 글과 프로젝트, 학습 기록을 모아 둔 ken.blog";
const url = canonicalUrl("/");
export const metadata: Metadata = {
  title: { absolute: title }, description, alternates: { canonical: url },
  openGraph: { type: "website", title, description, url, siteName: "ken.blog", locale: "ko_KR" },
  twitter: { card: "summary", title, description },
};

/** 저장된 프로필·실제 글쓰기 기록과 Tech·Notes 혼합 피드를 홈에 표시한다. */
export default function HomePage() {
  const content = getPublicContent();
  return <main id="main-content" className="page-container home-page">
    <Suspense fallback={<p role="status">소개를 불러오고 있습니다…</p>}><HomeSummary initialProfile={content.profile} /></Suspense>
    <Suspense fallback={<div className="message-card card" role="status">글을 불러오고 있습니다…</div>}>
      <PostFeed mode="home" initialItems={content.feed.slice(0, 10)} /></Suspense>
  </main>;
}
