"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ApiFailure, apiFailureMessage, postDestination, type CategoryNode, type TagCount } from "@/lib/api";
import { draftValues, parseAdminCategories, parseAdminPost, parseAdminTags, parseDraftDetail, parseDraftPage,
  positiveId, type AdminPost, type DraftDetail, type DraftSummary, type DraftValues,
  type DraftSection, type ProjectMetadata } from "@/lib/editor-drafts";
import { parseAdminProject, parseAdminProjectPage, type AdminProject } from "@/lib/projects";
import { parseCoursePage, type CourseSummary } from "@/lib/notes";
import { parseEditorMarkdown, serializeEditorMarkdown, type MarkdownDocument } from "@/lib/editor-markdown";
import { collectAttachmentIds, type ImageData } from "@/lib/editor-image";
import { buildEditorAnnotationModel, matchingEditorAnnotationModel, stripInlineAnnotations,
  type EditorAnnotationModel } from "@/lib/editor-annotation";
import { validWikiTitle } from "@/lib/wiki-link-syntax";
import { collectWikiTargets } from "@/lib/wiki-targets";
import { useAuth } from "@/components/auth-provider";
import { AnnotationReader } from "@/components/annotation-reader";
import { BlockEditor, type BlockEditorHandle } from "./block-editor";
import { PublishSheet } from "./publish-sheet";
import { WikiLinkPicker } from "./wiki-link-picker";
import { StackBadgePicker } from "./stack-badge-picker";
import { CategoryPicker } from "./category-picker";
import { ProjectPicker } from "./project-picker";
import { ShortcutHelp } from "./shortcut-help";
import "./editor-design.css";

type Route = { kind: "new"; title: string | null; section: DraftSection; projectId: number | null; courseId: number | null } |
  { kind: "post" | "draft"; id: number } | { kind: "invalid" };
type Form = Omit<DraftValues, "body" | "attachmentIds" | "wikiTargets"> & { document: MarkdownDocument };
type Screen = "loading" | "ready" | "existing" | "error";

/** 정적 검색 쿼리에서 중복·동시 ID와 안전하지 않은 숫자를 거부한다. */
function routeFromParams(params: URLSearchParams): Route {
  const draft = params.getAll("draftId");
  const post = params.getAll("postId");
  const titles = params.getAll("title");
  const sections = params.getAll("section");
  const projects = params.getAll("projectId");
  const courses = params.getAll("courseId");
  if (draft.length > 1 || post.length > 1 || titles.length > 1 ||
    sections.length > 1 || projects.length > 1 || courses.length > 1 ||
    Number(Boolean(draft.length)) + Number(Boolean(post.length)) + Number(Boolean(titles.length)) > 1 ||
    [...params.keys()].some((name) => !["draftId", "postId", "title", "section", "projectId", "courseId"].includes(name)) ||
    ((draft.length || post.length) && (sections.length || projects.length || courses.length))) return { kind: "invalid" };
  if (draft.length) { const id = positiveId(draft[0]); return id === null ? { kind: "invalid" } : { kind: "draft", id }; }
  if (post.length) { const id = positiveId(post[0]); return id === null ? { kind: "invalid" } : { kind: "post", id }; }
  if (sections.length || projects.length) {
    if (titles.length || sections.length !== 1 ||
      (!["project-home", "project-doc", "notes"].includes(sections[0])) ||
      (sections[0] === "project-home" && (projects.length !== 0 || courses.length !== 0)) ||
      (sections[0] === "project-doc" && (projects.length !== 1 || courses.length !== 0)) ||
      (sections[0] === "notes" && (courses.length !== 1 || projects.length !== 0))) return { kind: "invalid" };
    const projectId = projects.length ? positiveId(projects[0]) : null;
    const courseId = courses.length ? positiveId(courses[0]) : null;
    return sections[0] === "project-doc" && projectId === null || sections[0] === "notes" && courseId === null ? { kind: "invalid" } :
      { kind: "new", title: null, section: sections[0] === "project-home" ? "PROJECT_HOME" :
        sections[0] === "project-doc" ? "PROJECT_DOC" : "NOTE_CHAPTER", projectId, courseId };
  }
  if (titles.length) {
    const title = validWikiTitle(titles[0]);
    return title && title === titles[0] ? { kind: "new", title, section: "TECH", projectId: null, courseId: null } : { kind: "invalid" };
  }
  return { kind: "new", title: null, section: "TECH", projectId: null, courseId: null };
}

/** 화면에 남겨 둔 원고 식별자로 정적 주소를 다시 만든다. */
function routeHref(key: string): string {
  if (key === "new") return "/write/";
  if (key === "new:project-home") return "/write/?section=project-home";
  if (key.startsWith("new:project-doc:")) return `/write/?section=project-doc&projectId=${key.slice(16)}`;
  if (key.startsWith("new:notes:")) return `/write/?section=notes&courseId=${key.slice(10)}`;
  if (key.startsWith("new:")) return `/write/?title=${encodeURIComponent(key.slice(4))}`;
  const [kind, id] = key.split(":");
  return `/write/?${kind === "post" ? "postId" : "draftId"}=${id}`;
}

/** Spring의 UTC LocalDateTime을 KST 저장 시각으로 표시한다. */
function savedTime(utc: string): string {
  const time = new Date(`${utc}Z`);
  if (Number.isNaN(time.getTime())) return `${utc} UTC`;
  return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "short", timeStyle: "short" }).format(time);
}

