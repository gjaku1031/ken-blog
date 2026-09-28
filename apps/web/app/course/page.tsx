import { Suspense } from "react";
import { CourseReader } from "@/components/course-reader";
import { noIndexMetadata } from "@/lib/seo";

export const metadata = noIndexMetadata;

/** 정적 경로 하나에서 과목 소개와 선택 회차를 표시한다. */
export default function CoursePage() {
  return <Suspense fallback={<main id="main-content" role="status">과목을 불러오고 있습니다…</main>}><CourseReader /></Suspense>;
}
