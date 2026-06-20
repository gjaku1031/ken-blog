import { Suspense } from "react";
import { WritePage } from "@/components/editor/write-page";

/** 정적 출력에서 쿼리·세션을 브라우저에서 읽는 관리자 글쓰기 화면. */
export default function Page() {
  return <Suspense fallback={<main id="main-content" className="write-page" role="status">글쓰기 화면을 준비하고 있습니다…</main>}>
    <WritePage />
  </Suspense>;
}
