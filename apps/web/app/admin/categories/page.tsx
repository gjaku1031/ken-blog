import { AdminShell } from "@/components/admin/admin-shell";
import { CategoryManager } from "@/components/admin/category-manager";

/** 분류 폴더와 상위 이동 삭제를 관리한다. */
export default function CategoriesAdminPage() { return <AdminShell><CategoryManager /></AdminShell>; }
