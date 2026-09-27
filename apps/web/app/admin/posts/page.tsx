import { AdminShell } from "@/components/admin/admin-shell";
import { PostManager } from "@/components/admin/post-manager";

/** 섹션별 출간 글의 공개 범위와 편집·삭제를 관리한다. */
export default function PostsAdminPage() { return <AdminShell><PostManager /></AdminShell>; }
