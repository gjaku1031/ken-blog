"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ApiFailure, apiFailureMessage, apiJson } from "@/lib/api";
import { parseCoursePage, parseCourseSummary, type CourseSummary } from "@/lib/notes";
import { useAuth } from "./auth-provider";

/** 같은 분야의 과목을 원본 응답 순서대로 묶어 화면에 표시한다. */
function groupCourses(items: CourseSummary[]): Array<{ field: string; courses: CourseSummary[] }> {
  const groups = new Map<string, CourseSummary[]>();
  items.forEach((item) => groups.set(item.field, [...(groups.get(item.field) ?? []), item]));
  return [...groups].map(([field, courses]) => ({ field, courses }));
}

/** 과목 목록과 관리자 새 과목 폼을 실제 Notes API에 연결한다. */
function NotesInstance() {
  const auth = useAuth();
  const router = useRouter();
  const [items, setItems] = useState<CourseSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ field: "", name: "", slug: "", description: "" });
  const fields = useMemo(() => [...new Set(items.map((item) => item.field))], [items]);
  const groups = useMemo(() => groupCourses(items), [items]);

  useEffect(() => {
    if (auth.status === "checking") return;
    const controller = new AbortController();
    setLoading(true); setError("");
    void (async () => {
      try {
        const credentials = await auth.readCredentials(controller.signal);
        const value = parseCoursePage(await apiJson<unknown>("/api/v1/notes", credentials, controller.signal));
        if (!controller.signal.aborted) { setItems(value.items); setLoading(false); }
      } catch (failure) {
        if (controller.signal.aborted) return;
        if (failure instanceof ApiFailure && failure.status === 401) auth.expire();
        setError(apiFailureMessage(failure)); setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [auth.status, auth.epoch, auth.readCredentials, auth.expire, retry]);

  /** {@link parseCourseSummary}로 생성 결과를 확인한 뒤 새 과목 소개로 이동한다. */
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.field.trim() || !form.name.trim() || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(form.slug)) {
      setError("분야·과목 이름·영문 주소를 확인해 주세요."); return;
    }
    setSaving(true); setError("");
    try {
      const created = parseCourseSummary(await auth.adminWrite("POST", "/api/v1/admin/courses", {
        ...form, field: form.field.trim(), name: form.name.trim(), status: "IN_PROGRESS",
      }));
      router.push(`/course/?slug=${encodeURIComponent(created.slug)}`);
    } catch (failure) { setError(apiFailureMessage(failure)); }
    finally { setSaving(false); }
  }

  return <main id="main-content" className="page-container notes-page">
    <div className="section-heading"><h1>Notes</h1>{auth.user?.role === "ADMIN" && <button type="button" className="feed-write-link plain-button"
      onClick={() => setCreating((value) => !value)}>{creating ? "닫기" : "+ 새 과목"}</button>}</div>
    {creating && <form className="course-create card" onSubmit={(event) => void create(event)}>
      <label>분야<input list="course-fields" value={form.field} maxLength={80} required
        onChange={(event) => setForm((current) => ({ ...current, field: event.target.value }))} /></label>
      <datalist id="course-fields">{fields.map((field) => <option key={field} value={field} />)}</datalist>
      <label>과목 이름<input value={form.name} maxLength={160} required
        onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} /></label>
      <label>영문 주소<input value={form.slug} pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength={160} required
        onChange={(event) => setForm((current) => ({ ...current, slug: event.target.value }))} /></label>
      <label>한 줄 설명<input value={form.description} maxLength={300}
        onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} /></label>
      <div><button type="button" className="small-button" onClick={() => setCreating(false)}>취소</button>
        <button type="submit" className="primary-button" disabled={saving}>{saving ? "만드는 중…" : "만들기"}</button></div>
    </form>}
    {loading && <p role="status">과목을 불러오고 있습니다…</p>}
    {error && <p role="alert" className="inline-error">{error} {!creating && <button type="button" className="small-button"
      onClick={() => setRetry((value) => value + 1)}>다시 시도</button>}</p>}
    {!loading && !error && items.length === 0 && <div className="message-card card">아직 등록된 과목이 없습니다.</div>}
    {groups.map((group) => <section className="notes-group" key={group.field}><h2>{group.field}</h2>
      <div className="notes-grid">{group.courses.map((course) => <article className="course-card card" key={course.id}>
        <h3><Link href={`/course/?slug=${encodeURIComponent(course.slug)}`}>{course.name}</Link></h3>
        {course.description && <p>{course.description}</p>}
        <div className="course-card-meta">{course.chapterCount}회차 · {course.status === "COMPLETED" ? "완결" : "진행 중"}
          {course.latestPublishedDate && <> · <time dateTime={course.latestPublishedDate}>{course.latestPublishedDate.replaceAll("-", ".")}</time></>}</div>
      </article>)}</div></section>)}
  </main>;
}

/** 인증 세대가 바뀌면 이전 비공개 과목을 즉시 폐기한다. */
export function NotesList() {
  const auth = useAuth();
  return <NotesInstance key={auth.epoch} />;
}
