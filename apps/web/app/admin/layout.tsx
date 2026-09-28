import type { ReactNode } from "react";
import { noIndexMetadata } from "@/lib/seo";

export const metadata = noIndexMetadata;

/** 관리자 화면 전체에 검색 색인 제외 메타데이터를 적용. */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return children;
}