/** 서버의 첫 문장 추출 규칙을 따라 {@link PublishSheet}에 자동 요약을 미리 보여 준다. */
function summaryFromBody(body: string): string {
  let fenced = false; let math = false;
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("```")) { fenced = !fenced; continue; }
    if (line === "$$") { math = !math; continue; }
    if (fenced || math || !line || line.startsWith("#") || line.startsWith(">") || line.startsWith("-") ||
      line.startsWith("*") || line.startsWith("+ ") || line.startsWith("![") || line.startsWith("|") ||
      line.startsWith("<") || line.startsWith("[") || /^\d+\..*/.test(line)) continue;
    const value = stripInlineAnnotations(line).replace(/!\[[^\]]*\](?:\([^)]*\))?/g, "")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/\[\[([^|\]]+)(?:\|([^\]]+))?\]\]/g, (_, title: string, label?: string) => label || title)
      .replace(/[\*`_]/g, "").replace(/\s+/g, " ").trim();
    if (value) return Array.from(value).slice(0, 110).join("");
  }
  return "";
}

/** 응답이 없는 새 글의 모든 저장 필드를 명시적으로 초기화한다. */
function blankForm(title = "", section: DraftSection = "TECH", projectId: number | null = null, courseId: number | null = null): Form {
  const projectMetadata: ProjectMetadata | null = section === "PROJECT_HOME" ? {
    status: "DEV", startPeriod: "", endPeriod: null, overview: "", visibility: "PUBLIC", baseProjectUpdatedAt: null,
    stackBadgeNames: [],
  } : null;
  const homeTemplate = "**역할** [역할] · **인원** [인원]\n\n## 배경\n\n[배경과 목표]\n\n## 문제 → 해결 → 결과\n\n- **문제** — \n- **해결** — \n- **결과** — \n\n## 핵심 기능\n\n1. **[기능]** — [설명]\n\n## 구조\n\n```mermaid\nflowchart LR\n  A[클라이언트] --> B[API 서버]\n  B --> C[(DB)]\n```\n\n## 내가 한 일\n\n- \n\n## 배운 점 · 다음 단계\n\n- ";
  return { title, categoryId: null, tags: [], visibility: "PUBLIC", section, projectId, courseId,
    relatedProjectId: null, documentOrder: null, chapterOrder: null, techSeriesOrder: null, summary: "", projectMetadata,
    document: parseEditorMarkdown(section === "PROJECT_HOME" ? homeTemplate : "") };
}

/** 기존 원문을 아직 서버에 저장하지 않은 편집본의 초기 값으로 읽는다. */
function formFromPost(post: AdminPost): Form {
  return { title: post.title, categoryId: post.category?.id ?? null,
    tags: [...post.tags], visibility: post.visibility, section: post.section, projectId: post.projectId,
    relatedProjectId: post.relatedProjectId, documentOrder: post.documentOrder, courseId: post.courseId,
    chapterOrder: post.chapterOrder, techSeriesOrder: post.techSeriesOrder, summary: post.summary,
    projectMetadata: post.projectMetadata, document: parseEditorMarkdown(post.body) };
}

/** 편집본 원문을 원문 보존 블록으로 열고 revision은 별도로 추적한다. */
function formFromDraft(draft: DraftDetail): Form {
  return { title: draft.title, categoryId: draft.categoryId, tags: [...draft.tags],
    visibility: draft.visibility, section: draft.section, projectId: draft.projectId,
    relatedProjectId: draft.relatedProjectId, documentOrder: draft.documentOrder, courseId: draft.courseId,
    chapterOrder: draft.chapterOrder, techSeriesOrder: draft.techSeriesOrder, summary: draft.summary,
    projectMetadata: draft.projectMetadata, document: parseEditorMarkdown(draft.body) };
}

/** 서버 트리를 깊이별 레이블을 포함한 분류 선택 목록으로 펼친다. */
function categoryOptions(nodes: CategoryNode[], ancestors: string[] = []): Array<{ id: number; label: string; depth: number; count: number }> {
  return nodes.flatMap((node) => {
    const labels = [...ancestors, node.name];
    return [{ id: node.id, label: labels.join(" › "), depth: node.depth, count: node.totalCount },
      ...categoryOptions(node.children, labels)];
  });
}

/** 관리자 과목 상세의 비공개·비출간 회차까지 포함해 다음 순서를 구한다. */
function nextChapterOrder(detail: unknown): number | null {
  if (!detail || typeof detail !== "object" || !("chapters" in detail) || !Array.isArray(detail.chapters)) return null;
  return detail.chapters.reduce((max: number, value: unknown) => {
    if (!value || typeof value !== "object" || !("order" in value) ||
        !Number.isSafeInteger(value.order) || (value.order as number) < 1) return max;
    return Math.max(max, value.order as number);
  }, 0) + 1;
}

/** 저장 실패는 현재 원고를 유지하고 재시도 가능한 설명으로만 변환한다. */
function writeError(error: unknown): string {
  if (error instanceof Error && error.message === "attachment-limit") return "본문 이미지는 최대 100개까지 연결할 수 있습니다. 이미지를 줄인 뒤 다시 저장해 주세요.";
  if (error instanceof ApiFailure && error.status === 409) return "다른 수정과 충돌했습니다. 현재 입력은 유지됩니다. 다른 탭의 편집본 또는 원문을 확인한 뒤 다시 조회해 주세요.";
  if (error instanceof ApiFailure && error.status === 400) return "제목·본문·태그의 형식과 길이를 확인해 주세요. 현재 입력은 유지됩니다.";
  if (error instanceof ApiFailure && error.status === 404) return "편집본·원본 글 또는 선택한 분류를 찾을 수 없습니다. 현재 입력은 유지됩니다.";
  if (error instanceof ApiFailure && error.status === 403) return "권한 또는 CSRF 확인에 실패했습니다. 원고는 유지됩니다. 다시 시도해 주세요.";
  return `${apiFailureMessage(error)} 현재 입력은 유지됩니다.`;
}

/** 세션 세대 하나에 속한 관리자 원고, 수동 저장 revision, 출간을 관리한다. */
function WriteInstance({ route }: { route: Route }) {
  const auth = useAuth();
  const router = useRouter();
  const routeKey = route.kind === "new" ? route.section === "PROJECT_HOME" ? "new:project-home" :
    route.section === "PROJECT_DOC" ? `new:project-doc:${route.projectId}` :
      route.section === "NOTE_CHAPTER" ? `new:notes:${route.courseId}` : route.title ? `new:${route.title}` : "new" :
    route.kind === "invalid" ? "invalid" : `${route.kind}:${route.id}`;
  const loadedRoute = useRef<string | null>(null);
  const loadedAuthEpoch = useRef<number | null>(null);
  const controllers = useRef(new Set<AbortController>());
  const writeGeneration = useRef(0);
  const busyLock = useRef(false);
  const uploadLock = useRef(false);
  const projectLoadingLock = useRef(false);
  const uploadController = useRef<AbortController | null>(null);
  const allowRouteSwitch = useRef(false);
  const draftId = useRef<number | null>(null);
  const revision = useRef<number | null>(null);
  const original = useRef<{ postId: number | null; baseUpdatedAt: string | null }>({ postId: null, baseUpdatedAt: null });
  const versionRef = useRef(0);
  const [form, setForm] = useState<Form>(blankForm);
  const formRef = useRef<Form>(form);
  const [version, setVersion] = useState(0);
  const [savedVersion, setSavedVersion] = useState(0);
  const [screen, setScreen] = useState<Screen>("loading");
  const [existing, setExisting] = useState<DraftSummary | null>(null);
  const [categories, setCategories] = useState<CategoryNode[]>([]);
  const [knownTags, setKnownTags] = useState<TagCount[]>([]);
  const [projects, setProjects] = useState<AdminProject[]>([]);
  const [courses, setCourses] = useState<CourseSummary[]>([]);
  const [projectPage, setProjectPage] = useState(0);
  const [projectPages, setProjectPages] = useState(0);
  const [projectLoading, setProjectLoading] = useState(false);
  const [projectError, setProjectError] = useState("");
  const [projectName, setProjectName] = useState("");
  const [projectSlug, setProjectSlug] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [message, setMessage] = useState("");
  const [savedAt, setSavedAt] = useState("");
  const [busy, setBusy] = useState<"save" | "publish" | null>(null);
  const [uploading, setUploading] = useState(false);
  const [showPublish, setShowPublish] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showWikiPicker, setShowWikiPicker] = useState(false);
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  const [categoryCreating, setCategoryCreating] = useState(false);
  const [tagFocused, setTagFocused] = useState(false);
  const [retry, setRetry] = useState(0);
  const [focusFirstSignal, setFocusFirstSignal] = useState(0);
  const dirty = screen === "ready" && version !== savedVersion;
  const dirtyRef = useRef(dirty);
  const editorRef = useRef<BlockEditorHandle | null>(null);
  const categoryTriggerRef = useRef<HTMLButtonElement | null>(null);
  const deferredDocument = useDeferredValue(form.document);
  const annotationModel = useMemo(() => buildEditorAnnotationModel(deferredDocument), [deferredDocument]);
  const lastCompletedAnnotations = useRef<{ routeKey: string; authEpoch: number; model: EditorAnnotationModel } | null>(null);
  const annotationRouteReady = screen === "ready" && loadedRoute.current === routeKey &&
    loadedAuthEpoch.current === auth.epoch && auth.status === "authenticated" && auth.user?.role === "ADMIN";
  const currentAnnotationModel = annotationRouteReady && deferredDocument === form.document ? annotationModel : null;
  const previousAnnotationModel = lastCompletedAnnotations.current;
  const annotationPreview = annotationRouteReady ? currentAnnotationModel ??
    (previousAnnotationModel?.routeKey === routeKey && previousAnnotationModel.authEpoch === auth.epoch ?
      matchingEditorAnnotationModel(form.document, previousAnnotationModel.model) : null) : null;
  const annotationItems = annotationPreview?.items ?? [];
  const annotationIdentity = `${auth.epoch}:${routeKey}:${screen}:${version}:${currentAnnotationModel ? "ready" : "updating"}`;
  dirtyRef.current = dirty;

  /** {@link buildEditorAnnotationModel}의 마지막 완료 모형을 다음 입력 전에 보관한다. */
  useLayoutEffect(() => {
    if (annotationRouteReady && currentAnnotationModel)
      lastCompletedAnnotations.current = { routeKey, authEpoch: auth.epoch, model: currentAnnotationModel };
  }, [annotationRouteReady, currentAnnotationModel, routeKey, auth.epoch]);

  /** 로드와 쓰기 요청을 세션 인스턴스가 사라질 때 모두 취소한다. */
  useEffect(() => () => {
    writeGeneration.current += 1;
    controllers.current.forEach((controller) => controller.abort()); controllers.current.clear();
  }, []);

  /** 현재 주소·요청 세대에 속한 쓰기 응답만 원고 식별자와 화면을 변경할 수 있다. */
  function assertCurrentWrite(signal: AbortSignal, generation: number) {
    if (signal.aborted || generation !== writeGeneration.current) throw new DOMException("요청이 취소되었습니다", "AbortError");
  }

  /** ADMIN 확인 후 편집본·원본 또는 새 글과 관리자 taxonomy를 같은 세션에서 읽는다. */
  useEffect(() => {
    if (auth.status !== "authenticated" || auth.user?.role !== "ADMIN" ||
      loadedRoute.current === routeKey && loadedAuthEpoch.current === auth.epoch) return;
    if (loadedRoute.current !== null && loadedAuthEpoch.current === auth.epoch &&
      dirtyRef.current && !allowRouteSwitch.current) {
      setMessage("저장하지 않은 원고를 유지하고 원래 편집 주소로 돌아왔습니다.");
      router.replace(routeHref(loadedRoute.current), { scroll: false });
      return;
    }
    if (route.kind === "invalid") {
      loadedAuthEpoch.current = null;
      writeGeneration.current += 1;
      controllers.current.forEach((pending) => pending.abort()); controllers.current.clear();
      busyLock.current = false; setBusy(null); setShowPublish(false); setShowCategoryPicker(false); setCategoryCreating(false); setShowHelp(false);
      projectLoadingLock.current = false; setProjectLoading(false); setProjectError("");
      uploadLock.current = false; setUploading(false);
      uploadController.current = null;
      loadedRoute.current = routeKey;
      const cleared = blankForm(); formRef.current = cleared; setForm(cleared);
      draftId.current = null; revision.current = null; original.current = { postId: null, baseUpdatedAt: null };
      versionRef.current = 0; setVersion(0); setSavedVersion(0);
      return;
    }
    allowRouteSwitch.current = false;
    loadedAuthEpoch.current = null;
    writeGeneration.current += 1;
    controllers.current.forEach((pending) => pending.abort()); controllers.current.clear();
    busyLock.current = false; setBusy(null); setShowPublish(false); setShowWikiPicker(false);
    setShowCategoryPicker(false); setCategoryCreating(false); setShowHelp(false); setTagFocused(false);
    projectLoadingLock.current = false; setProjectLoading(false); setProjectError("");
    uploadLock.current = false; setUploading(false);
    uploadController.current = null;
    draftId.current = null; revision.current = null;
    original.current = { postId: null, baseUpdatedAt: null };
    const cleared = blankForm(route.kind === "new" ? route.title ?? "" : "",
      route.kind === "new" ? route.section : "TECH", route.kind === "new" ? route.projectId : null,
      route.kind === "new" ? route.courseId : null);
    formRef.current = cleared; setForm(cleared); versionRef.current = 0; setVersion(0); setSavedVersion(0);
    loadedRoute.current = routeKey;
    const controller = new AbortController();
    let loadFinished = false;
    controllers.current.add(controller);
    setScreen("loading"); setMessage(""); setExisting(null);
    void (async () => {
      try {
        const [categoryValue, tagValue, projectValue, courseValue] = await Promise.all([
          auth.adminRead("/api/v1/admin/categories", controller.signal),
          auth.adminRead("/api/v1/admin/tags", controller.signal),
          auth.adminRead("/api/v1/admin/projects?page=0&size=20", controller.signal),
          auth.adminRead("/api/v1/admin/courses?page=0&size=100", controller.signal),
        ]);
        if (controller.signal.aborted) return;
        const nextCategories = parseAdminCategories(categoryValue);
        const nextTags = parseAdminTags(tagValue);
        const projectList = parseAdminProjectPage(projectValue, 0);
        const courseList = parseCoursePage(courseValue);
        let nextForm: Form;
        if (route.kind === "draft") {
          const detail = parseDraftDetail(await auth.adminRead(`/api/v1/admin/editor-drafts/${route.id}`, controller.signal));
          if (controller.signal.aborted) return;
          draftId.current = detail.id; revision.current = detail.revision;
          original.current = { postId: detail.postId, baseUpdatedAt: detail.baseUpdatedAt };
          nextForm = formFromDraft(detail); setSavedAt(detail.updatedAt);
        } else if (route.kind === "post") {
          const page = parseDraftPage(await auth.adminRead(`/api/v1/admin/editor-drafts?postId=${route.id}&page=0&size=10`, controller.signal));
          if (controller.signal.aborted) return;
          if (page.items.length) {
            if (!controller.signal.aborted) { loadFinished = true; setCategories(nextCategories); setKnownTags(nextTags); setExisting(page.items[0]); setScreen("existing"); }
            return;
          }
          const post = parseAdminPost(await auth.adminRead(`/api/v1/admin/posts/${route.id}`, controller.signal));
          if (controller.signal.aborted) return;
          draftId.current = null; revision.current = null;
          original.current = { postId: post.id, baseUpdatedAt: post.updatedAt };
          nextForm = formFromPost(post); setSavedAt("");
        } else {
          draftId.current = null; revision.current = null;
          original.current = { postId: null, baseUpdatedAt: null };
          nextForm = blankForm(route.kind === "new" ? route.title ?? "" : "",
            route.kind === "new" ? route.section : "TECH", route.kind === "new" ? route.projectId : null,
            route.kind === "new" ? route.courseId : null);
          if (route.kind === "new" && route.section === "NOTE_CHAPTER" && route.courseId !== null) {
            // 관리자 상세에는 비공개·비출간 회차도 포함되므로 표시 개수 대신 실제 마지막 순서를 쓴다.
            const detail = await auth.adminRead(`/api/v1/admin/courses/${route.courseId}`, controller.signal);
            if (controller.signal.aborted) return;
            nextForm.chapterOrder = nextChapterOrder(detail);
          }
          setSavedAt("");
        }
        let parent = nextForm.projectId === null ? null : projectList.items.find((item) => item.id === nextForm.projectId) ?? null;
        if (nextForm.projectId !== null && !parent) {
          const detail = await auth.adminRead(`/api/v1/admin/projects/${nextForm.projectId}`, controller.signal);
          if (!detail || typeof detail !== "object" || Array.isArray(detail) || !("project" in detail))
            throw new ApiFailure("response");
          parent = parseAdminProject(detail.project);
        }
        let relatedProject = nextForm.relatedProjectId === null ? null :
          projectList.items.find((item) => item.id === nextForm.relatedProjectId) ?? null;
        if (nextForm.relatedProjectId !== null && !relatedProject) {
          const detail = await auth.adminRead(`/api/v1/admin/projects/${nextForm.relatedProjectId}`, controller.signal);
          if (!detail || typeof detail !== "object" || Array.isArray(detail) || !("project" in detail))
            throw new ApiFailure("response");
          relatedProject = parseAdminProject(detail.project);
        }
        if (controller.signal.aborted) return;
        formRef.current = nextForm; setForm(nextForm); versionRef.current = 0; setVersion(0); setSavedVersion(0);
        setCategories(nextCategories); setKnownTags(nextTags);
        setProjects(relatedProject && !projectList.items.some((item) => item.id === relatedProject.id) ?
          [...projectList.items, relatedProject] : projectList.items);
        setCourses(courseList.items);
        setProjectPage(0); setProjectPages(projectList.totalPages);
        setProjectName(parent?.name ?? ""); setProjectSlug(parent?.slug ?? "");
        loadedAuthEpoch.current = auth.epoch; loadFinished = true; setScreen("ready");
      } catch (error) {
        if (!controller.signal.aborted) { loadFinished = true; setMessage(apiFailureMessage(error)); setScreen("error"); }
      } finally { controllers.current.delete(controller); }
    })();
    return () => { controller.abort(); controllers.current.delete(controller);
      if (!loadFinished && loadedRoute.current === routeKey) { loadedRoute.current = null; loadedAuthEpoch.current = null; } };
  }, [auth.adminRead, auth.epoch, auth.status, auth.user?.role, route.kind, routeKey, retry, router]);

  /** 원고의 새 값을 즉시 ref에도 반영해 저장 클릭 직전 입력을 빠뜨리지 않는다. */
  const changeForm = useCallback((change: (current: Form) => Form) => {
    const next = change(formRef.current);
    formRef.current = next; setForm(next);
    versionRef.current += 1; setVersion(versionRef.current);
    setMessage("");
  }, []);

  /** 한 파일의 READY 응답만 현재 원고에 돌려주고 전환·취소된 업로드를 버린다. */
  async function uploadImage(file: File): Promise<ImageData | null> {
    if (uploadLock.current || busyLock.current) { setMessage("진행 중인 작업을 마친 뒤 이미지를 다시 선택해 주세요."); return null; }
    if ((file.type !== "image/jpeg" && file.type !== "image/png") || file.size === 0 || file.size > 10 * 1024 * 1024) {
      setMessage("JPEG 또는 PNG 이미지 한 파일을 10MiB 이하로 선택해 주세요."); return null;
    }
    uploadLock.current = true; setUploading(true); setMessage("이미지를 업로드하고 있습니다. 원고 저장과 출간은 완료 후 가능합니다.");
    const generation = writeGeneration.current;
    const controller = new AbortController(); controllers.current.add(controller);
    uploadController.current = controller;
    try {
      const uploaded = await auth.adminUpload(file, controller.signal);
      assertCurrentWrite(controller.signal, generation);
      setMessage("이미지를 본문에 넣었습니다. 저장하면 이 글의 읽기 권한과 연결됩니다.");
      return { attachmentId: uploaded.id, caption: "", width: 100, align: "center" };
    } catch (error) {
      if (!controller.signal.aborted && generation === writeGeneration.current) setMessage(
        error instanceof ApiFailure && error.status === 503 ? "이미지 저장소 또는 API 연결이 일시적으로 불가능합니다. 파일을 다시 선택해 주세요." : writeError(error));
      return null;
    } finally {
      controllers.current.delete(controller);
      if (uploadController.current === controller) uploadController.current = null;
      if (generation === writeGeneration.current) { uploadLock.current = false; setUploading(false); }
    }
  }

  /** 브라우저 이탈과 앱 내부 링크 이동에서 미저장 원고 손실을 확인한다. */
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    const click = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement) || anchor.target === "_blank" || event.ctrlKey || event.metaKey) return;
      if (!window.confirm("저장하지 않은 변경이 있습니다. 페이지를 떠나시겠습니까?")) event.preventDefault();
      else allowRouteSwitch.current = true;
    };
    const navigation = (window as Window & { navigation?: EventTarget }).navigation;
    const navigate = (event: Event) => {
      const attempt = event as Event & { navigationType?: string; canIntercept?: boolean; destination?: { url: string } };
      if (attempt.navigationType !== "traverse" || !attempt.canIntercept || !attempt.cancelable ||
        !attempt.destination || attempt.destination.url === window.location.href) return;
      if (!window.confirm("저장하지 않은 변경이 있습니다. 이전 화면으로 이동하시겠습니까?")) event.preventDefault();
      else allowRouteSwitch.current = true;
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", click, true);
    navigation?.addEventListener("navigate", navigate);
    return () => { window.removeEventListener("beforeunload", beforeUnload); document.removeEventListener("click", click, true);
      navigation?.removeEventListener("navigate", navigate); };
  }, [dirty]);

  /** 편집본을 만들거나 현재 revision 조건으로 전체 필드를 교체한다. */
  async function persist(signal: AbortSignal, generation: number): Promise<{ id: number; revision: number; sentVersion: number }> {
    const snapshot = formRef.current;
    const sentVersion = versionRef.current;
    const body = serializeEditorMarkdown(snapshot.document);
    const attachmentIds = collectAttachmentIds(body);
    if (attachmentIds.length > 100) throw new Error("attachment-limit");
    const wikiTargets = collectWikiTargets(body);
    const values = draftValues({ title: snapshot.title,
      body, attachmentIds, wikiTargets, categoryId: snapshot.categoryId,
      tags: snapshot.tags, visibility: snapshot.visibility, section: snapshot.section,
      projectId: snapshot.projectId, courseId: snapshot.courseId, relatedProjectId: snapshot.relatedProjectId,
      documentOrder: snapshot.documentOrder, chapterOrder: snapshot.chapterOrder,
      summary: snapshot.summary, projectMetadata: snapshot.projectMetadata,
      techSeriesOrder: snapshot.section === "TECH" && categoryOptions(categories).find((item) => item.id === snapshot.categoryId)?.depth === 3 ?
        snapshot.techSeriesOrder : null });
    const currentId = draftId.current;
    const response = currentId === null ? await auth.adminWrite("POST", "/api/v1/admin/editor-drafts",
      { postId: original.current.postId, baseUpdatedAt: original.current.baseUpdatedAt, ...values }, signal) :
      await auth.adminWrite("PUT", `/api/v1/admin/editor-drafts/${currentId}`,
        { revision: revision.current, ...values }, signal);
    assertCurrentWrite(signal, generation);
    const saved = parseDraftDetail(response);
    draftId.current = saved.id; revision.current = saved.revision; original.current = { postId: saved.postId, baseUpdatedAt: saved.baseUpdatedAt };
    setSavedVersion(sentVersion); setSavedAt(saved.updatedAt);
    if (currentId === null) {
      const nextRoute = `draft:${saved.id}`;
      loadedRoute.current = nextRoute;
      router.replace(`/write/?draftId=${saved.id}`, { scroll: false });
    }
    return { id: saved.id, revision: saved.revision, sentVersion };
  }

  /** 저장 버튼을 한 번만 실행하고 늦은 수정은 편집 상태로 남긴다. */
  async function save() {
    if (uploadLock.current) { setMessage("이미지 업로드가 끝난 뒤 저장해 주세요. 원고는 유지됩니다."); return; }
    if (busyLock.current) return;
    busyLock.current = true; setBusy("save"); setMessage("");
    const generation = writeGeneration.current;
    const controller = new AbortController(); controllers.current.add(controller);
    try {
      const saved = await persist(controller.signal, generation);
      assertCurrentWrite(controller.signal, generation);
      setMessage(saved.sentVersion === versionRef.current ? "편집본을 저장했습니다." :
        "요청 시점의 원고를 저장했습니다. 저장 중 추가한 내용은 아직 저장되지 않았습니다.");
    }
    catch (error) { if (!controller.signal.aborted && generation === writeGeneration.current) setMessage(writeError(error)); }
    finally { controllers.current.delete(controller); if (generation === writeGeneration.current) { busyLock.current = false; setBusy(null); } }
  }

  /** 최신 저장 revision을 확보한 후에만 원자적 출간을 요청한다. */
  async function publish() {
    if (uploadLock.current) { setMessage("이미지 업로드가 끝난 뒤 출간해 주세요. 원고는 유지됩니다."); return; }
    if (busyLock.current) return;
    const snapshot = formRef.current;
    if (!snapshot.title.trim() || [...snapshot.title].length > 200 ||
      new TextEncoder().encode(serializeEditorMarkdown(snapshot.document)).length > 1024 * 1024) {
      setMessage("출간하려면 제목·본문 크기를 확인해 주세요."); setShowPublish(false); return;
    }
    busyLock.current = true; setBusy("publish"); setMessage("");
    const generation = writeGeneration.current;
    const controller = new AbortController(); controllers.current.add(controller);
    try {
      const saved = draftId.current === null || versionRef.current !== savedVersion ?
        await persist(controller.signal, generation) : { id: draftId.current, revision: revision.current, sentVersion: versionRef.current };
      assertCurrentWrite(controller.signal, generation);
      if (saved.id === null || saved.revision === null) throw new ApiFailure("response");
      if (saved.sentVersion !== versionRef.current) {
        setMessage("저장 중 추가로 입력한 내용이 있습니다. 다시 출간해 주세요."); return;
      }
      const response = await auth.adminWrite("POST", `/api/v1/admin/editor-drafts/${saved.id}/publish`,
        { revision: saved.revision }, controller.signal);
      assertCurrentWrite(controller.signal, generation);
      if (!response || typeof response !== "object" || typeof (response as { slug?: unknown }).slug !== "string") throw new ApiFailure("response");
      setShowPublish(false);
      const published = response as { slug: string; projectSlug?: string | null; courseSlug?: string | null };
      router.replace(snapshot.section === "PROJECT_HOME" ? `/project/?slug=${encodeURIComponent(published.projectSlug ?? published.slug)}` :
        snapshot.section === "PROJECT_DOC" ? `/project/?slug=${encodeURIComponent(published.projectSlug ?? projectSlug)}&doc=${encodeURIComponent(published.slug)}` :
          snapshot.section === "NOTE_CHAPTER" ? `/course/?slug=${encodeURIComponent(published.courseSlug ?? courses.find((item) => item.id === snapshot.courseId)?.slug ?? "")}&chapter=${encodeURIComponent(published.slug)}` :
            `/post/?slug=${encodeURIComponent(published.slug)}`);
    } catch (error) { if (!controller.signal.aborted && generation === writeGeneration.current) setMessage(writeError(error)); }
    finally { controllers.current.delete(controller); if (generation === writeGeneration.current) { busyLock.current = false; setBusy(null); } }
  }

  /** 기존 태그 집계와 입력을 비교해 유효한 새 태그만 추가한다. */
  function addTag() {
    const name = tagInput.trim().replace(/^#/, "");
    const exists = form.tags.some((tag) => tag.toLocaleLowerCase() === name.toLocaleLowerCase());
    if (!name || [...name].length > 40 || /[\u0000-\u001f\u007f]/.test(name)) {
      setMessage("태그는 제어 문자 없이 1~40자로 입력해 주세요."); return;
    }
    if (!exists && form.tags.length >= 16) { setMessage("태그는 최대 16개입니다."); return; }
    if (!exists) changeForm((current) => ({ ...current, tags: [...current.tags, name] }));
    setTagInput("");
  }

  /** 출간 시트에서 과목을 바꿀 때 새 과목의 마지막 회차 뒤를 제안한다. */
  async function selectCourse(id: number | null) {
    changeForm((current) => ({ ...current, courseId: id, chapterOrder: null }));
    if (id === null) return;
    try {
      const detail = await auth.adminRead(`/api/v1/admin/courses/${id}`);
      const next = nextChapterOrder(detail);
      if (next !== null) changeForm((current) => current.courseId === id && current.chapterOrder === null ?
        { ...current, chapterOrder: next } : current);
    } catch (error) { setMessage(apiFailureMessage(error)); }
  }

  /** {@link parseAdminProjectPage}의 다음 페이지를 읽어 관련 프로젝트 선택지를 빠짐없이 채운다. */
  async function fetchMoreProjects() {
    const nextPage = projectPage + 1;
    if (projectLoadingLock.current || nextPage >= projectPages) return;
    const generation = writeGeneration.current;
    const controller = new AbortController(); controllers.current.add(controller);
    projectLoadingLock.current = true; setProjectLoading(true); setProjectError("");
    try {
      const page = parseAdminProjectPage(await auth.adminRead(
        `/api/v1/admin/projects?page=${nextPage}&size=20`, controller.signal), nextPage);
      if (controller.signal.aborted || generation !== writeGeneration.current) return;
      setProjects((current) => {
        const known = new Set(current.map((project) => project.id));
        return [...current, ...page.items.filter((project) => !known.has(project.id))];
      });
      setProjectPage(nextPage); setProjectPages(page.totalPages);
    } catch (error) {
      if (!controller.signal.aborted && generation === writeGeneration.current) setProjectError(apiFailureMessage(error));
    } finally {
      controllers.current.delete(controller);
      if (generation === writeGeneration.current) { projectLoadingLock.current = false; setProjectLoading(false); }
    }
  }

  /** 글쓰기 분류 선택기에서 서버가 반환한 ID로 새 분류를 확인하고 선택한다. */
  async function createCategory(parent: CategoryNode | null, name: string): Promise<number | null> {
    if (busyLock.current) return null;
    const path = parent ? `${parent.path}/${name}` : name;
    try {
      const response = await auth.adminWrite("POST", "/api/v1/admin/categories", { path });
      if (!response || typeof response !== "object" || Array.isArray(response) || !("id" in response) ||
        !Number.isSafeInteger(response.id) || (response.id as number) < 1) throw new ApiFailure("response");
      const id = response.id as number;
      const next = parseAdminCategories(await auth.adminRead("/api/v1/admin/categories"));
      const created = categoryOptions(next).find((option) => option.id === id);
      if (!created) throw new ApiFailure("response");
      setCategories(next);
      changeForm((current) => ({ ...current, categoryId: id,
        techSeriesOrder: current.section === "TECH" && created.depth === 3 && original.current.postId === null ?
          created.count + 1 : null }));
      return id;
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 409) throw new Error("같은 이름의 분류가 이미 있습니다.");
      if (error instanceof ApiFailure && error.status === 400) throw new Error("분류 이름과 깊이를 확인해 주세요.");
      throw new Error(apiFailureMessage(error));
    }
  }

  if (auth.status === "checking") return <main id="main-content" className="write-page" role="status">관리자 세션을 확인하고 있습니다…</main>;
  if (auth.status === "error") return <main id="main-content" className="write-page"><h1>관리자 세션을 확인하지 못했습니다</h1>
    <p role="alert">API 설정이나 연결을 확인해 주세요.</p><button type="button" className="small-button" onClick={() => void auth.refresh()}>다시 시도</button></main>;
  if (auth.status !== "authenticated" || auth.user?.role !== "ADMIN") return <main id="main-content" className="write-page">
    <h1>관리자 글쓰기</h1>{auth.status === "guest" ? <p>글을 쓰려면 관리자 로그인이 필요합니다. <Link
      href={`/login/?returnTo=${encodeURIComponent(routeHref(routeKey))}`}>로그인</Link></p> :
      <p>이 계정은 글쓰기 권한이 없습니다.</p>}</main>;
  if (route.kind === "invalid") return <main id="main-content" className="write-page"><h1>글쓰기 주소를 확인해 주세요</h1>
    <p>postId·draftId 또는 유효한 title 하나만 지정할 수 있습니다.</p><Link href="/admin/drafts/">편집본 목록</Link></main>;
  if (screen === "loading") return <main id="main-content" className="write-page" role="status">원고를 불러오고 있습니다…</main>;
  if (screen === "error") return <main id="main-content" className="write-page"><h1>원고를 열지 못했습니다</h1>
    <p role="alert">{message}</p><button type="button" className="small-button" onClick={() => { loadedRoute.current = null; setRetry((n) => n + 1); }}>다시 시도</button></main>;
  if (screen === "existing" && existing) return <main id="main-content" className="write-page"><h1>이미 편집 중인 글입니다</h1>
    <p>이 글의 편집본이 있습니다. 현재 편집본을 이어서 열어 주세요.</p>
    <Link className="primary-button" href={`/write/?draftId=${existing.id}`}>편집본 이어쓰기</Link></main>;

  const options = categoryOptions(categories);
  const selectedCategory = options.find((item) => item.id === form.categoryId);
  const sectionLocked = draftId.current !== null || original.current.postId !== null;
  const actionLabel = form.section === "PROJECT_HOME" ? original.current.postId === null ? "프로젝트 만들기" : "저장" :
    original.current.postId === null ? "출간하기" : "수정하기";
  const suggestedTags = knownTags.filter((item) => !form.tags.some((tag) => tag.toLocaleLowerCase() === item.name.toLocaleLowerCase()) &&
    (!tagInput.trim() || item.name.toLowerCase().includes(tagInput.trim().toLowerCase()))).slice(0, 4);
  return <main id="main-content" className="write-page editor-design-page">
    <div className="write-surface">
    <div className="write-top"><Link href="/admin/drafts/" className="back-link">← 나가기</Link></div>
    <h1 className="sr-only">글쓰기</h1>
    <label className="sr-only" htmlFor="write-title">글 제목</label>
    <input id="write-title" className="write-title" value={form.title} placeholder="제목 없음"
      onChange={(event) => changeForm((current) => ({ ...current, title: event.target.value }))} disabled={busy === "publish"}
      onKeyDown={(event) => { if ((event.key === "Enter" || event.key === "ArrowDown") &&
        !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); setFocusFirstSignal((n) => n + 1); } }} />
    {form.section !== "TECH" && <div className={`write-kind editor-kind-line${form.section === "PROJECT_HOME" ? " editor-kind-home" : ""}`}>
      <strong>{form.section === "PROJECT_HOME" || form.section === "PROJECT_DOC" ? "Projects" : "Notes"}</strong>
      <span>·</span><span>{form.section === "PROJECT_HOME" ? "프로젝트 대문" : form.section === "PROJECT_DOC" ? projectName || "프로젝트 문서" :
        courses.find((course) => course.id === form.courseId)?.name ?? "과목"}</span>
      {form.section !== "PROJECT_HOME" && <><span>·</span><span>{form.section === "PROJECT_DOC" ? `문서 ${form.documentOrder ?? 1}` : `${form.chapterOrder ?? 1}강`}</span></>}
      <small>{form.section === "PROJECT_HOME" ? "제목이 곧 프로젝트 이름입니다" : "출간할 때 순서를 바꿀 수 있어요"}</small>
    </div>}
    {form.section === "PROJECT_HOME" && form.projectMetadata && <div className="write-project-fields">
      <span className="editor-project-label">상태</span><div className="editor-project-status" role="radiogroup" aria-label="상태">
        {([["PLAN", "기획 중"], ["DEV", "개발 중"], ["MAINT", "유지보수 중"], ["DONE", "완료"]] as const).map(([status, label]) =>
          <button type="button" key={status} role="radio" aria-checked={form.projectMetadata?.status === status}
            className={form.projectMetadata?.status === status ? "selected" : ""}
            onClick={() => changeForm((current) => ({ ...current, projectMetadata: current.projectMetadata &&
              { ...current.projectMetadata, status } }))}><span className={`dot ${status.toLowerCase()}`} />{label}</button>)}
      </div>
      <label htmlFor="write-start-period">기간</label><div className="write-period"><input id="write-start-period" placeholder="YYYY.MM" value={form.projectMetadata.startPeriod}
        onChange={(event) => changeForm((current) => ({ ...current, projectMetadata: current.projectMetadata &&
          { ...current.projectMetadata, startPeriod: event.target.value } }))} />
        <span>–</span><input aria-label="종료 기간" placeholder="현재" value={form.projectMetadata.endPeriod ?? ""}
          onChange={(event) => changeForm((current) => ({ ...current, projectMetadata: current.projectMetadata &&
            { ...current.projectMetadata, endPeriod: event.target.value || null } }))} /></div>
      <label htmlFor="write-overview">개요</label><textarea id="write-overview" maxLength={500} rows={2} value={form.projectMetadata.overview}
        onChange={(event) => changeForm((current) => ({ ...current, projectMetadata: current.projectMetadata &&
          { ...current.projectMetadata, overview: event.target.value } }))} />
      <label htmlFor="write-stack">기술 스택</label><StackBadgePicker value={form.projectMetadata.stackBadgeNames}
        onChange={(names) => changeForm((current) => ({ ...current, projectMetadata: current.projectMetadata &&
          { ...current.projectMetadata, stackBadgeNames: names } }))} disabled={busy !== null} />
    </div>}
    {(form.section === "TECH" || form.section === "PROJECT_DOC") && <>
      <div className="write-tags"><div className="write-tag-chips">{form.tags.map((tag) =>
        <button key={tag} type="button" disabled={busy === "publish"} aria-label={`${tag} 태그 제거`}
          onClick={() => changeForm((current) => ({ ...current, tags: current.tags.filter((item) => item !== tag) }))}>#{tag} ×</button>)}</div>
        <div className="editor-tag-input-wrap"><label className="sr-only" htmlFor="write-tag">태그 추가</label>
          <input id="write-tag" value={tagInput} placeholder="태그 입력 후 Enter" autoComplete="off"
            disabled={busy === "publish"} onChange={(event) => setTagInput(event.target.value)}
            onFocus={() => setTagFocused(true)} onBlur={() => window.setTimeout(() => setTagFocused(false), 120)}
            onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); addTag(); } }} />
          {tagFocused && (suggestedTags.length > 0 || tagInput.trim()) && <div className="editor-tag-suggestions">
            {suggestedTags.map((item) => <button type="button" key={item.name} onMouseDown={(event) => event.preventDefault()}
              onClick={() => { setTagInput(""); if (!form.tags.some((tag) => tag.toLocaleLowerCase() === item.name.toLocaleLowerCase()))
                changeForm((current) => ({ ...current, tags: [...current.tags, item.name] })); }}>
              <span>#{item.name}</span><small>{item.count}</small></button>)}
            {tagInput.trim() && !knownTags.some((item) => item.name.toLocaleLowerCase() === tagInput.trim().toLocaleLowerCase()) &&
              <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={addTag}>"{tagInput.trim()}" 새 태그로 추가</button>}
          </div>}
        </div>
      </div>
      <div className="editor-meta-row editor-category-row"><span>분류</span>
        <button ref={categoryTriggerRef} type="button" className="editor-compact-button" disabled={busy === "publish" || categoryCreating}
          aria-expanded={showCategoryPicker} aria-label="분류 고르기" onClick={() => setShowCategoryPicker((open) => !open)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2-2H5a2 2 0 0 1-2-2z" /></svg>
          <span className="editor-category-current">{selectedCategory?.label ?? (form.categoryId ? "삭제된 분류" : "분류 없음")}</span>
          <span aria-hidden="true">⌄</span></button>
        {form.categoryId !== null && <button type="button" className="editor-clear-button" onClick={() => changeForm((current) =>
          ({ ...current, categoryId: null, techSeriesOrder: null }))}>해제</button>}
        {showCategoryPicker && <CategoryPicker nodes={categories} selected={form.categoryId} busy={busy !== null}
          onSelect={(id) => changeForm((current) => {
            const picked = options.find((item) => item.id === id);
            return { ...current, categoryId: id, techSeriesOrder: current.section === "TECH" ?
              picked?.depth === 3 && original.current.postId === null ? picked.count + 1 :
                current.categoryId === id ? current.techSeriesOrder : null : null };
          })}
          onCreate={createCategory} onPendingChange={setCategoryCreating}
          onClose={() => { setShowCategoryPicker(false); categoryTriggerRef.current?.focus(); }} />}
      </div>
      {form.section === "TECH" && <div className="editor-meta-row"><span>프로젝트</span>
        <ProjectPicker projects={projects} selected={form.relatedProjectId} disabled={busy === "publish"}
          hasMore={projectPage + 1 < projectPages} loadingMore={projectLoading} error={projectError}
          onMore={() => { void fetchMoreProjects(); }}
          onSelect={(id) => changeForm((current) => ({ ...current, relatedProjectId: id }))} />
      </div>}
    </>}
    <AnnotationReader mode="editor" identity={annotationIdentity} items={annotationItems}>
      <BlockEditor ref={editorRef} value={form.document} disabled={busy === "publish" || uploading}
        annotationPreview={annotationPreview} annotationSessionKey={`${auth.epoch}:${routeKey}:${screen}`}
        focusFirstSignal={focusFirstSignal} onImageFile={uploadImage} onImageReject={setMessage}
        onChange={(next) => changeForm((current) => ({ ...current, document: next }))} />
    </AnnotationReader>
    {message && <p className="write-message" role="status">{message}</p>}
    </div>
    <div className="write-toolbar">
      <button type="button" className="editor-tool-icon" aria-label="이미지 넣기" title="이미지 넣기" disabled={busy !== null || uploading}
        onClick={() => editorRef.current?.chooseImage()}><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="m21 16-5-5-9 9" /></svg></button>
      <button type="button" className="editor-tool-icon editor-tool-text" aria-label="주석 넣기" title="주석 넣기 [* ]" disabled={busy !== null || uploading}
        onPointerDown={() => editorRef.current?.captureAnnotationSelection()}
        onClick={() => { if (!editorRef.current?.insertAnnotation()) setMessage("글자 조합을 마친 뒤 주석을 삽입해 주세요."); }}>[*]</button>
      <button type="button" className="editor-tool-icon" aria-label="표 넣기" title="표 넣기 (/표)" disabled={busy !== null || uploading}
        onClick={() => editorRef.current?.insertTable()}><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18M3 15h18M9 4v16M15 4v16" /></svg></button>
      <button type="button" className="editor-tool-icon editor-tool-text editor-wiki-tool" aria-label="다른 글 링크" title="다른 글 링크 [[ ]]" disabled={busy !== null || uploading}
        onPointerDown={() => editorRef.current?.captureAnnotationSelection()}
        onClick={() => { setShowWikiPicker((open) => !open); setShowHelp(false); }}>[[ ]]</button>
      <button type="button" className={`editor-tool-icon${showHelp ? " active" : ""}`} aria-label="단축키 도움말" title="단축키" aria-controls="write-help" aria-expanded={showHelp}
        onClick={() => { setShowHelp((open) => !open); setShowWikiPicker(false); }}><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true"><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.7.6 1.2 1.3 1.3 2.1h4.4c.1-.8.6-1.5 1.3-2.1A6 6 0 0 0 12 3z" /></svg></button>
      {showHelp && <ShortcutHelp />}
      {showWikiPicker && <WikiLinkPicker onClose={() => setShowWikiPicker(false)} onInsert={(title) => {
        if (editorRef.current?.insertWikiLink(title)) { setShowWikiPicker(false); setMessage("글 링크를 본문에 넣었습니다."); }
        else setMessage("글자 조합을 마친 뒤 글 링크를 삽입해 주세요.");
      }} />}
      <span className="write-save-state" aria-live="polite">{uploading ? "이미지 업로드 중…" : busy === "save" ? "저장 중…" :
      busy === "publish" ? "출간 중…" : dirty ? "저장하지 않은 변경" : savedAt ? `임시저장됨 · ${savedTime(savedAt)} KST` : ""}</span>
      {uploading && <button type="button" className="small-button" onClick={() => {
        uploadController.current?.abort(); setMessage("이미지 업로드를 취소했습니다. 원고는 유지됩니다.");
      }}>업로드 취소</button>}
      <button type="button" className="editor-save-button" onClick={() => void save()} disabled={busy !== null || uploading || categoryCreating}>임시저장</button>
      <button type="button" className="primary-button" onClick={() => setShowPublish(true)}
        disabled={busy !== null || uploading || categoryCreating}>{actionLabel}</button></div>
    {showPublish && <PublishSheet title={form.title} section={form.section} summary={form.summary}
      summaryPreview={summaryFromBody(serializeEditorMarkdown(form.document))}
      visibility={form.visibility} busy={busy !== null || uploading} sectionLocked={sectionLocked} error={message} actionLabel={actionLabel}
      categoryLabel={selectedCategory?.label ?? "분류 없음"} categoryDepth={selectedCategory?.depth ?? null}
      categoryCount={selectedCategory?.count ?? 0} techSeriesOrder={form.techSeriesOrder}
      relatedProjectId={form.relatedProjectId}
      projectId={form.projectId} courseId={form.courseId} documentOrder={form.documentOrder}
      chapterOrder={form.chapterOrder} projectMetadata={form.projectMetadata}
      projects={projects.map((project) => ({ id: project.id, label: project.name }))}
      courses={courses.map((course) => ({ id: course.id, label: course.name,
        field: course.field, count: course.chapterCount }))}
      onSummary={(summary) => changeForm((current) => ({ ...current, summary }))}
      onVisibility={(visibility) => changeForm((current) => ({ ...current, visibility,
        projectMetadata: current.projectMetadata && { ...current.projectMetadata, visibility } }))}
      onSection={(section) => changeForm((current) => section === "TECH" ? { ...current, section,
        projectId: null, courseId: null, projectMetadata: null, techSeriesOrder: null } : section === "PROJECT_DOC" ? { ...current, section,
          relatedProjectId: null, courseId: null, projectMetadata: null,
          techSeriesOrder: null, projectId: current.projectId ?? projects[0]?.id ?? null,
          documentOrder: current.documentOrder ?? 1 } : {
            ...current, section, categoryId: null, tags: [], relatedProjectId: null, projectId: null,
            projectMetadata: null, techSeriesOrder: null, courseId: current.courseId ?? courses[0]?.id ?? null,
            chapterOrder: current.chapterOrder ?? 1 })}
      onRelatedProject={(id) => changeForm((current) => ({ ...current, relatedProjectId: id }))}
      onProject={(id) => changeForm((current) => ({ ...current, projectId: id }))}
      onCourse={(id) => { void selectCourse(id); }}
      onDocumentOrder={(order) => changeForm((current) => ({ ...current, documentOrder: order }))}
      onChapterOrder={(order) => changeForm((current) => ({ ...current, chapterOrder: order }))}
      onTechSeriesOrder={(order) => changeForm((current) => ({ ...current, techSeriesOrder: order }))}
      onClose={() => setShowPublish(false)} onPublish={() => void publish()} />}
  </main>;
}

/** static export의 단일 글쓰기 경로에서 쿼리와 인증 세대로 원고 수명을 분리한다. */
export function WritePage() {
  const params = useSearchParams();
  const auth = useAuth();
  const route = routeFromParams(params);
  return <WriteInstance key={auth.epoch} route={route} />;
}
