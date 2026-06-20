import { Suspense } from "react";
import { DraftList } from "@/components/editor/draft-list";

/** 정적 관리자 편집본 목록의 쿼리 페이지를 클라이언트 경계에서 읽는다. */
export default function AdminDraftsPage() {
  return <main id="main-content" className="draft-list-page">
    <Suspense fallback={<div className="draft-list-shell" role="status">임시저장 목록을 준비하고 있습니다…</div>}>
      <DraftList />
    </Suspense>
  </main>;
}
