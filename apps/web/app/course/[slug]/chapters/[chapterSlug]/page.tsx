import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StaticCourseReader } from "@/components/course-reader";
import { getPublicContent, getPublicRoutes } from "@/lib/public-content";
import { noIndexMetadata, publicMetadata, seoDescription } from "@/lib/seo";

export const dynamicParams = false;

/** 공개 회차만 열거하고 빈 목록에는 빌드 전용 무효 주소를 둠. */
export function generateStaticParams() {
  const chapters = Object.entries(getPublicRoutes().chapters).flatMap(([slug, chapters]) =>
    chapters.map((chapterSlug) => ({ slug, chapterSlug })));
  return chapters.length ? chapters : [{ slug: "_empty", chapterSlug: "_empty" }];
}

/** 회차별 공개 제목·요약과 정식 주소를 지정. */
export async function generateMetadata({ params }: { params: Promise<{ slug: string; chapterSlug: string }> }): Promise<Metadata> {
  const { slug, chapterSlug } = await params;
  const chapter = getPublicContent().chapters[slug]?.[chapterSlug];
  return chapter ? publicMetadata(chapter.title, seoDescription(chapter.summary, chapter.body ?? ""),
    `/course/${slug}/chapters/${chapterSlug}/`) : noIndexMetadata;
}

/** 과목 탐색과 선택 회차 원문을 빌드 시 HTML에 렌더링. */
export default async function StaticCourseChapterPage({ params }: { params: Promise<{ slug: string; chapterSlug: string }> }) {
  const { slug, chapterSlug } = await params;
  const detail = getPublicContent().courseDetails[slug];
  const chapter = getPublicContent().chapters[slug]?.[chapterSlug];
  if (!detail || !chapter) notFound();
  return <StaticCourseReader detail={detail} chapter={chapter} />;
}
