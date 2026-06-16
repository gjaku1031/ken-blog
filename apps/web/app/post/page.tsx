import { Suspense } from "react";
import { PostReader } from "@/components/post-reader";

/** 빌드 시 글을 요청하지 않고 브라우저 쿼리의 slug로 상세를 여는 정적 경로. */
export default function PostPage() {
  return <Suspense fallback={<main id="main-content" className="post-page page-container" role="status">글을 준비하고 있습니다…</main>}><PostReader /></Suspense>;
}
