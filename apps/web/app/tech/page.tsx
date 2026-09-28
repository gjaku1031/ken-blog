import { Suspense } from "react";
import { PostFeed } from "@/components/post-feed";
import { getPublicContent } from "@/lib/public-content";
import { canonicalUrl } from "@/lib/seo";
import type { Metadata } from "next";

const title = "Tech | ken.blog";
const description = "ken.blog의 기술 글 목록";
const url = canonicalUrl("/tech/");
export const metadata: Metadata = {
  title: "Tech", description, alternates: { canonical: url },
  openGraph: { type: "website", title, description, url, siteName: "ken.blog", locale: "ko_KR" },
  twitter: { card: "summary", title, description },
};

/** 분류·태그 URL 필터를 공유하는 Tech 전용 정적 경로. */
export default function TechPage() {
  const content = getPublicContent();
  return <main id="main-content" className="page-container tech-page">
    <Suspense fallback={<div className="message-card card" role="status">Tech 글을 준비하고 있습니다…</div>}>
      <PostFeed mode="tech" initialItems={content.feed.filter((item) => item.section === "TECH").slice(0, 10)} />
    </Suspense>
  </main>;
}
