"use client";

import { useEffect, useRef, type FormEvent } from "react";
import type { DraftSection, ProjectMetadata } from "@/lib/editor-drafts";

type Option = { id: number; label: string; field?: string; count?: number };
type Props = { title: string; section: DraftSection; summary: string; summaryPreview: string;
  visibility: "PUBLIC" | "PRIVATE"; busy: boolean; sectionLocked: boolean; error: string; categoryLabel: string; actionLabel: string;
  categoryDepth: number | null; categoryCount: number; techSeriesOrder: number | null;
  relatedProjectId: number | null; projectId: number | null; courseId: number | null;
  documentOrder: number | null; chapterOrder: number | null; projectMetadata: ProjectMetadata | null;
  projects: Option[]; courses: Option[];
  onSummary: (value: string) => void;
  onVisibility: (value: "PUBLIC" | "PRIVATE") => void; onSection: (value: DraftSection) => void;
  onRelatedProject: (value: number | null) => void; onProject: (value: number | null) => void;
  onCourse: (value: number | null) => void; onDocumentOrder: (value: number | null) => void;
  onChapterOrder: (value: number | null) => void; onTechSeriesOrder: (value: number | null) => void;
  onClose: () => void; onPublish: () => void };

const statuses: Record<ProjectMetadata["status"], string> = { PLAN: "기획 중", DEV: "개발 중", MAINT: "유지보수 중", DONE: "완료" };

