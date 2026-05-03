import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ken Blog",
  description: "Ken Blog 프로젝트를 준비하고 있습니다.",
};

/** 모든 페이지에 한국어 문서 구조와 공통 스타일을 적용하는 레이아웃. */
export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
