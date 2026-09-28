import { ProjectsList } from "@/components/projects-list";
import { getPublicContent } from "@/lib/public-content";
import { canonicalUrl } from "@/lib/seo";
import type { Metadata } from "next";

const title = "Projects | ken.blog";
const description = "ken.blog의 프로젝트 기록과 문서";
const url = canonicalUrl("/projects/");
export const metadata: Metadata = {
  title: "Projects", description, alternates: { canonical: url },
  openGraph: { type: "website", title, description, url, siteName: "ken.blog", locale: "ko_KR" },
  twitter: { card: "summary", title, description },
};

/** 익명 공개 프로젝트를 정적 HTML에 표시하고 브라우저에서 권한별 목록을 갱신한다. */
export default function ProjectsPage() {
  return <ProjectsList initialItems={getPublicContent().projects} />;
}
