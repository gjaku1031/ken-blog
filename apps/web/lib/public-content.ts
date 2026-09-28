import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PostDetail } from "./api";
import type { FeedItem } from "./feed";
import type { CourseDetail, CourseSummary } from "./notes";
import type { HomeProfile } from "./profile";
import type { ProjectDetail, ProjectSummary } from "./projects";

/** 빌드 전에 익명 공개 API에서 수집하고 서버에서만 읽는 전체 원문. */
export type PublicContentSnapshot = {
  version: 1;
  profile: HomeProfile | null;
  feed: FeedItem[];
  projects: ProjectSummary[];
  notes: CourseSummary[];
  posts: PostDetail[];
  projectDetails: Record<string, ProjectDetail>;
  projectDocuments: Record<string, Record<string, PostDetail>>;
  courseDetails: Record<string, CourseDetail>;
  chapters: Record<string, Record<string, PostDetail>>;
};

/** 본문 없이 클라이언트 링크 판단에 쓸 수 있는 공개 주소 목록. */
export type PublicRouteManifest = {
  version: 1;
  posts: string[];
  projects: string[];
  projectDocuments: Record<string, string[]>;
  courses: string[];
  chapters: Record<string, string[]>;
};

let snapshot: PublicContentSnapshot | null = null;
let routes: PublicRouteManifest | null = null;

/** 생성된 원문을 빌드 서버에서 한 번만 읽어 HTML 렌더링에 전달. */
export function getPublicContent(): PublicContentSnapshot {
  if (!snapshot) snapshot = JSON.parse(readFileSync(join(process.cwd(), ".generated/public-content.json"), "utf8")) as PublicContentSnapshot;
  return snapshot;
}

/** 빌드할 동적 주소만 읽고 본문은 공개 라우트 매니페스트에 포함하지 않음. */
export function getPublicRoutes(): PublicRouteManifest {
  if (!routes) routes = JSON.parse(readFileSync(join(process.cwd(), ".generated/public-routes.json"), "utf8")) as PublicRouteManifest;
  return routes;
}
