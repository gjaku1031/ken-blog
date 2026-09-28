import routes from "@/.generated/public-routes.json";

type PublicRouteManifest = { posts: string[]; projects: string[]; projectDocuments: Record<string, string[]>;
  courses: string[]; chapters: Record<string, string[]> };
const manifest = routes as PublicRouteManifest;

/** 빌드에 실제 HTML이 생성된 Tech 글만 공개 경로로 연결한다. {@link publicPostPath} */
export function publicPostPath(slug: string): string {
  return manifest.posts.includes(slug) ? `/post/${encodeURIComponent(slug)}/` :
    `/post/?slug=${encodeURIComponent(slug)}`;
}

/** 프로젝트 대문과 문서 각각의 생성 여부를 확인해 접근 가능한 주소를 돌려준다. {@link publicProjectPath} */
export function publicProjectPath(slug: string, documentSlug?: string): string {
  if (documentSlug) {
    const documents = Object.prototype.hasOwnProperty.call(manifest.projectDocuments, slug) ?
      manifest.projectDocuments[slug] : undefined;
    return Array.isArray(documents) && documents.includes(documentSlug) ?
      `/project/${encodeURIComponent(slug)}/docs/${encodeURIComponent(documentSlug)}/` :
      `/project/?slug=${encodeURIComponent(slug)}&doc=${encodeURIComponent(documentSlug)}`;
  }
  return manifest.projects.includes(slug) ? `/project/${encodeURIComponent(slug)}/` :
    `/project/?slug=${encodeURIComponent(slug)}`;
}

/** 과목 소개와 회차 각각의 생성 여부를 확인해 접근 가능한 주소를 돌려준다. {@link publicCoursePath} */
export function publicCoursePath(slug: string, chapterSlug?: string): string {
  if (chapterSlug) {
    const chapters = Object.prototype.hasOwnProperty.call(manifest.chapters, slug) ? manifest.chapters[slug] : undefined;
    return Array.isArray(chapters) && chapters.includes(chapterSlug) ?
      `/course/${encodeURIComponent(slug)}/chapters/${encodeURIComponent(chapterSlug)}/` :
      `/course/?slug=${encodeURIComponent(slug)}&chapter=${encodeURIComponent(chapterSlug)}`;
  }
  return manifest.courses.includes(slug) ? `/course/${encodeURIComponent(slug)}/` :
    `/course/?slug=${encodeURIComponent(slug)}`;
}
