import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StaticProjectReader } from "@/components/project-reader";
import { getPublicContent, getPublicRoutes } from "@/lib/public-content";
import { noIndexMetadata, publicMetadata, seoDescription } from "@/lib/seo";

export const dynamicParams = false;

/** 공개 문서만 열거하고 빈 목록에는 빌드 전용 무효 주소를 둠. */
export function generateStaticParams() {
  const documents = Object.entries(getPublicRoutes().projectDocuments).flatMap(([slug, documents]) =>
    documents.map((documentSlug) => ({ slug, documentSlug })));
  return documents.length ? documents : [{ slug: "_empty", documentSlug: "_empty" }];
}

/** 해당 문서 원문의 공개 제목·요약·정식 주소를 지정. */
export async function generateMetadata({ params }: { params: Promise<{ slug: string; documentSlug: string }> }): Promise<Metadata> {
  const { slug, documentSlug } = await params;
  const document = getPublicContent().projectDocuments[slug]?.[documentSlug];
  return document ? publicMetadata(document.title, seoDescription(document.summary, document.body ?? ""),
    `/project/${slug}/docs/${documentSlug}/`) : noIndexMetadata;
}

/** 부모 대문과 선택 문서 본문을 같은 정적 HTML에 렌더링. */
export default async function StaticProjectDocumentPage({ params }: { params: Promise<{ slug: string; documentSlug: string }> }) {
  const { slug, documentSlug } = await params;
  const detail = getPublicContent().projectDetails[slug];
  const document = getPublicContent().projectDocuments[slug]?.[documentSlug];
  if (!detail || detail.locked || !document) notFound();
  return <StaticProjectReader detail={detail} document={document} />;
}
