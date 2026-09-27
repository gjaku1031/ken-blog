import { AdminShell } from "@/components/admin/admin-shell";
import { StackManager } from "@/components/admin/stack-manager";

/** OCI 이미지 뱃지 레지스트리를 관리한다. */
export default function StacksAdminPage() { return <AdminShell><StackManager /></AdminShell>; }
