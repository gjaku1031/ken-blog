import { Suspense } from "react";
import { AdminShell } from "@/components/admin/admin-shell";
import { PostManager } from "@/components/admin/post-manager";

/** {@link PostManager}의 정적 쿼리 필터와 출간 글의 공개 범위·편집·삭제를 관리한다. */
export default function PostsAdminPage() { return <AdminShell><Suspense fallback={<p role="status">글 관리 화면을 준비하고 있습니다…</p>}>
  <PostManager /></Suspense></AdminShell>; }
