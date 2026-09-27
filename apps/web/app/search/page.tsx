import { Suspense } from "react";
import { SearchResults } from "@/components/search-results";

/** 정적 검색 주소에서 권한별 전체 글 검색을 실행한다. */
export default function SearchPage() { return <Suspense fallback={<main id="main-content" role="status">검색을 준비하고 있습니다…</main>}>
  <SearchResults /></Suspense>; }
