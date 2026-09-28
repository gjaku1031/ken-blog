import type { ReactNode } from "react";
import { noIndexMetadata } from "@/lib/seo";

export const metadata = noIndexMetadata;

/** 로그인 화면의 정적 문서를 검색 색인에서 제외. */
export default function LoginLayout({ children }: { children: ReactNode }) {
  return children;
}
