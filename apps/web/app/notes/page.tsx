import { NotesList } from "@/components/notes-list";
import { getPublicContent } from "@/lib/public-content";
import { canonicalUrl } from "@/lib/seo";
import type { Metadata } from "next";

const title = "Notes | ken.blog";
const description = "ken.blog의 과목과 회차별 학습 기록";
const url = canonicalUrl("/notes/");
export const metadata: Metadata = {
  title: "Notes", description, alternates: { canonical: url },
  openGraph: { type: "website", title, description, url, siteName: "ken.blog", locale: "ko_KR" },
  twitter: { card: "summary", title, description },
};

/** 익명 공개 과목을 정적 HTML에 표시하고 브라우저에서 권한별 목록을 갱신한다. */
export default function NotesPage() { return <NotesList initialItems={getPublicContent().notes} />; }
