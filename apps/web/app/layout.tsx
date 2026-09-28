import type { Metadata } from "next";
import Script from "next/script";
import type { ReactNode } from "react";
import { AuthProvider } from "@/components/auth-provider";
import { SiteShell } from "@/components/site-shell";
import "@fontsource-variable/noto-sans-kr/wght.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://gjaku1031.github.io"),
  title: { default: "ken.blog", template: "%s | ken.blog" },
  description: "Tech 글과 프로젝트 기록을 읽는 ken.blog",
  openGraph: { type: "website", title: "ken.blog", description: "Tech 글과 프로젝트 기록을 읽는 ken.blog",
    url: "https://gjaku1031.github.io/ken-blog/", siteName: "ken.blog", locale: "ko_KR" },
  twitter: { card: "summary", title: "ken.blog", description: "Tech 글과 프로젝트 기록을 읽는 ken.blog" },
};

/** 정적 경로에 글꼴·세션 상태·공통 셸을 적용하고 공개 원문은 각 페이지에서 렌더링. */
export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="ko">
      <body>
        {process.env.NEXT_PUBLIC_GA_ENABLED === "true" && <Script id="ken-blog-ga-privacy" strategy="beforeInteractive">{
          "window['ga-disable-G-JDYNG61J70']=true;window.dataLayer=window.dataLayer||[];window.gtag=function(){dataLayer.push(arguments)};gtag('js',new Date());gtag('config','G-JDYNG61J70',{send_page_view:false});"
        }</Script>}
        <AuthProvider><SiteShell>{children}</SiteShell></AuthProvider></body>
    </html>
  );
}
