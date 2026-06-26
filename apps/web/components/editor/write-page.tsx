"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiFailure, apiFailureMessage, type CategoryNode, type TagCount } from "@/lib/api";
import { draftValues, parseAdminCategories, parseAdminPost, parseAdminTags, parseDraftDetail, parseDraftPage,
  positiveId, type AdminPost, type DraftDetail, type DraftSummary, type DraftValues } from "@/lib/editor-drafts";
import { parseEditorMarkdown, serializeEditorMarkdown, type MarkdownDocument } from "@/lib/editor-markdown";
import { collectAttachmentIds, type ImageData } from "@/lib/editor-image";
import { useAuth } from "@/components/auth-provider";
import { BlockEditor } from "./block-editor";
import { PublishSheet } from "./publish-sheet";

type Route = { kind: "new" } | { kind: "post" | "draft"; id: number } | { kind: "invalid" };
type Form = Omit<DraftValues, "body" | "attachmentIds"> & { document: MarkdownDocument };
type Screen = "loading" | "ready" | "existing" | "error";

/** 정적 검색 쿼리에서 중복·동시 ID와 안전하지 않은 숫자를 거부한다. */
function routeFromParams(params: URLSearchParams): Route {
  const draft = params.getAll("draftId");
  const post = params.getAll("postId");
  if (draft.length > 1 || post.length > 1 || (draft.length && post.length) ||
    [...params.keys()].some((name) => name !== "draftId" && name !== "postId")) return { kind: "invalid" };
  if (draft.length) { const id = positiveId(draft[0]); return id === null ? { kind: "invalid" } : { kind: "draft", id }; }
  if (post.length) { const id = positiveId(post[0]); return id === null ? { kind: "invalid" } : { kind: "post", id }; }
  return { kind: "new" };
}

/** 화면에 남겨 둔 원고 식별자로 정적 주소를 다시 만든다. */
function routeHref(key: string): string {
  if (key === "new") return "/write/";
  const [kind, id] = key.split(":");
  return `/write/?${kind === "post" ? "postId" : "draftId"}=${id}`;
}

/** Spring의 UTC LocalDateTime을 KST 저장 시각으로 표시한다. */
function savedTime(utc: string): string {
  const time = new Date(`${utc}Z`);
  if (Number.isNaN(time.getTime())) return `${utc} UTC`;
  return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "short", timeStyle: "short" }).format(time);
}

/** 응답이 없는 새 글의 모든 저장 필드를 명시적으로 초기화한다. */
function blankForm(): Form {
  return { title: "", slug: "", categoryId: null, tags: [], visibility: "PUBLIC", document: parseEditorMarkdown("") };
}

/** 기존 원문을 아직 서버에 저장하지 않은 편집본의 초기 값으로 읽는다. */
function formFromPost(post: AdminPost): Form {
  return { title: post.title, slug: post.slug, categoryId: post.category?.id ?? null,
    tags: [...post.tags], visibility: post.visibility, document: parseEditorMarkdown(post.body) };
}

/** 편집본 원문을 원문 보존 블록으로 열고 revision은 별도로 추적한다. */
function formFromDraft(draft: DraftDetail): Form {
  return { title: draft.title, slug: draft.slug, categoryId: draft.categoryId, tags: [...draft.tags],
    visibility: draft.visibility, document: parseEditorMarkdown(draft.body) };
}

/** 서버 트리를 깊이별 레이블을 포함한 분류 선택 목록으로 펼친다. */
function categoryOptions(nodes: CategoryNode[]): Array<{ id: number; label: string }> {
  return nodes.flatMap((node) => [{ id: node.id, label: `${"　".repeat(Math.max(0, node.depth - 1))}${node.path.replaceAll("/", " › ")}` },
    ...categoryOptions(node.children)]);
}

/** 저장 실패는 현재 원고를 유지하고 재시도 가능한 설명으로만 변환한다. */
function writeError(error: unknown): string {
  if (error instanceof Error && error.message === "attachment-limit") return "본문 이미지는 최대 100개까지 연결할 수 있습니다. 이미지를 줄인 뒤 다시 저장해 주세요.";
  if (error instanceof ApiFailure && error.status === 409) return "다른 수정과 충돌했습니다. 현재 입력은 유지됩니다. 다른 탭의 편집본 또는 원문을 확인한 뒤 다시 조회해 주세요.";
  if (error instanceof ApiFailure && error.status === 400) return "제목·주소·본문·태그의 형식과 길이를 확인해 주세요. 현재 입력은 유지됩니다.";
  if (error instanceof ApiFailure && error.status === 404) return "편집본·원본 글 또는 선택한 분류를 찾을 수 없습니다. 현재 입력은 유지됩니다.";
  if (error instanceof ApiFailure && error.status === 403) return "권한 또는 CSRF 확인에 실패했습니다. 원고는 유지됩니다. 다시 시도해 주세요.";
  return `${apiFailureMessage(error)} 현재 입력은 유지됩니다.`;
}

