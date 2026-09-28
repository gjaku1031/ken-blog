import type { ReactNode } from "react";
import { noIndexMetadata } from "@/lib/seo";

export const metadata = noIndexMetadata;

/** 글쓰기 화면의 내용이 검색 엔진에 색인되지 않도록 설정. */
export default function WriteLayout({ children }: { children: ReactNode }) {
  return children;
}
