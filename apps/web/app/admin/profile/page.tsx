import { AdminShell } from "@/components/admin/admin-shell";
import { ProfileManager } from "@/components/admin/profile-manager";

/** 저장 전 미리보기와 실제 홈 프로필 저장을 관리한다. */
export default function ProfileAdminPage() { return <AdminShell><h1>홈 소개</h1><ProfileManager /></AdminShell>; }
