import type { Metadata } from "next";
import { IBM_Plex_Mono, Noto_Sans_KR } from "next/font/google";
import type { ReactNode } from "react";
import { AuthProvider } from "@/components/auth-provider";
import { SiteShell } from "@/components/site-shell";
import "./globals.css";

const sans = Noto_Sans_KR({ subsets: ["latin"], weight: ["400", "500", "700"], variable: "--font-sans" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "ken.blog",
  description: "Tech 글과 프로젝트 기록을 읽는 ken.blog",
};

/** 정적 경로에 글꼴·세션 상태·공통 셸을 적용하고 데이터 요청은 브라우저에 맡긴다. */
export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="ko">
      <body className={`${sans.variable} ${mono.variable}`}><AuthProvider><SiteShell>{children}</SiteShell></AuthProvider></body>
    </html>
  );
}
