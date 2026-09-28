import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StaticCourseReader } from "@/components/course-reader";
import { getPublicContent, getPublicRoutes } from "@/lib/public-content";
import { noIndexMetadata, publicMetadata, seoDescription } from "@/lib/seo";

export const dynamicParams = false;

/** 공개 과목 주소를 열거하고 빈 목록에는 빌드 전용 무효 주소를 둠. */
export function generateStaticParams() {
  const courses = getPublicRoutes().courses.map((slug) => ({ slug }));
  return courses.length ? courses : [{ slug: "_empty" }];
}

/** 과목의 공개 제목·한 줄 설명을 검색 메타데이터에 사용. */
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const detail = getPublicContent().courseDetails[slug];
  return detail ? publicMetadata(detail.course.name, seoDescription(detail.course.description), `/course/${slug}/`) : noIndexMetadata;
}

/** 과목 소개와 공개 회차 탐색을 서버 렌더링. */
export default async function StaticCoursePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const detail = getPublicContent().courseDetails[slug];
  if (!detail) notFound();
  return <StaticCourseReader detail={detail} />;
}
