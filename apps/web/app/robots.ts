import type { MetadataRoute } from "next";
import { canonicalUrl } from "@/lib/seo";

export const dynamic = "force-static";

/** 프로젝트 배포 경로의 검색 안내 파일을 출력. 실제 크롤러 정책은 호스트 루트 robots.txt에 종속. */
export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: "*", allow: "/ken-blog/", disallow: ["/ken-blog/admin/", "/ken-blog/write/",
    "/ken-blog/login/", "/ken-blog/search/"] }], sitemap: canonicalUrl("/sitemap.xml") };
}
