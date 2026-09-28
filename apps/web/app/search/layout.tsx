import type { ReactNode } from "react";
import { noIndexMetadata } from "@/lib/seo";

export const metadata = noIndexMetadata;

/** 검색 결과의 중복 URL이 검색 엔진에 쌓이지 않도록 설정. */
export default function SearchLayout({ children }: { children: ReactNode }) {
  return children;
}
