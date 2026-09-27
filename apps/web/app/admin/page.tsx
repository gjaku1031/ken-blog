import { AdminShell } from "@/components/admin/admin-shell";
import { AnalyticsDashboard } from "@/components/admin/analytics-dashboard";

/** 실제 GA4 응답으로만 대시보드를 그린다. */
export default function AdminPage() { return <AdminShell><AnalyticsDashboard /></AdminShell>; }
