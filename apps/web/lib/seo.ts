import type { Metadata } from "next";

const siteOrigin = "https://gjaku1031.github.io";
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "/ken-blog";

/** Pages의 basePath와 끝 슬래시를 포함하는 검색 엔진용 절대 주소를 생성. */
export function canonicalUrl(path: string): string {
  const route = path.startsWith("/") ? path : `/${path}`;
  const normalized = route.endsWith("/") || /\.[a-z0-9]+$/i.test(route) ? route : `${route}/`;
  return `${siteOrigin}${basePath}${normalized}`;
}

/** Markdown 원문의 문법을 줄이고 검색 결과에 적합한 짧은 설명을 생성. */
export function seoDescription(summary: string | null | undefined, body = ""): string {
  const source = (summary?.trim() || body).replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[`*_#>~|]/g, " ").replace(/\s+/g, " ").trim();
  return Array.from(source).slice(0, 160).join("") || "ken.blog의 기술 글과 프로젝트 기록";
}

/** 공개 정적 문서마다 canonical·OG·Twitter·색인 허용 계약을 일관되게 설정. */
export function publicMetadata(title: string, description: string, path: string): Metadata {
  const url = canonicalUrl(path);
  return { title, description, alternates: { canonical: url }, robots: { index: true, follow: true },
    openGraph: { type: "article", title, description, url, siteName: "ken.blog", locale: "ko_KR" },
    twitter: { card: "summary", title, description } };
}

/** 이전 쿼리 라우트와 비공개 동작 화면을 검색 결과에서 제외. */
export const noIndexMetadata: Metadata = { robots: { index: false, follow: false } };
