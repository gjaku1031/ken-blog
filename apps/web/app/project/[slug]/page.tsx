import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StaticProjectReader } from "@/components/project-reader";
import { getPublicContent, getPublicRoutes } from "@/lib/public-content";
import { noIndexMetadata, publicMetadata, seoDescription } from "@/lib/seo";

export const dynamicParams = false;

/** 공개 프로젝트 주소를 열거하고 빈 목록에는 빌드 전용 무효 주소를 둠. */
export function generateStaticParams() {
  const projects = getPublicRoutes().projects.map((slug) => ({ slug }));
  return projects.length ? projects : [{ slug: "_empty" }];
}

/** 프로젝트 대문의 공개 소개와 원문에서 검색 설명을 작성. */
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const detail = getPublicContent().projectDetails[slug];
  return detail && !detail.locked ? publicMetadata(detail.project.name,
    seoDescription(detail.project.overview, detail.home.body), `/project/${slug}/`) : noIndexMetadata;
}

/** 프로젝트 대문 원문을 빌드 시 렌더링. */
export default async function StaticProjectPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const detail = getPublicContent().projectDetails[slug];
  if (!detail || detail.locked) notFound();
  return <StaticProjectReader detail={detail} />;
}
