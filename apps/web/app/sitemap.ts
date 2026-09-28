import type { MetadataRoute } from "next";
import { getPublicContent } from "@/lib/public-content";
import { canonicalUrl } from "@/lib/seo";

export const dynamic = "force-static";

/** 공개 정적 주소만 열거하고 잠금·원고·관리 경로는 사이트맵에서 제외. */
export default function sitemap(): MetadataRoute.Sitemap {
  const content = getPublicContent();
  const entries: MetadataRoute.Sitemap = ["/", "/tech/", "/projects/", "/notes/"].map((path) =>
    ({ url: canonicalUrl(path) }));
  for (const post of content.posts) entries.push({ url: canonicalUrl(`/post/${post.slug}/`) });
  for (const [slug, detail] of Object.entries(content.projectDetails)) {
    if (detail.locked) continue;
    entries.push({ url: canonicalUrl(`/project/${slug}/`) });
    for (const document of Object.values(content.projectDocuments[slug] ?? {}))
      entries.push({ url: canonicalUrl(`/project/${slug}/docs/${document.slug}/`) });
  }
  for (const [slug, detail] of Object.entries(content.courseDetails)) {
    entries.push({ url: canonicalUrl(`/course/${slug}/`) });
    for (const chapter of Object.values(content.chapters[slug] ?? {}))
      entries.push({ url: canonicalUrl(`/course/${slug}/chapters/${chapter.slug}/`) });
  }
  return entries;
}