/** 원본 36·37·39 상태의 두 열 출간 시트를 실제 편집본 필드에 연결한다. */
export function PublishSheet({ title, section, summary, summaryPreview, visibility, busy, sectionLocked, error, categoryLabel, actionLabel,
  categoryDepth, categoryCount, techSeriesOrder,
  relatedProjectId, projectId, courseId, documentOrder, chapterOrder, projectMetadata, projects, courses,
  onSummary, onVisibility, onSection, onRelatedProject, onProject, onCourse, onDocumentOrder,
  onChapterOrder, onTechSeriesOrder, onClose, onPublish }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    element?.focus();
  }, []);

  /** 브라우저 제출을 막고 상위의 저장→출간 직렬 흐름만 실행한다. */
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (!busy) onPublish(); }

  const home = section === "PROJECT_HOME";
  const selectedField = courses.find((course) => course.id === courseId)?.field ?? courses[0]?.field ?? "";
  const fields = [...new Set(courses.map((course) => course.field ?? ""))];
  return <dialog ref={dialog} tabIndex={-1} className={`publish-dialog editor-publish-sheet${home ? " editor-publish-home" : ""}`}
    onCancel={(event) => { if (busy) event.preventDefault(); else onClose(); }} onClose={onClose} aria-label="출간 설정">
    <form onSubmit={submit}>
      <div className="editor-publish-column">
        {home ? <>
          <h2>프로젝트 대문</h2>
          <div className="editor-publish-field"><span className="editor-publish-label">프로젝트 이름</span><strong>{title || "제목 없음"}</strong></div>
          <div className="editor-publish-field"><span className="editor-publish-label">상태 · 기간</span>
            <span className="editor-project-summary"><span className={`editor-project-dot ${projectMetadata?.status.toLowerCase() ?? "dev"}`} />{projectMetadata ? statuses[projectMetadata.status] : "개발 중"}
              {projectMetadata?.startPeriod && <span>{projectMetadata.startPeriod} – {projectMetadata.endPeriod || "현재"}</span>}</span></div>
          <div className="editor-publish-field"><span className="editor-publish-label">개요</span><span>{projectMetadata?.overview || "없음"}</span></div>
          <div className="editor-publish-field"><span className="editor-publish-label">기술 스택</span>
            {projectMetadata?.stackBadgeNames.length ? <div className="editor-publish-stacks">{projectMetadata.stackBadgeNames.map((name) =>
              <span key={name}><i aria-hidden="true">{name === "Java" ? "Jv" : name === "Spring Boot" ? "SB" :
                name === "MySQL" ? "My" : name === "Docker" ? "Dk" : name.slice(0, 2)}</i>{name}</span>)}</div> : <span>없음</span>}</div>
        </> : <>
          <h2>어디에 올릴까요</h2>
          <div className="editor-publish-options" role="radiogroup" aria-label="게시 위치">
            {([{"value": "TECH", "title": "Tech", "description": "시간순 피드에 올라갑니다"},
              {"value": "PROJECT_DOC", "title": "Projects", "description": "프로젝트 아래 문서로 들어갑니다"},
              {"value": "NOTE_CHAPTER", "title": "Notes", "description": "분야 › 과목 › 회차. 태그·분류 없음"}] as const).map((option) =>
              <button key={option.value} type="button" className={`editor-publish-option${section === option.value ? " selected" : ""}`}
                role="radio" aria-checked={section === option.value} disabled={busy || sectionLocked}
                title={sectionLocked ? "저장한 글의 게시 위치는 변경할 수 없습니다." : undefined}
                onClick={() => { if (section !== option.value) onSection(option.value); }}>
                <span className="editor-publish-radio" /><span><strong>{option.title}</strong><small>{option.description}</small></span></button>)}
          </div>
          {sectionLocked && <p className="editor-publish-section-note">저장한 글의 게시 위치는 유지됩니다.</p>}
          {section === "TECH" && <>
            <div className="editor-publish-field"><span className="editor-publish-label">분류</span><span>{categoryLabel}</span></div>
            <div className="editor-publish-field"><label htmlFor="publish-related-project">관련 프로젝트</label>
              <select id="publish-related-project" value={relatedProjectId ?? ""} disabled={busy}
                onChange={(event) => onRelatedProject(event.target.value ? Number(event.target.value) : null)}>
                <option value="">없음</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.label}</option>)}</select></div>
          </>}
          {section === "PROJECT_DOC" && <>
            <div className="editor-publish-field"><label htmlFor="publish-project">프로젝트</label>
              <select id="publish-project" value={projectId ?? ""} disabled={busy} onChange={(event) => onProject(event.target.value ? Number(event.target.value) : null)}>
                <option value="">프로젝트 선택</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.label}</option>)}</select></div>
            <div className="editor-publish-field"><span className="editor-publish-label">분류</span><span>{categoryLabel}</span></div>
            <div className="editor-publish-field"><label htmlFor="publish-document-order">문서 순서</label>
              <input id="publish-document-order" type="number" min="1" value={documentOrder ?? ""} disabled={busy}
                onChange={(event) => onDocumentOrder(event.target.value ? Number(event.target.value) : null)} /></div>
          </>}
          {section === "NOTE_CHAPTER" && <>
            <div className="editor-publish-field"><label htmlFor="publish-field">분야</label>
              <select id="publish-field" value={selectedField} disabled={busy}
                onChange={(event) => onCourse(courses.find((course) => course.field === event.target.value)?.id ?? null)}>
                {fields.map((field) => <option key={field} value={field}>{field}</option>)}</select></div>
            <div className="editor-publish-field"><label htmlFor="publish-course">과목</label>
              <select id="publish-course" value={courseId ?? ""} disabled={busy} onChange={(event) => onCourse(event.target.value ? Number(event.target.value) : null)}>
                <option value="">과목 선택</option>{courses.filter((course) => course.field === selectedField).map((course) =>
                  <option key={course.id} value={course.id}>{course.label}</option>)}</select></div>
            <div className="editor-publish-field"><label htmlFor="publish-chapter-order">회차</label>
              <div className="editor-publish-series"><input id="publish-chapter-order" type="number" min="1" value={chapterOrder ?? ""} disabled={busy}
                onChange={(event) => onChapterOrder(event.target.value ? Number(event.target.value) : null)} />
                <span>이 과목에 {courses.find((course) => course.id === courseId)?.count ?? 0}회차 있음 · 번호는 바꿀 수 있어요</span></div></div>
          </>}
        </>}
      </div>
      <div className="editor-publish-column">
        {!home && <div className="editor-publish-field"><label htmlFor="publish-summary">요약 <small>목록에서 제목 아래 한 줄로 보입니다</small><small className="editor-publish-count">{summary.length} / 120</small></label>
          <textarea id="publish-summary" value={summary} maxLength={120} rows={3} disabled={busy}
            onChange={(event) => onSummary(event.target.value)} placeholder={summaryPreview || "본문을 써야 가져올 문장이 생깁니다"} /></div>}
        <h2>공개 범위</h2>
        <div className="editor-publish-options" role="radiogroup" aria-label="공개 범위">
          <button type="button" role="radio" aria-checked={visibility === "PUBLIC"} className={`editor-publish-option${visibility === "PUBLIC" ? " selected" : ""}`}
            disabled={busy} onClick={() => onVisibility("PUBLIC")}><span className="editor-publish-radio" /><span><strong>공개</strong><small>누구나 볼 수 있어요</small></span></button>
          <button type="button" role="radio" aria-checked={visibility === "PRIVATE"} className={`editor-publish-option${visibility === "PRIVATE" ? " selected" : ""}`}
            disabled={busy} onClick={() => onVisibility("PRIVATE")}><span className="editor-publish-radio" /><span><strong>나만 보기</strong><small>관리자 계정에서만 볼 수 있어요</small></span></button>
        </div>
        {section === "TECH" && categoryDepth === 3 && <div className="editor-publish-field"><label htmlFor="publish-tech-series">시리즈 순서</label>
          <div className="editor-publish-series"><input id="publish-tech-series" type="number" min="1" max="2147483647" step="1"
            value={techSeriesOrder ?? ""} disabled={busy}
            onChange={(event) => { const raw = event.target.value;
              const order = Number(raw);
              onTechSeriesOrder(/^\d+$/.test(raw) && order >= 1 && order <= 2147483647 ? order : null);
            }} />
            <span>이 분류에 글 {categoryCount}편 · 번호는 바꿀 수 있어요</span></div></div>}
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="publish-actions"><button type="button" onClick={onClose} disabled={busy}>취소</button>
          <button type="submit" className="primary-button" disabled={busy}>{busy ? "출간 중…" : actionLabel}</button></div>
      </div>
    </form>
  </dialog>;
}
