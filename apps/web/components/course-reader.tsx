"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ApiFailure, apiFailureMessage, apiJson, parsePostDetail, recordPostView, type PostDetail } from "@/lib/api";
import { parseCourseDetail, parseCourseSummary, type CourseDetail, type ChapterSummary } from "@/lib/notes";
import { buildReadingDocument } from "@/lib/reading-document";
import { useAuth } from "./auth-provider";
import { SafeMarkdown } from "./safe-markdown";
import { TableOfContents } from "./table-of-contents";
import { PostBacklinks } from "./post-backlinks";
import { PublicAnalytics } from "./public-analytics";
import { readPinnedIds } from "@/lib/feed";

/** 공개 과목을 유지하며 회차 선택 때 오른쪽 원문만 교체한다. */
function CourseShell({ slug, chapterSlug }: { slug: string; chapterSlug: string | null }) {
  const auth = useAuth();
  const router = useRouter();
  const [detail, setDetail] = useState<CourseDetail | null>(null);
  const [chapter, setChapter] = useState<PostDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [chapterLoading, setChapterLoading] = useState(false);
  const [error, setError] = useState("");
  const [chapterError, setChapterError] = useState("");
  const [retry, setRetry] = useState(0);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [pinBusy, setPinBusy] = useState(false);
  const [pinned, setPinned] = useState<Record<number, boolean>>({});
  const [orderRows, setOrderRows] = useState<Array<{ id: number; title: string }> | null>(null);
  const viewed = useRef(new Set<number>());
  const [viewCounts, setViewCounts] = useState<Record<number, number>>({});
  const [form, setForm] = useState({ slug: "", field: "", name: "", description: "", status: "IN_PROGRESS" as "IN_PROGRESS" | "COMPLETED" });
  const reading = useMemo(() => chapter && !chapter.locked ? buildReadingDocument(chapter.body ?? "") : null, [chapter]);
  const chapters = detail?.chapters ?? [];
  const index = chapterSlug ? chapters.findIndex((item) => item.slug === chapterSlug) : -1;
  const href = (item: ChapterSummary) => `/course/?slug=${encodeURIComponent(slug)}&chapter=${encodeURIComponent(item.slug)}`;

  useEffect(() => { setDeleting(false); setEditing(false); setMessage(""); }, [chapterSlug]);

  useEffect(() => {
    if (!chapter || chapter.locked || viewed.current.has(chapter.id)) return;
    viewed.current.add(chapter.id);
    void recordPostView(chapter.id).then((count) => setViewCounts((current) => ({ ...current, [chapter.id]: count })))
      .catch(() => undefined);
  }, [chapter]);

  /** 마지막 저장본에서 편집 입력을 다시 만들고 임시 취소 상태를 지운다. */
  function cancelEdit() {
    if (detail) setForm({ slug: detail.course.slug, field: detail.course.field, name: detail.course.name,
      description: detail.course.description, status: detail.course.status });
    setEditing(false); setMessage("");
  }

  /** 비출간 회차도 포함한 전체 과목 순서를 관리자 상세에서 읽는다. */
  async function startOrder() {
    if (!detail) return;
    setSaving(true); setMessage("");
    try {
      const value = await auth.adminRead(`/api/v1/admin/courses/${detail.course.id}`);
      if (!value || typeof value !== "object" || !("chapters" in value) || !Array.isArray(value.chapters))
        throw new ApiFailure("response");
      const rows = value.chapters.map((entry) => { const row = entry as { id?: unknown; title?: unknown; order?: unknown };
        if (!Number.isSafeInteger(row.id) || typeof row.title !== "string" || !Number.isSafeInteger(row.order))
          throw new ApiFailure("response");
        return { id: row.id as number, title: row.title, order: row.order as number }; });
      setOrderRows(rows.sort((left, right) => left.order - right.order).map(({ id, title }) => ({ id, title })));
    } catch (failure) { setMessage(apiFailureMessage(failure)); }
    finally { setSaving(false); }
  }

  /** 현재 orderRows의 모든 ID를 과목 전용 경로로 저장한다. */
  async function saveOrder() {
    if (!detail || !orderRows) return;
    setSaving(true); setMessage("");
    try { await auth.adminWrite("PUT", `/api/v1/admin/courses/${detail.course.id}/chapters/order`, {
      postIds: orderRows.map((row) => row.id) }); setOrderRows(null); setRetry((value) => value + 1); }
    catch (failure) { setMessage(apiFailureMessage(failure)); }
    finally { setSaving(false); }
  }

  useEffect(() => {
    if (auth.status === "checking") return;
    const controller = new AbortController();
    setLoading(true); setError(""); setDetail(null);
    void (async () => {
      try {
        const credentials = await auth.readCredentials(controller.signal);
        const result = parseCourseDetail(await apiJson<unknown>(`/api/v1/notes/${encodeURIComponent(slug)}`, credentials, controller.signal));
        if (result.course.slug !== slug) throw new ApiFailure("response");
        if (!controller.signal.aborted) {
          setDetail(result); setLoading(false);
          setForm({ slug: result.course.slug, field: result.course.field, name: result.course.name,
            description: result.course.description, status: result.course.status });
        }
      } catch (failure) {
        if (!controller.signal.aborted) { setLoading(false); setError(apiFailureMessage(failure)); }
      }
    })();
    return () => controller.abort();
  }, [auth.status, auth.epoch, auth.readCredentials, slug, retry]);

  useEffect(() => {
    if (!chapterSlug || !detail || auth.status === "checking") { setChapter(null); return; }
    const controller = new AbortController();
    setChapter(null); setChapterLoading(true); setChapterError("");
    void (async () => {
      try {
        const credentials = await auth.readCredentials(controller.signal);
        const response = await apiJson<unknown>(`/api/v1/notes/${encodeURIComponent(slug)}/chapters/${encodeURIComponent(chapterSlug)}`,
          credentials, controller.signal);
        if (!response || typeof response !== "object" || !("chapter" in response)) throw new ApiFailure("response");
        const post = parsePostDetail(response.chapter);
        if (post.section !== "NOTE_CHAPTER" || post.courseSlug !== slug || post.slug !== chapterSlug) throw new ApiFailure("response");
        if (!controller.signal.aborted) { setChapter(post); setChapterLoading(false); }
      } catch (failure) { if (!controller.signal.aborted) { setChapterError(apiFailureMessage(failure)); setChapterLoading(false); } }
    })();
    return () => controller.abort();
  }, [auth.status, auth.epoch, auth.readCredentials, slug, chapterSlug, detail, retry]);

  /** {@link parseCourseSummary}로 수정 결과를 확인한 뒤 slug 변경 시 새 주소로 이동한다. */
  async function saveCourse(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail || !form.field.trim() || !form.name.trim() || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(form.slug)) {
      setMessage("분야·과목 이름·영문 주소를 확인해 주세요."); return;
    }
    setSaving(true); setMessage("");
    try {
      const result = parseCourseSummary(await auth.adminWrite("PUT", `/api/v1/admin/courses/${detail.course.id}`, form));
      setEditing(false);
      if (result.slug !== slug) router.replace(`/course/?slug=${encodeURIComponent(result.slug)}`);
      else setRetry((value) => value + 1);
    } catch (failure) { setMessage(apiFailureMessage(failure)); }
    finally { setSaving(false); }
  }

  /** 확인한 과목과 회차를 서버에서 삭제하고 Notes 목록으로 돌아간다. */
  async function deleteCourse() {
    if (!detail) return;
    setSaving(true); setMessage("");
    try { await auth.adminWrite("DELETE", `/api/v1/admin/courses/${detail.course.id}`); router.replace("/notes/"); }
    catch (failure) { setMessage(apiFailureMessage(failure)); setSaving(false); }
  }

  /** 현재 회차를 삭제한 후 같은 과목의 소개와 목록을 새로 읽는다. */
  async function deleteChapter() {
    if (!detail || !chapter) return;
    setSaving(true); setMessage("");
    try {
      await auth.adminWrite("DELETE", `/api/v1/admin/courses/${detail.course.id}/chapters/${chapter.id}`);
      router.replace(`/course/?slug=${encodeURIComponent(slug)}`); setRetry((value) => value + 1);
    } catch (failure) { setMessage(apiFailureMessage(failure)); }
    finally { setSaving(false); }
  }

  /** 과목 회차를 전체 핀 순서와 함께 고정하거나 해제한다. */
  async function togglePin(post: PostDetail) {
    if (pinBusy) return;
    setPinBusy(true); setMessage("");
    try {
      const ids = await readPinnedIds(await auth.readCredentials());
      const index = ids.indexOf(post.id);
      if (index < 0) ids.push(post.id); else ids.splice(index, 1);
      await auth.adminWrite("PUT", "/api/v1/admin/pins", { postIds: ids });
      setPinned((current) => ({ ...current, [post.id]: index < 0 }));
    } catch (failure) { setMessage(apiFailureMessage(failure)); }
    finally { setPinBusy(false); }
  }

  if (loading) return <main id="main-content" className="page-container course-page" role="status">과목을 불러오고 있습니다…</main>;
  if (error || !detail) return <main id="main-content" className="page-container course-page"><Link href="/notes/">← Notes</Link>
    <p role="alert">{error}</p><button type="button" className="small-button" onClick={() => setRetry((value) => value + 1)}>다시 시도</button></main>;

  return <main id="main-content" className="page-container course-page project-layout">
    {(!chapterSlug || chapter && !chapter.locked) && <PublicAnalytics virtualPath={chapterSlug ?
      `/course/${slug}/chapters/${chapterSlug}` : `/course/${slug}`} />}
    <aside className="project-sidebar course-sidebar" aria-label="과목 탐색"><Link href="/notes/" className="back-link">← Notes</Link>
      <h2>{detail.course.field} › {detail.course.name}</h2>
      <nav aria-label="과목 회차"><Link href={`/course/?slug=${encodeURIComponent(slug)}`} aria-current={!chapterSlug ? "page" : undefined}>과목 소개</Link>
        <ol>{chapters.map((item, position) => <li key={item.id}><Link href={href(item)}
          aria-current={chapterSlug === item.slug ? "page" : undefined}>{position + 1}강 · {item.title}
          {item.visibility === "PRIVATE" && <span> · 비공개</span>}</Link></li>)}</ol></nav>
      {auth.user?.role === "ADMIN" && <Link className="project-add-document"
        href={`/write/?section=notes&courseId=${detail.course.id}`}>+ 다음 회차 쓰기</Link>}
      {auth.user?.role === "ADMIN" && (orderRows ? <div className="project-order card"><strong>회차 순서</strong><ol>
        {orderRows.map((row, position) => <li key={row.id}><span>{row.title}</span>
          <button type="button" aria-label={`${row.title} 위로`} disabled={position === 0 || saving} onClick={() => setOrderRows((current) => {
            if (!current) return current; const next = [...current]; [next[position - 1], next[position]] = [next[position], next[position - 1]];
            return next; })}>▲</button><button type="button" aria-label={`${row.title} 아래로`} disabled={position === orderRows.length - 1 || saving}
              onClick={() => setOrderRows((current) => { if (!current) return current; const next = [...current];
                [next[position], next[position + 1]] = [next[position + 1], next[position]]; return next; })}>▼</button></li>)}</ol>
        <button type="button" className="small-button" onClick={() => setOrderRows(null)}>취소</button>
        <button type="button" className="primary-button" disabled={saving} onClick={() => void saveOrder()}>순서 저장</button>
      </div> : <button type="button" className="project-order-link" disabled={saving}
        onClick={() => void startOrder()}>회차 순서</button>)}
      {reading && reading.toc.length > 0 && <TableOfContents items={reading.toc} />}
    </aside>
    <article className="project-main card course-main">
      {!chapterSlug && <>
        {deleting ? <div className="inline-confirm" role="alertdialog" aria-label="과목 삭제 확인">
          <p>“{detail.course.name}” 과목과 소속 회차 {chapters.length}개를 삭제합니다.</p>
          <button type="button" className="small-button" onClick={() => setDeleting(false)}>취소</button>
          <button type="button" className="small-button danger-button" disabled={saving} onClick={() => void deleteCourse()}>삭제</button>
        </div> : editing ? <form className="course-edit" onSubmit={(event) => void saveCourse(event)}
          onKeyDown={(event) => { if (event.key === "Escape") cancelEdit(); }}>
          <label>분야<input value={form.field} required onChange={(event) => setForm((current) => ({ ...current, field: event.target.value }))} /></label>
          <label>과목 이름<input value={form.name} required onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} /></label>
          <label>영문 주소<input value={form.slug} required pattern="[a-z0-9]+(-[a-z0-9]+)*"
            onChange={(event) => setForm((current) => ({ ...current, slug: event.target.value }))} /></label>
          <label>상태<select value={form.status} onChange={(event) => setForm((current) => ({ ...current,
            status: event.target.value as typeof current.status }))}><option value="IN_PROGRESS">진행 중</option><option value="COMPLETED">완결</option></select></label>
          <label>한 줄 설명<input value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} /></label>
          <div><button type="button" className="small-button" onClick={cancelEdit}>취소</button>
            <button type="submit" className="primary-button" disabled={saving}>저장</button></div>
        </form> : <>
          <div className="project-overline">{detail.course.field} · {detail.course.status === "COMPLETED" ? "완결" : "진행 중"} · {chapters.length}회차
            {auth.user?.role === "ADMIN" && <span className="inline-actions"><button type="button" onClick={() => setEditing(true)}>수정</button>
              <button type="button" onClick={() => setDeleting(true)}>삭제</button></span>}</div>
          <h1>{detail.course.name}</h1>{detail.course.description && <p className="project-overview">{detail.course.description}</p>}
          <ol className="course-chapters">{chapters.map((item, position) => <li key={item.id}><Link href={href(item)}>
            <span>{position + 1}강 · {item.title}</span><time dateTime={item.publishedDate}>{item.publishedDate.replaceAll("-", ".")}</time>
          </Link></li>)}</ol>
          {!chapters.length && <p>아직 출간된 회차가 없습니다.</p>}
        </>}
      </>}
      {chapterSlug && <>
        {chapterLoading && <p role="status">회차를 불러오고 있습니다…</p>}
        {chapterError && <p role="alert">{chapterError}</p>}
        {chapter && <><div className="project-overline">Notes · <Link href={`/course/?slug=${encodeURIComponent(slug)}`}>
          {detail.course.name}</Link>{!chapter.locked && index >= 0 ? ` · ${index + 1}강 / ${chapters.length}` : ""} · {chapter.publishedDate.replaceAll("-", ".")}
          {!chapter.locked && viewCounts[chapter.id] !== undefined ? ` · 조회 ${viewCounts[chapter.id].toLocaleString("ko-KR")}` : ""}
          {auth.user?.role === "ADMIN" && <span className="inline-actions"><Link href={`/write/?postId=${chapter.id}`}>수정</Link>
            <button type="button" disabled={pinBusy} onClick={() => void togglePin(chapter)}>
              {(pinned[chapter.id] ?? chapter.pinOrder !== null) ? "핀 해제" : "핀 고정"}</button>
            <button type="button" onClick={() => setDeleting(true)}>삭제</button></span>}</div>
          <h1>{chapter.title}</h1>
          {deleting ? <div className="inline-confirm" role="alertdialog" aria-label="회차 삭제 확인"><p>“{chapter.title}” 회차를 삭제합니다.</p>
            <button type="button" className="small-button" onClick={() => setDeleting(false)}>취소</button>
            <button type="button" className="small-button danger-button" disabled={saving} onClick={() => void deleteChapter()}>삭제</button></div> :
            chapter.locked ? <div className="locked-post"><p>로그인 후 읽을 수 있는 회차입니다.</p>
              <Link href={`/login/?returnTo=${encodeURIComponent(`/course/?slug=${slug}&chapter=${chapterSlug}`)}`}>로그인</Link></div> : <>
              <SafeMarkdown body={chapter.body ?? ""} source={{ kind: "post", postId: chapter.id }} reading={reading ?? undefined} />
              <PostBacklinks key={chapterSlug} slug={chapterSlug} />
            </>}
          {!chapter.locked && index >= 0 && <nav className="project-document-neighbors" aria-label="이전·다음 회차">
            {chapters[index - 1] && <Link href={href(chapters[index - 1])}>← 이전 {index}강 · {chapters[index - 1].title}</Link>}
            {chapters[index + 1] && <Link href={href(chapters[index + 1])}>다음 {index + 2}강 · {chapters[index + 1].title} →</Link>}
          </nav>}</>}
      </>}
      {message && <p role="alert" className="inline-error">{message}</p>}
    </article>
  </main>;
}

/** 정적 과목 주소의 중복·형식을 검사하고 권한 변경마다 화면을 분리한다. */
export function CourseReader() {
  const params = useSearchParams();
  const auth = useAuth();
  const slugs = params.getAll("slug");
  const chapters = params.getAll("chapter");
  const valid = slugs.length === 1 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slugs[0]) && chapters.length <= 1 &&
    (!chapters.length || /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(chapters[0])) &&
    [...params.keys()].every((key) => key === "slug" || key === "chapter");
  if (!valid) return <main id="main-content" className="page-container course-page"><h1>과목 주소를 확인해 주세요</h1>
    <Link href="/notes/">Notes 목록</Link></main>;
  return <CourseShell key={`${auth.epoch}:${slugs[0]}`} slug={slugs[0]} chapterSlug={chapters[0] ?? null} />;
}
