import { AdminShell } from "@/components/admin/admin-shell";
import { MemberManager } from "@/components/admin/member-manager";

/** 초대 발급과 회원 삭제를 관리한다. */
export default function MembersAdminPage() { return <AdminShell><MemberManager /></AdminShell>; }
