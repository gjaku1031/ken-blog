import { Suspense } from "react";
import { ProjectReader } from "@/components/project-reader";

/** 정적 출력에서 프로젝트·문서 쿼리를 브라우저가 검증해 여는 경로. */
export default function ProjectPage() {
  return <Suspense fallback={<main id="main-content" className="page-container project-page" role="status">
    프로젝트를 준비하고 있습니다…</main>}><ProjectReader /></Suspense>;
}
