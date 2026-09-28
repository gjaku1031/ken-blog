import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StaticPostReader } from "@/components/post-reader";
import { getPublicContent, getPublicRoutes } from "@/lib/public-content";
import { noIndexMetadata, publicMetadata, seoDescription } from "@/lib/seo";

export const dynamicParams = false;

/** 익명 공개 TECH 주소를 열거하고 빈 목록에는 빌드 전용 무효 주소를 둠. */
export function generateStaticParams() {
  const posts = getPublicRoutes().posts.map((slug) => ({ slug }));
  return posts.length ? posts : [{ slug: "_empty" }];
}

/** 빌드에 캡처한 공개 제목·요약으로 검색 결과 메타데이터를 작성. */
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const post = getPublicContent().posts.find((entry) => entry.slug === slug);
  return post ? publicMetadata(post.title, seoDescription(post.summary, post.body ?? ""), `/post/${slug}/`) : noIndexMetadata;
}

/** 원문을 서버 렌더링한 HTML에 실어 직접 진입과 검색 엔진 색인을 지원. */
export default async function StaticPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = getPublicContent().posts.find((entry) => entry.slug === slug);
  if (!post) notFound();
  return <StaticPostReader post={post} />;
}