/** 세션 세대 하나에 속한 관리자 원고, 수동 저장 revision, 출간을 관리한다. */
function WriteInstance({ route }: { route: Route }) {
  const auth = useAuth();
  const router = useRouter();
  const routeKey = route.kind === "new" || route.kind === "invalid" ? route.kind : `${route.kind}:${route.id}`;
  const loadedRoute = useRef<string | null>(null);
  const controllers = useRef(new Set<AbortController>());
  const writeGeneration = useRef(0);
  const busyLock = useRef(false);
  const uploadLock = useRef(false);
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
  const [tagInput, setTagInput] = useState("");
  const [message, setMessage] = useState("");
  const [savedAt, setSavedAt] = useState("");
  const [busy, setBusy] = useState<"save" | "publish" | null>(null);
  const [uploading, setUploading] = useState(false);
  const [showPublish, setShowPublish] = useState(false);
  const [retry, setRetry] = useState(0);
  const [focusFirstSignal, setFocusFirstSignal] = useState(0);
  const dirty = screen === "ready" && version !== savedVersion;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

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
      loadedRoute.current === routeKey) return;
    if (loadedRoute.current !== null && dirtyRef.current && !allowRouteSwitch.current) {
      setMessage("저장하지 않은 원고를 유지하고 원래 편집 주소로 돌아왔습니다.");
      router.replace(routeHref(loadedRoute.current), { scroll: false });
      return;
    }
    if (route.kind === "invalid") {
      writeGeneration.current += 1;
      controllers.current.forEach((pending) => pending.abort()); controllers.current.clear();
      busyLock.current = false; setBusy(null); setShowPublish(false);
      uploadLock.current = false; setUploading(false);
      uploadController.current = null;
      loadedRoute.current = routeKey;
      const cleared = blankForm(); formRef.current = cleared; setForm(cleared);
      draftId.current = null; revision.current = null; original.current = { postId: null, baseUpdatedAt: null };
      versionRef.current = 0; setVersion(0); setSavedVersion(0);
      return;
    }
    allowRouteSwitch.current = false;
    writeGeneration.current += 1;
    controllers.current.forEach((pending) => pending.abort()); controllers.current.clear();
    busyLock.current = false; setBusy(null); setShowPublish(false);
    uploadLock.current = false; setUploading(false);
    uploadController.current = null;
    draftId.current = null; revision.current = null;
    original.current = { postId: null, baseUpdatedAt: null };
    const cleared = blankForm();
    formRef.current = cleared; setForm(cleared); versionRef.current = 0; setVersion(0); setSavedVersion(0);
    loadedRoute.current = routeKey;
    const controller = new AbortController();
    controllers.current.add(controller);
    setScreen("loading"); setMessage(""); setExisting(null);
    void (async () => {
      try {
        const [categoryValue, tagValue] = await Promise.all([
          auth.adminRead("/api/v1/admin/categories", controller.signal),
          auth.adminRead("/api/v1/admin/tags", controller.signal),
        ]);
        if (controller.signal.aborted) return;
        const nextCategories = parseAdminCategories(categoryValue);
        const nextTags = parseAdminTags(tagValue);
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
            if (!controller.signal.aborted) { setCategories(nextCategories); setKnownTags(nextTags); setExisting(page.items[0]); setScreen("existing"); }
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
          nextForm = blankForm(); setSavedAt("");
        }
        if (controller.signal.aborted) return;
        formRef.current = nextForm; setForm(nextForm); versionRef.current = 0; setVersion(0); setSavedVersion(0);
        setCategories(nextCategories); setKnownTags(nextTags); setScreen("ready");
      } catch (error) {
        if (!controller.signal.aborted) { setMessage(apiFailureMessage(error)); setScreen("error"); }
      } finally { controllers.current.delete(controller); }
    })();
    return () => { controller.abort(); controllers.current.delete(controller); };
  }, [auth.adminRead, auth.status, auth.user?.role, route.kind, routeKey, retry, router]);

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
    const values = draftValues({ title: snapshot.title, slug: snapshot.slug,
      body, attachmentIds, categoryId: snapshot.categoryId,
      tags: snapshot.tags, visibility: snapshot.visibility });
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
    if (!snapshot.title.trim() || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(snapshot.slug) ||
      [...snapshot.title].length > 200 || snapshot.slug.length > 160 ||
      new TextEncoder().encode(serializeEditorMarkdown(snapshot.document)).length > 1024 * 1024) {
      setMessage("출간하려면 제목·글 주소·본문 크기를 확인해 주세요."); setShowPublish(false); return;
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
      router.replace(`/post/?slug=${encodeURIComponent((response as { slug: string }).slug)}`);
    } catch (error) { if (!controller.signal.aborted && generation === writeGeneration.current) setMessage(writeError(error)); }
    finally { controllers.current.delete(controller); if (generation === writeGeneration.current) { busyLock.current = false; setBusy(null); } }
  }

  /** 기존 태그 집계와 입력을 비교해 유효한 새 태그만 추가한다. */
  function addTag() {
    const name = tagInput.trim().replace(/^#/, "").toLowerCase();
    if (!name || [...name].length > 40 || /[\u0000-\u001f\u007f]/.test(name)) {
      setMessage("태그는 제어 문자 없이 1~40자로 입력해 주세요."); return;
    }
    if (!form.tags.includes(name) && form.tags.length >= 16) { setMessage("태그는 최대 16개입니다."); return; }
    if (!form.tags.includes(name)) changeForm((current) => ({ ...current, tags: [...current.tags, name] }));
    setTagInput("");
  }

  if (auth.status === "checking") return <main id="main-content" className="write-page" role="status">관리자 세션을 확인하고 있습니다…</main>;
  if (auth.status === "error") return <main id="main-content" className="write-page"><h1>관리자 세션을 확인하지 못했습니다</h1>
    <p role="alert">API 설정이나 연결을 확인해 주세요.</p><button type="button" className="small-button" onClick={() => void auth.refresh()}>다시 시도</button></main>;
  if (auth.status !== "authenticated" || auth.user?.role !== "ADMIN") return <main id="main-content" className="write-page">
    <h1>관리자 글쓰기</h1>{auth.status === "guest" ? <p>글을 쓰려면 관리자 로그인이 필요합니다. <Link
      href={`/login/?returnTo=${encodeURIComponent(`/write/${route.kind === "draft" ? `?draftId=${route.id}` : route.kind === "post" ? `?postId=${route.id}` : ""}`)}`}>로그인</Link></p> :
      <p>이 계정은 글쓰기 권한이 없습니다.</p>}</main>;
  if (route.kind === "invalid") return <main id="main-content" className="write-page"><h1>글쓰기 주소를 확인해 주세요</h1>
    <p>postId 또는 draftId에 양수 ID 하나만 지정할 수 있습니다.</p><Link href="/admin/drafts/">편집본 목록</Link></main>;
  if (screen === "loading") return <main id="main-content" className="write-page" role="status">원고를 불러오고 있습니다…</main>;
  if (screen === "error") return <main id="main-content" className="write-page"><h1>원고를 열지 못했습니다</h1>
    <p role="alert">{message}</p><button type="button" className="small-button" onClick={() => { loadedRoute.current = null; setRetry((n) => n + 1); }}>다시 시도</button></main>;
  if (screen === "existing" && existing) return <main id="main-content" className="write-page"><h1>이미 편집 중인 글입니다</h1>
    <p>이 글의 편집본이 있습니다. 현재 편집본을 이어서 열어 주세요.</p>
    <Link className="primary-button" href={`/write/?draftId=${existing.id}`}>편집본 이어쓰기</Link></main>;

  const options = categoryOptions(categories);
  return <main id="main-content" className="write-page">
    <div className="write-top"><Link href="/admin/drafts/" className="back-link">← 나가기</Link>
      <span className="write-kind">TECH · {original.current.postId === null ? "새 글" : "기존 글 편집"}</span></div>
    <h1 className="sr-only">Tech 글쓰기</h1>
    <label className="sr-only" htmlFor="write-title">글 제목</label>
    <input id="write-title" className="write-title" value={form.title} placeholder="제목 없음"
      onChange={(event) => changeForm((current) => ({ ...current, title: event.target.value }))} disabled={busy === "publish"}
      onKeyDown={(event) => { if ((event.key === "Enter" || event.key === "ArrowDown") &&
        !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); setFocusFirstSignal((n) => n + 1); } }} />
    <div className="write-meta">
      <label htmlFor="write-slug">글 주소</label>
      <input id="write-slug" value={form.slug} maxLength={160} placeholder="example-post" autoComplete="off"
        onChange={(event) => changeForm((current) => ({ ...current, slug: event.target.value }))} disabled={busy === "publish"} />
      <label htmlFor="write-category">분류</label>
      <select id="write-category" value={form.categoryId ?? ""} disabled={busy === "publish"}
        onChange={(event) => changeForm((current) => ({ ...current, categoryId: event.target.value ? Number(event.target.value) : null }))}>
        <option value="">분류 없음</option>
        {form.categoryId !== null && !options.some((option) => option.id === form.categoryId) &&
          <option value={form.categoryId}>삭제된 분류 · 해제하거나 다른 분류를 선택해 주세요</option>}
        {options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
      </select>
      <label htmlFor="write-visibility">열람 범위</label>
      <select id="write-visibility" value={form.visibility} disabled={busy === "publish"}
        onChange={(event) => changeForm((current) => ({ ...current, visibility: event.target.value as "PUBLIC" | "PRIVATE" }))}>
        <option value="PUBLIC">전체 공개</option><option value="PRIVATE">로그인 회원 공개</option>
      </select>
    </div>
    <div className="write-tags"><span className="write-label">태그</span><div className="write-tag-chips">{form.tags.map((tag) =>
      <button key={tag} type="button" disabled={busy === "publish"} aria-label={`${tag} 태그 제거`}
        onClick={() => changeForm((current) => ({ ...current, tags: current.tags.filter((item) => item !== tag) }))}>#{tag} ×</button>)}</div>
      <label className="sr-only" htmlFor="write-tag">태그 추가</label>
      <input id="write-tag" list="editor-known-tags" value={tagInput} placeholder="태그 입력 후 Enter"
        disabled={busy === "publish"} onChange={(event) => setTagInput(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); addTag(); } }} />
      <datalist id="editor-known-tags">{knownTags.filter((tag) => !form.tags.includes(tag.name)).map((tag) =>
        <option key={tag.name} value={tag.name} />)}</datalist>
      <button type="button" className="small-button" onClick={addTag} disabled={busy === "publish"}>추가</button>
    </div>
    <BlockEditor value={form.document} disabled={busy === "publish" || uploading} focusFirstSignal={focusFirstSignal}
      onImageFile={uploadImage} onImageReject={setMessage}
      onChange={(next) => changeForm((current) => ({ ...current, document: next }))} />
    <p className="write-hint">기본 블록·명확한 표·한 단계 접기·첨부 이미지를 편집할 수 있습니다. JPEG/PNG 파일 선택·드롭·붙여넣기로 이미지를 추가합니다. 이미지 제거는 문서 연결만 해제하며 저장 후 해당 글의 읽기 권한이 철회됩니다. 중첩 접기와 지원하지 않는 이미지는 원문 그대로 보존합니다.</p>
    {message && <p className="write-message" role="status">{message}</p>}
    <div className="write-spacer" />
    <div className="write-toolbar"><span className="write-save-state" aria-live="polite">{uploading ? "이미지 업로드 중…" : busy === "save" ? "저장 중…" :
      busy === "publish" ? "출간 중…" : dirty ? "저장하지 않은 변경" : savedAt ? `임시저장됨 · ${savedTime(savedAt)} KST` : "아직 저장하지 않음"}</span>
      {uploading && <button type="button" className="small-button" onClick={() => {
        uploadController.current?.abort(); setMessage("이미지 업로드를 취소했습니다. 원고는 유지됩니다.");
      }}>업로드 취소</button>}
      <Link href="/admin/drafts/" className="write-drafts-link">임시저장 목록</Link>
      <button type="button" className="small-button" onClick={() => void save()} disabled={busy !== null || uploading}>임시저장</button>
      <button type="button" className="primary-button" onClick={() => setShowPublish(true)} disabled={busy !== null || uploading}>출간하기</button></div>
    {showPublish && <PublishSheet title={form.title} slug={form.slug} visibility={form.visibility} busy={busy !== null || uploading} error={message}
      onSlug={(slug) => changeForm((current) => ({ ...current, slug }))}
      onVisibility={(visibility) => changeForm((current) => ({ ...current, visibility }))}
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
