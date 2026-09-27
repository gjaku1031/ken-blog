"use client";

import { forwardRef, useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState,
  type ClipboardEvent, type DragEvent, type KeyboardEvent, type MouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { SafeMarkdown } from "@/components/safe-markdown";
import { blockMarkdown, emptyBlock, emptyImageBlock, emptyToggleBlock, ensureBlockBoundaries, type BlockType, type EditorBlock, type MarkdownDocument } from "@/lib/editor-markdown";
import type { ImageData } from "@/lib/editor-image";
import { emptyTable, parsePipeHeaderCommand, TABLE_MAX_COLUMNS, TABLE_MAX_CELL_LENGTH } from "@/lib/editor-table";
import { TableBlock } from "@/components/editor/table-block";
import { ToggleBlock } from "@/components/editor/toggle-block";
import { ImageBlock } from "@/components/editor/image-block";
import { CodeLanguagePicker } from "@/components/editor/code-language-picker";
import { insertAnnotationAt, insertInlineTextAt, type EditorAnnotationModel, type EditorAnnotationSelection } from "@/lib/editor-annotation";
import { validWikiTitle } from "@/lib/wiki-link-syntax";
import { captureBlockInsertion, moveEditorBlocks, resolveBlockInsertion, type BlockInsertion } from "@/lib/editor-block-move";
import "./editor.css";

type Props = { value: MarkdownDocument; onChange: (next: MarkdownDocument) => void; disabled?: boolean;
  focusFirstSignal?: number; focusBlock?: { id: string; serial: number; offset?: number }; depth?: 0 | 1; onOutdentFrom?: (index: number) => void;
  onImageFile?: (file: File) => Promise<ImageData | null>; onImageReject?: (message: string) => void;
  annotationPreview?: EditorAnnotationModel | null; annotationController?: AnnotationController; annotationSessionKey?: string };
/** 글쓰기 고정 도구에서 커서를 보관하고 주석을 삽입할 수 있는 편집기 경계. */
export type BlockEditorHandle = { captureAnnotationSelection: () => void; insertAnnotation: () => boolean;
  insertWikiLink: (title: string) => boolean; insertTable: () => void; chooseImage: () => void };
type AnnotationController = { selection: EditorAnnotationSelection | null; composing: boolean; suppressNext: boolean };
type FocusTarget = { id: string; offset: number | "end" };
type DropSlot = { targetId: string | null; side: "before" | "after" | "end"; kind: "blocks" | "file" };
type SelectionBox = { left: number; top: number; width: number; height: number };
const ANNOTATION_TEXT_TYPES = new Set<BlockType>(["p", "h1", "h2", "h3", "ul", "ol", "todo", "quote"]);
/** 편집과 미리보기 조작에 쓰는 블록 종류별 한국어 이름. */
const blockNames: Record<BlockType, string> = { p: "문단", h1: "제목 1", h2: "제목 2", h3: "제목 3",
  ul: "글머리 목록", ol: "번호 목록", todo: "할 일", quote: "인용", code: "코드", math: "수식", mermaid: "도식", hr: "구분선", table: "표", toggle: "접기", image: "이미지", raw: "원문" };
const shortcuts: Record<string, BlockType> = { "#": "h1", "##": "h2", "###": "h3", "-": "ul", "*": "ul",
  "1.": "ol", "[]": "todo", "[ ]": "todo", "|": "quote" };
const DRAG_FORMAT = "application/x-ken-blog-editor-block";
const CODE_LANGUAGE_PATTERN = /^[A-Za-z0-9_-]{0,32}$/;

/** {@link BlockEditor}의 선택 상태를 해제할 빈 여백과 기존 클릭 동작을 구별한다. */
function selectionDismissClick(target: Element, editor: HTMLDivElement): "keep" | "clear" | "clear-only" {
  if (target.closest(".editor-selection-bar, .block-controls, .editor-image-figure")) return "keep";
  const previewTrigger = target.closest(".editor-preview-trigger");
  if (!previewTrigger && target.closest(
    "a, button, input, textarea, select, label, summary, [contenteditable], [draggable='true'], " +
    "[role='button'], [role='link'], [role='combobox'], [role='listbox'], [role='dialog']")) return "keep";
  if (editor.contains(target) && target.closest(".block-editor") !== editor) return "keep";
  return editor.contains(target) && target.closest(".editor-click-below") ? "clear-only" : "clear";
}

/** 텍스트 블록의 Markdown 접두어를 활성 입력에만 붙이고 {@link blockMarkdown} 저장 모델은 유지한다. */
function sourcePrefix(block: EditorBlock): string {
  if (block.type === "h1" || block.type === "h2" || block.type === "h3")
    return `${"#".repeat(Number(block.type[1]))} `;
  if (block.type === "ul") return "- ";
  if (block.type === "ol") return `${block.ordinal ?? 1}. `;
  if (block.type === "todo") return `- [${block.done ? "x" : " "}] `;
  if (block.type === "quote") return "> ";
  return "";
}

/** 활성 입력에는 {@link EditorBlock}의 제목 기호와 원문 인라인 문법을 함께 보여 준다. */
function visibleBlockText(block: EditorBlock): string { return sourcePrefix(block) + block.text; }

/** 활성 접두어 수정·삭제를 {@link EditorBlock} 종류로 되돌리고 유효하지 않은 기호는 문단으로 남긴다. */
function parseActiveSource(block: EditorBlock, source: string): Pick<EditorBlock, "type" | "text" | "done" | "ordinal"> {
  if (block.type !== "p" && !sourcePrefix(block))
    return { type: block.type, text: source, done: block.done, ordinal: block.ordinal };
  const heading = /^(#{1,3}) ([^\r\n]*)$/.exec(source);
  if (heading) return { type: `h${heading[1].length}` as BlockType, text: heading[2], done: undefined, ordinal: undefined };
  const task = /^- \[([ xX])\] ([^\r\n]*)$/.exec(source);
  if (task) return { type: "todo", text: task[2], done: task[1].toLowerCase() === "x", ordinal: undefined };
  const bullet = /^[-+*] ([^\r\n]*)$/.exec(source);
  if (bullet) return { type: "ul", text: bullet[1], done: undefined, ordinal: undefined };
  const number = /^(\d{1,9})[.)] ([^\r\n]*)$/.exec(source);
  if (number) return { type: "ol", text: number[2], done: undefined, ordinal: Number(number[1]) };
  const quote = /^> ([^\r\n]*)$/.exec(source);
  if (quote) return { type: "quote", text: quote[1], done: undefined, ordinal: undefined };
  return { type: "p", text: source, done: undefined, ordinal: undefined };
}

/** 기본 블록을 키보드와 마우스로 편집하고 원문 블록은 읽기 전용으로 보존한다. */
export const BlockEditor = forwardRef<BlockEditorHandle, Props>(function BlockEditorInner({ value: suppliedValue, onChange: onDocumentChange, disabled = false,
  focusFirstSignal = 0, focusBlock, depth = 0, onOutdentFrom, onImageFile, onImageReject,
  annotationPreview, annotationController, annotationSessionKey }: Props, ref) {
  const editorToken = useId();
  const trailing = useRef<EditorBlock | null>(null);
  /** {@link MarkdownDocument}의 마지막 실문단 아래에 안정된 ID의 화면 전용 입력 줄을 붙인다. */
  function withTrailing(document: MarkdownDocument): MarkdownDocument {
    const last = document.blocks.at(-1);
    if (last?.type === "p" && !last.text && !last.raw && !last.intentionalBlank) return document;
    if (!trailing.current || document.blocks.some((block) => block.id === trailing.current?.id))
      trailing.current = { ...emptyBlock("p", document.newline), after: "", transient: true };
    return { ...document, blocks: [...document.blocks, trailing.current] };
  }
  const value = withTrailing(suppliedValue);
  /** 입력을 시작한 화면 전용 줄만 실문단으로 승격하고 나머지는 원고에서 제외한다. */
  function withoutTrailing(document: MarkdownDocument): MarkdownDocument {
    const blocks = document.blocks.flatMap((block) => {
      if (!block.transient) return [block];
      if (block.type === "p" && !block.text && !block.raw) return [];
      const { transient: _transient, ...materialized } = block;
      return [materialized];
    });
    return { ...document, blocks };
  }
  /** {@link onDocumentChange}에 화면 전용 빈 문단을 전달하지 않는다. */
  function onChange(next: MarkdownDocument) {
    const actual = withoutTrailing(next);
    latest.current = withTrailing(actual);
    onDocumentChange(actual);
  }
  const [activeId, setActiveId] = useState<string | null>(null);
  const [focusTarget, setFocusTarget] = useState<FocusTarget | null>(null);
  const [tableFocus, setTableFocus] = useState<{ id: string; serial: number } | null>(null);
  const [toggleTitleFocus, setToggleTitleFocus] = useState<{ id: string; serial: number } | null>(null);
  const [toggleChildFocus, setToggleChildFocus] = useState<{ toggleId: string; id: string; offset: number; serial: number } | null>(null);
  const [toggleFirstFocus, setToggleFirstFocus] = useState<{ id: string; serial: number } | null>(null);
  const [languageError, setLanguageError] = useState<{ id: string; message: string } | null>(null);
  const refs = useRef(new Map<string, HTMLElement>());
  const composing = useRef(false);
  const compositionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragIds = useRef<string[]>([]);
  const handlePointerType = useRef<string>("");
  const selectionAnchor = useRef<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null);
  const [keepSelectionBarSpace, setKeepSelectionBarSpace] = useState(false);
  const marqueeCleanup = useRef<(() => void) | null>(null);
  const marqueeFocusFrame = useRef(0);
  const suppressMarqueeClick = useRef(false);
  const suppressMarqueeClickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [dropSlot, setDropSlot] = useState<DropSlot | null>(null);
  const [pendingUpload, setPendingUpload] = useState<{ serial: number; anchor: BlockInsertion } | null>(null);
  const uploadSerial = useRef(0);
  const [flashIds, setFlashIds] = useState<Set<string>>(() => new Set());
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const beforeMove = useRef<Map<string, DOMRect> | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const latest = useRef(value);
  const root = useRef<HTMLDivElement | null>(null);
  const ownedAnnotation = useRef<AnnotationController>({ selection: null, composing: false, suppressNext: false });
  const annotation = annotationController ?? ownedAnnotation.current;
  latest.current = value;
  useEffect(() => () => {
    if (compositionTimer.current) clearTimeout(compositionTimer.current);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    if (suppressMarqueeClickTimer.current) clearTimeout(suppressMarqueeClickTimer.current);
    cancelAnimationFrame(marqueeFocusFrame.current);
    marqueeCleanup.current?.();
    if (composing.current) annotation.composing = false;
  }, [annotation]);
  useEffect(() => {
    const available = new Set(value.blocks.map((block) => block.id));
    setSelectedIds((current) => current.size && [...current].some((id) => !available.has(id)) ?
      new Set([...current].filter((id) => available.has(id))) : current);
    if (selectionAnchor.current && !available.has(selectionAnchor.current)) selectionAnchor.current = null;
  }, [value.blocks]);

  /** 빈 공간의 primary 포인터 클릭만 해제하고 마퀴·드래그와 컨트롤 클릭은 유지한다. {@link selectionDismissClick} */
  useEffect(() => {
    if (!selectedIds.size) return;
    let candidate: { pointerId: number; x: number; y: number; moved: boolean; released: boolean } | null = null;
    let expiry: ReturnType<typeof setTimeout> | null = null;
    let dismissal: ReturnType<typeof setTimeout> | null = null;
    const clearExpiry = () => { if (expiry) { clearTimeout(expiry); expiry = null; } };
    const clearDismissal = () => { if (dismissal) { clearTimeout(dismissal); dismissal = null; } };
    const down = (event: globalThis.PointerEvent) => {
      candidate = null; clearExpiry();
      const editor = root.current;
      if (!editor || !event.isPrimary || event.button !== 0 || event.shiftKey || event.ctrlKey ||
        event.metaKey || event.altKey || !(event.target instanceof Element) ||
        selectionDismissClick(event.target, editor) === "keep") return;
      candidate = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false, released: false };
    };
    const move = (event: globalThis.PointerEvent) => {
      if (candidate && candidate.pointerId === event.pointerId &&
        Math.hypot(event.clientX - candidate.x, event.clientY - candidate.y) >= 5) candidate.moved = true;
    };
    const up = (event: globalThis.PointerEvent) => {
      if (candidate?.pointerId === event.pointerId) {
        candidate.released = true;
        // 터치의 호환 click은 pointerup보다 늦게 오므로 짧은 타이머에서 후보를 지우지 않는다.
        expiry = setTimeout(() => { candidate = null; expiry = null; }, 1_200);
      }
    };
    const cancel = (event: globalThis.PointerEvent) => {
      if (candidate?.pointerId === event.pointerId) { candidate = null; clearExpiry(); }
    };
    const blur = () => { candidate = null; clearExpiry(); };
    const click = (event: globalThis.MouseEvent) => {
      const pending = candidate;
      candidate = null; clearExpiry();
      const editor = root.current;
      if (!pending?.released || pending.moved || event.button !== 0 || event.detail === 0 ||
        Math.hypot(event.clientX - pending.x, event.clientY - pending.y) >= 5 ||
        suppressMarqueeClick.current || !editor || !(event.target instanceof Element)) return;
      const action = selectionDismissClick(event.target, editor);
      if (action === "keep") return;
      if (action === "clear-only") { event.preventDefault(); event.stopPropagation(); }
      // 다음 task에서 선택 표시를 지워 현재 click의 전파·기본 동작 중 타깃이 움직이지 않게 한다.
      clearDismissal();
      dismissal = setTimeout(() => { setSelectedIds(new Set()); selectionAnchor.current = null; dismissal = null; }, 0);
    };
    document.addEventListener("pointerdown", down, true);
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", cancel, true);
    window.addEventListener("blur", blur);
    document.addEventListener("click", click, true);
    return () => {
      clearExpiry(); clearDismissal();
      document.removeEventListener("pointerdown", down, true);
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", cancel, true);
      window.removeEventListener("blur", blur);
      document.removeEventListener("click", click, true);
    };
  }, [selectedIds.size]);

  /** 실제 재배치 전후의 블록 좌표 차이만 애니메이션하고 감소된 동작 설정을 존중한다. {@link BlockEditor} */
  useLayoutEffect(() => {
    const previous = beforeMove.current;
    beforeMove.current = null;
    if (!previous || !root.current || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    for (const element of root.current.querySelectorAll<HTMLElement>(":scope > .editor-block")) {
      const old = previous.get(element.dataset.blockId ?? "");
      if (!old) continue;
      const now = element.getBoundingClientRect();
      const delta = old.top - now.top;
      if (Math.abs(delta) < 1) continue;
      element.animate([{ transform: `translateY(${delta}px)` }, { transform: "translateY(0)" }],
        { duration: 230, easing: "cubic-bezier(.22,.8,.3,1)" });
    }
  }, [value.blocks]);
  useEffect(() => {
    if (depth === 0) { annotation.selection = null; annotation.composing = false; annotation.suppressNext = false; }
  }, [annotationSessionKey, depth]);

  /** 상태가 적용된 뒤 커서를 지정한 블록의 정확한 위치로 돌린다. */
  useEffect(() => {
    if (!focusTarget) return;
    const target = refs.current.get(focusTarget.id);
    target?.focus();
    if (target instanceof HTMLTextAreaElement) {
      const block = value.blocks.find((item) => item.id === focusTarget.id);
      const prefix = block ? sourcePrefix(block).length : 0;
      const offset = focusTarget.offset === "end" ? target.value.length :
        Math.min(focusTarget.offset + prefix, target.value.length);
      target.setSelectionRange(offset, offset);
    }
    setFocusTarget(null);
  }, [activeId, focusTarget, value.blocks]);

  /** 제목에서 Enter·아래 화살표를 누르면 첫 본문 블록의 앞에 커서를 둔다. */
  useEffect(() => { if (focusFirstSignal > 0 && value.blocks[0]) activate(value.blocks[0].id, 0); }, [focusFirstSignal]);
  /** 상위 접기에서 옮긴 자식 블록의 정확한 포커스를 되찾는다. */
  useEffect(() => { if (focusBlock) activate(focusBlock.id, focusBlock.offset ?? 0); }, [focusBlock?.serial]);

  /** 조합 중 keydown이 한글 마지막 글자를 분리하지 않게 모든 구조 키를 통과시킨다. */
  function isComposing(event: KeyboardEvent<HTMLTextAreaElement>): boolean {
    return composing.current || event.nativeEvent.isComposing || event.keyCode === 229;
  }

  /** 한 블록만 복사해 변경하고 나머지 원문 slice를 유지한다. */
  function edit(id: string, change: (block: EditorBlock) => EditorBlock) {
    if (disabled) return;
    onChange(ensureBlockBoundaries({ ...value, blocks: value.blocks.map((block) => block.id === id ? change(block) : block) }));
  }

  /** 기존 미지정·알 수 없는 언어값은 유지하되 새 입력만 제한된 ASCII와 Mermaid 제외 규칙으로 교체한다. */
  function changeCodeLanguage(id: string, language: string) {
    if (disabled) return;
    if (!CODE_LANGUAGE_PATTERN.test(language)) {
      setLanguageError({ id, message: "언어 이름은 영문·숫자·하이픈·밑줄만 32자까지 입력할 수 있습니다." });
      return;
    }
    if (language.toLowerCase() === "mermaid") {
      setLanguageError({ id, message: "Mermaid는 코드 블록 언어로 선택할 수 없습니다." });
      return;
    }
    setLanguageError(null);
    edit(id, (old) => ({ ...old, lang: language, dirty: true }));
  }

  /** 블록 변경 후 새 커서 위치를 요청한다. */
  function activate(id: string, offset: number | "end" = "end") {
    setActiveId(id);
    setFocusTarget({ id, offset });
  }

  /** 제목 입력의 가상 접두어를 빼고 실제 {@link EditorAnnotationSelection} 본문 좌표만 보관한다. */
  function captureAnnotationSelectionFrom(input: HTMLTextAreaElement) {
    const id = input.dataset.annotationBlockId;
    if (!id) return;
    const block = latest.current.blocks.find((item) => item.id === id);
    if (!block || input.value !== visibleBlockText(block)) return;
    const prefix = sourcePrefix(block).length;
    annotation.selection = { id, start: Math.max(0, input.selectionStart - prefix),
      end: Math.max(0, input.selectionEnd - prefix), expectedText: block.text };
  }

  /** Tab 통과는 선택을 유지하고 편집 불가 입력을 실제 조작할 때만 선택을 폐기한다. */
  function clearAnnotationSelectionForInput(target: EventTarget | null) {
    if (target instanceof HTMLElement &&
      (target instanceof HTMLInputElement || target instanceof HTMLSelectElement ||
        target instanceof HTMLTextAreaElement && !target.dataset.annotationBlockId || target.isContentEditable))
      annotation.selection = null;
  }

  /** 도구로 포커스가 이동하기 직전의 현재 textarea 선택을 마지막 선택으로 보존한다. */
  function captureAnnotationSelection() {
    if (annotation.composing) { annotation.suppressNext = true; return; }
    const focused = document.activeElement;
    if (focused instanceof HTMLTextAreaElement && root.current?.contains(focused))
      captureAnnotationSelectionFrom(focused);
  }

  /** 공유 모델로 선택을 치환하고 최상위 또는 접기 자식의 삽입 커서로 돌아간다. */
  function insertAnnotation(): boolean {
    const blocked = disabled || annotation.composing || annotation.suppressNext;
    annotation.suppressNext = false;
    if (blocked || depth !== 0) return false;
    const inserted = insertAnnotationAt(latest.current, annotation.selection);
    annotation.selection = null;
    onChange(inserted.document);
    if (inserted.focus.path) setToggleChildFocus({ toggleId: inserted.focus.path.toggleId,
      id: inserted.focus.id, offset: inserted.focus.offset, serial: (toggleChildFocus?.serial ?? 0) + 1 });
    else activate(inserted.focus.id, inserted.focus.offset);
    return true;
  }

  /** 검색에서 확인한 제목을 원래 선택 범위 또는 안전한 마지막 문단에 삽입한다. */
  function insertWikiLink(value: string): boolean {
    const title = validWikiTitle(value);
    const blocked = disabled || annotation.composing || annotation.suppressNext;
    annotation.suppressNext = false;
    if (blocked || depth !== 0 || !title) return false;
    const source = `[[${title}]]`;
    const inserted = insertInlineTextAt(latest.current, source, source.length, annotation.selection);
    annotation.selection = null;
    onChange(inserted.document);
    if (inserted.focus.path) setToggleChildFocus({ toggleId: inserted.focus.path.toggleId,
      id: inserted.focus.id, offset: inserted.focus.offset, serial: (toggleChildFocus?.serial ?? 0) + 1 });
    else activate(inserted.focus.id, inserted.focus.offset);
    return true;
  }

  useImperativeHandle(ref, () => ({ captureAnnotationSelection, insertAnnotation, insertWikiLink,
    insertTable: addTable, chooseImage: () => fileInput.current?.click() }));

  /** 현재 위치의 뒤에 새 블록을 넣고 원래 구분 공백은 새 블록 뒤로 옮긴다. */
  function insertAfter(index: number, type: BlockType, text = "", offset = 0) {
    const blocks = [...value.blocks];
    const previous = { ...blocks[index] };
    const added = { ...emptyBlock(type, value.newline), text, after: previous.after };
    previous.after = previous.type === type && ["ul", "ol", "todo"].includes(type) ? value.newline : value.newline.repeat(2);
    blocks[index] = previous;
    blocks.splice(index + 1, 0, added);
    onChange(ensureBlockBoundaries({ ...value, blocks }));
    activate(added.id, offset);
  }

  /** 명확한 명령으로 현재 문단을 표로 바꾸고 마지막 표 뒤에는 빈 문단을 둔다. */
  function replaceWithTable(index: number, headers?: string[]) {
    const blocks = [...value.blocks];
    const original = blocks[index];
    const table = { ...original, type: "table" as const, text: "", table: emptyTable(headers), dirty: true };
    blocks[index] = table;
    if (index === blocks.length - 1) {
      table.after = value.newline.repeat(2);
      blocks.push({ ...emptyBlock("p", value.newline), after: original.after });
    }
    onChange(ensureBlockBoundaries({ ...value, blocks }));
    setActiveId(null);
    setTableFocus({ id: table.id, serial: (tableFocus?.serial ?? 0) + 1 });
  }

  /** 도구 버튼으로 선택 블록 뒤에 새 표와 이어 쓸 문단을 넣는다. */
  function addTable() {
    if (disabled) return;
    const blocks = [...value.blocks];
    if (!blocks.length) {
      const table = { ...emptyBlock("table", value.newline), table: emptyTable(), after: value.newline.repeat(2) };
      blocks.push(table, { ...emptyBlock("p", value.newline), after: "" });
      onChange({ ...value, blocks });
      setTableFocus({ id: table.id, serial: (tableFocus?.serial ?? 0) + 1 });
      return;
    }
    const selected = blocks.findIndex((block) => block.id === activeId);
    const index = selected >= 0 ? selected : blocks.length - 1;
    const previous = blocks[index];
    if (previous.type === "p" && !previous.text && !previous.raw) { replaceWithTable(index); return; }
    const table = { ...emptyBlock("table", value.newline), table: emptyTable(), after: previous.after };
    blocks[index] = { ...previous, after: value.newline.repeat(2) };
    blocks.splice(index + 1, 0, table);
    if (index + 1 === blocks.length - 1) {
      table.after = value.newline.repeat(2);
      blocks.push({ ...emptyBlock("p", value.newline), after: previous.after });
    }
    onChange(ensureBlockBoundaries({ ...value, blocks }));
    setActiveId(null);
    setTableFocus({ id: table.id, serial: (tableFocus?.serial ?? 0) + 1 });
  }

  /** 파일이 놓인 앞·뒤 경계를 실제 블록 배열의 삽입 인덱스로 바꾼다. {@link DropSlot} */
  function slotIndex(document: MarkdownDocument, slot: DropSlot): number {
    if (slot.side === "end" || !slot.targetId) return document.blocks.length;
    const index = document.blocks.findIndex((block) => block.id === slot.targetId);
    return index < 0 ? document.blocks.length : index + (slot.side === "after" ? 1 : 0);
  }

  /** 업로드 완료 시점의 최신 원고에서 ID 경계를 찾아 이미지와 이어 쓸 문단을 삽입한다. {@link BlockInsertion} */
  function insertUploaded(image: ImageData, anchor: BlockInsertion, replaceEmptyId: string | null) {
    const current = withoutTrailing(latest.current);
    const blocks = [...current.blocks];
    const index = resolveBlockInsertion(current, anchor);
    const picture = emptyImageBlock(image, current.newline);
    const replaceIndex = replaceEmptyId ? blocks.findIndex((block) => block.id === replaceEmptyId) : -1;
    const emptyTarget = replaceIndex >= 0 && blocks[replaceIndex].type === "p" &&
      !blocks[replaceIndex].text && !blocks[replaceIndex].raw;
    if (emptyTarget) {
      const old = blocks[replaceIndex];
      blocks[replaceIndex] = { ...picture, after: old.after };
      if (replaceIndex === blocks.length - 1) {
        blocks[replaceIndex] = { ...picture, after: current.newline.repeat(2) };
        blocks.push({ ...emptyBlock("p", current.newline), after: old.after });
      }
    } else if (!blocks.length) {
      blocks.push({ ...picture, after: current.newline.repeat(2) }, emptyBlock("p", current.newline));
    } else if (index === 0) {
      blocks.unshift({ ...picture, after: current.newline.repeat(2) });
    } else {
      const previous = blocks[index - 1];
      blocks[index - 1] = { ...previous, after: current.newline.repeat(2) };
      blocks.splice(index, 0, { ...picture, after: previous.after });
      if (index === current.blocks.length) {
        blocks[index] = { ...picture, after: current.newline.repeat(2) };
        blocks.push({ ...emptyBlock("p", current.newline), after: previous.after });
      }
    }
    const next = ensureBlockBoundaries({ ...current, blocks });
    latest.current = next;
    onChange(next);
    activate(picture.id);
    setFlashIds(new Set([picture.id]));
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlashIds(new Set()), 800);
  }

  /** 업로드 요청 전 ID 경계를 잡아 이후 원고 편집에도 첨부 삽입 위치를 유지한다. {@link insertUploaded} */
  function acceptImageFile(file: File, slot: DropSlot | null = null) {
    if (disabled || !onImageFile) return;
    const current = withoutTrailing(latest.current);
    const targetIndex = activeId ? current.blocks.findIndex((block) => block.id === activeId) : -1;
    const index = slot ? slotIndex(current, slot) : targetIndex < 0 ? current.blocks.length : targetIndex + 1;
    const preferred = slot?.side === "before" ? "before" : "after";
    const anchor = captureBlockInsertion(current, index, preferred);
    const replaceEmptyId = slot ? null : targetIndex >= 0 ? current.blocks[targetIndex].id : null;
    const serial = ++uploadSerial.current;
    setPendingUpload({ serial, anchor });
    void onImageFile(file).then((image) => { if (image) insertUploaded(image, anchor, replaceEmptyId); })
      .catch(() => onImageReject?.("이미지를 업로드하지 못했습니다. 다시 시도해 주세요."))
      .finally(() => setPendingUpload((pending) => pending?.serial === serial ? null : pending));
  }

  /** 빈 문단을 접기 그룹으로 바꾸고 마지막 그룹 뒤에는 이어 쓸 문단을 둔다. */
  function replaceWithToggle(index: number) {
    if (depth !== 0) return;
    const blocks = [...value.blocks];
    const original = blocks[index];
    const toggle = { ...emptyToggleBlock(value.newline), id: original.id, after: original.after };
    blocks[index] = toggle;
    if (index === blocks.length - 1) {
      toggle.after = value.newline.repeat(2);
      blocks.push({ ...emptyBlock("p", value.newline), after: original.after });
    }
    onChange(ensureBlockBoundaries({ ...value, blocks }));
    setActiveId(null);
    setToggleTitleFocus({ id: toggle.id, serial: (toggleTitleFocus?.serial ?? 0) + 1 });
  }

  /** 선택 블록 뒤에 새 접기 그룹을 넣어 제목부터 입력하게 한다. */
  function addToggle() {
    if (disabled || depth !== 0) return;
    if (!value.blocks.length) {
      const toggle = emptyToggleBlock(value.newline);
      onChange({ ...value, blocks: [toggle, { ...emptyBlock("p", value.newline), after: "" }] });
      setToggleTitleFocus({ id: toggle.id, serial: (toggleTitleFocus?.serial ?? 0) + 1 });
      return;
    }
    const selected = value.blocks.findIndex((block) => block.id === activeId);
    const index = selected >= 0 ? selected : value.blocks.length - 1;
    const previous = value.blocks[index];
    if (previous.type === "p" && !previous.text && !previous.raw) { replaceWithToggle(index); return; }
    const blocks = [...value.blocks];
    const toggle = { ...emptyToggleBlock(value.newline), after: previous.after };
    blocks[index] = { ...previous, after: value.newline.repeat(2) };
    blocks.splice(index + 1, 0, toggle);
    if (index + 1 === blocks.length - 1) {
      toggle.after = value.newline.repeat(2);
      blocks.push({ ...emptyBlock("p", value.newline), after: previous.after });
    }
    onChange(ensureBlockBoundaries({ ...value, blocks }));
    setToggleTitleFocus({ id: toggle.id, serial: (toggleTitleFocus?.serial ?? 0) + 1 });
  }

  /** 접기 wrapper만 없애고 모든 자식 블록을 같은 순서로 상위 문서에 남긴다. */
  function unwrapToggle(index: number) {
    const group = value.blocks[index];
    if (disabled || group.type !== "toggle" || !group.toggle) return;
    const children = group.toggle.inner.blocks.length ? group.toggle.inner.blocks : [emptyBlock("p", value.newline)];
    const moved = children.map((child, position) => position === children.length - 1 ? { ...child, after: group.after } : child);
    const blocks = [...value.blocks];
    blocks.splice(index, 1, ...moved);
    onChange(ensureBlockBoundaries({ ...value, blocks }));
    activate(moved[0].id, 0);
  }

  /** 현재 자식부터 뒤 형제까지 밖으로 빼고 남은 접기·본문의 순서를 유지한다. */
  function outdentFrom(groupIndex: number, childIndex: number) {
    const group = value.blocks[groupIndex];
    if (disabled || group.type !== "toggle" || !group.toggle) return;
    const inner = group.toggle.inner;
    if (childIndex === inner.blocks.length) {
      // 접기 자식의 화면 전용 마지막 줄에서 Shift+Tab을 누르면 바깥쪽 입력 줄로 옮긴다.
      const following = value.blocks[groupIndex + 1];
      if (following?.type === "p" && !following.text && !following.raw) { activate(following.id, 0); return; }
      const added = { ...emptyBlock("p", value.newline), after: group.after };
      const blocks = [...value.blocks];
      blocks[groupIndex] = { ...group, after: value.newline.repeat(2) };
      blocks.splice(groupIndex + 1, 0, added);
      onChange(ensureBlockBoundaries({ ...value, blocks })); activate(added.id, 0); return;
    }
    const moved = inner.blocks.slice(childIndex);
    if (!moved.length) return;
    const kept = inner.blocks.slice(0, childIndex);
    const remaining = kept.length ? kept : [{ ...emptyBlock("p", value.newline), after: "" }];
    const updated = { ...group, dirty: true, after: value.newline.repeat(2), toggle: {
      ...group.toggle, inner: ensureBlockBoundaries({ ...inner, blocks: remaining }),
    } };
    const outside = moved.map((child, position) => position === moved.length - 1 ? { ...child, after: group.after } : child);
    const blocks = [...value.blocks];
    blocks.splice(groupIndex, 1, updated, ...outside);
    onChange(ensureBlockBoundaries({ ...value, blocks }));
    activate(outside[0].id, 0);
  }

  /** 바로 위 접기에 현재 블록 하나를 편입하며 나머지 상위 순서를 유지한다. */
  function indentIntoPrevious(index: number) {
    if (disabled || depth !== 0 || index < 1) return;
    const group = value.blocks[index - 1];
    const current = value.blocks[index];
    if (group.type !== "toggle" || !group.toggle || current.type === "toggle") return;
    const inner = group.toggle.inner;
    const onlyPlaceholder = inner.blocks.length === 1 && inner.blocks[0].type === "p" &&
      !inner.blocks[0].text && !inner.blocks[0].raw;
    const child = { ...current, transient: undefined, after: value.newline.repeat(2) };
    const children = onlyPlaceholder ? [child] : [...inner.blocks, child];
    const updated = { ...group, dirty: true, after: current.after, toggle: {
      ...group.toggle, inner: ensureBlockBoundaries({ ...inner, blocks: children }),
    } };
    const blocks = [...value.blocks];
    blocks.splice(index - 1, 2, updated);
    onChange(ensureBlockBoundaries({ ...value, blocks }));
    setActiveId(null);
    setToggleChildFocus({ toggleId: group.id, id: child.id, offset: 0, serial: (toggleChildFocus?.serial ?? 0) + 1 });
  }

  /** 선택한 블록을 삭제하되 남은 글과 원문 구분자를 보존한다. */
  function removeAt(index: number) {
    const blocks = [...value.blocks];
    const removed = blocks[index];
    if (removed?.transient) { if (index > 0) activate(blocks[index - 1].id); return; }
    if (blocks.length === 1) {
      const replacement = emptyBlock("p", value.newline);
      onChange({ ...value, blocks: [{ ...replacement, after: removed.after }] });
      activate(replacement.id, 0);
      return;
    }
    if (index > 0) blocks[index - 1] = { ...blocks[index - 1], after: removed.after };
    else if (index + 1 < blocks.length) {
      // 문서 시작의 구분자는 첫 블록 앞으로 넘긴다.
      onChange(ensureBlockBoundaries({ ...value, head: value.head + removed.after, blocks: blocks.slice(1) }));
      activate(blocks[1].id, 0);
      return;
    }
    blocks.splice(index, 1);
    onChange(ensureBlockBoundaries({ ...value, blocks }));
    activate(blocks[Math.max(0, index - 1)].id);
  }

  /** 커서·조합 상태를 확인해 수식·도식 생성과 개행·블록 이동을 원문 손실 없이 처리한다. */
  function handleKey(event: KeyboardEvent<HTMLTextAreaElement>, block: EditorBlock, index: number) {
    if (disabled) return;
    if (isComposing(event)) return;
    const input = event.currentTarget;
    const prefixLength = sourcePrefix(block).length;
    const startInInput = input.selectionStart;
    const endInInput = input.selectionEnd;
    const start = Math.max(0, startInInput - prefixLength);
    const end = Math.max(0, endInInput - prefixLength);
    const text = prefixLength ? block.text : input.value;
    if (event.key === "Escape") { event.preventDefault(); setActiveId(null); setFocusTarget({ id: block.id, offset: 0 }); return; }
    if (event.key === "Tab" && !event.ctrlKey && !event.altKey && !event.metaKey) {
      if (event.shiftKey && depth === 1 && onOutdentFrom) { event.preventDefault(); onOutdentFrom(index); return; }
      if (!event.shiftKey && depth === 0 && value.blocks[index - 1]?.type === "toggle" && block.type !== "toggle") {
        event.preventDefault(); indentIntoPrevious(index); return;
      }
    }
    if (event.key === " " && block.type === "p" && start === end && end === text.length) {
      if (text === ">" && depth === 0) { event.preventDefault(); replaceWithToggle(index); return; }
      const type = shortcuts[text];
      if (type) { event.preventDefault(); edit(block.id, (old) => ({ ...old, type, text: "", dirty: true })); activate(block.id, 0); return; }
    }
    if (event.key === "Enter" && !event.shiftKey && !event.altKey) {
      if (prefixLength && startInInput < prefixLength) {
        event.preventDefault();
        const blocks = [...value.blocks];
        const added = { ...emptyBlock("p", value.newline), after: value.newline.repeat(2) };
        blocks.splice(index, 0, added);
        onChange(ensureBlockBoundaries({ ...value, blocks })); activate(added.id, 0); return;
      }
      if (block.type === "p" && depth === 0 && start === end && end === text.length &&
        (text === "/접기" || text === "/toggle")) {
        event.preventDefault(); replaceWithToggle(index); return;
      }
      if (depth === 1 && block.type === "p" && !text && start === end && onOutdentFrom) {
        event.preventDefault(); onOutdentFrom(index); return;
      }
      if (block.type === "p" && start === end && end === text.length && (text === "/표" || text === "/table")) {
        event.preventDefault(); replaceWithTable(index); return;
      }
      const headers = block.type === "p" && start === end && end === text.length ? parsePipeHeaderCommand(text) : null;
      if (headers && headers.length <= TABLE_MAX_COLUMNS && headers.every((header) => header.length <= TABLE_MAX_CELL_LENGTH)) {
        event.preventDefault(); replaceWithTable(index, headers); return;
      }
      if (block.type === "code" || block.type === "math" || block.type === "mermaid") {
        if (event.ctrlKey || event.metaKey) { event.preventDefault(); insertAfter(index, "p"); }
        return;
      }
      if (event.ctrlKey || event.metaKey) return;
      if (block.transient && !text && start === end) {
        event.preventDefault();
        // 가상 줄에서 누른 Enter는 실제 빈 문단을 한 개 남기고 새 가상 줄로 이동한다.
        const blocks = value.blocks.map((item) => item.id === block.id ?
          { ...item, transient: undefined, intentionalBlank: true, after: "" } : item);
        onChange(ensureBlockBoundaries({ ...value, blocks }));
        const next = latest.current.blocks.at(-1);
        if (next?.transient) activate(next.id, 0);
        return;
      }
      if (block.type === "p" && start === end && text === "---") {
        event.preventDefault();
        const blocks = [...value.blocks];
        blocks[index] = { ...block, type: "hr", text: "", dirty: true, after: value.newline.repeat(2) };
        const next = { ...emptyBlock("p", value.newline), after: block.after };
        blocks.splice(index + 1, 0, next);
        onChange(ensureBlockBoundaries({ ...value, blocks })); activate(next.id, 0); return;
      }
      if (block.type === "p" && start === end && end === text.length && text === "$$") {
        event.preventDefault(); edit(block.id, (old) => ({ ...old, type: "math", text: "", dirty: true }));
        activate(block.id, 0); return;
      }
      if (block.type === "p" && start === end && end === text.length && text === "```mermaid") {
        event.preventDefault(); edit(block.id, (old) => ({ ...old, type: "mermaid", lang: "mermaid", text: "",
          codeFence: { character: "`", length: 3, openingIndent: "", closingIndent: "" }, dirty: true }));
        activate(block.id, 0); return;
      }
      const codeCommand = /^```([A-Za-z0-9_-]{0,32})$/.exec(text);
      if (block.type === "p" && !event.ctrlKey && !event.metaKey && start === end && end === text.length &&
        codeCommand && codeCommand[0] === text &&
        codeCommand[1].toLowerCase() !== "mermaid") {
        event.preventDefault(); edit(block.id, (old) => ({ ...old, type: "code", lang: codeCommand[1], text: "",
          codeFence: { character: "`", length: 3, openingIndent: "", closingIndent: "" }, dirty: true }));
        activate(block.id, 0); return;
      }
      if (!block.transient && ["p", "h1", "h2", "h3", "quote"].includes(block.type) &&
        start === end && end === text.length && value.blocks[index + 1]?.transient) {
        event.preventDefault(); activate(value.blocks[index + 1].id, 0); return;
      }
      event.preventDefault();
      if (["ul", "ol", "todo"].includes(block.type) && !text) {
        edit(block.id, (old) => ({ ...old, type: "p", dirty: true })); activate(block.id, 0); return;
      }
      const before = text.slice(0, start);
      const after = text.slice(end);
      const nextType = ["ul", "ol", "todo"].includes(block.type) ? block.type : "p";
      const blocks = [...value.blocks];
      blocks[index] = { ...block, text: before, dirty: true,
        after: nextType === block.type && nextType !== "p" ? value.newline : value.newline.repeat(2) };
      const added = { ...emptyBlock(nextType, value.newline), text: after, after: block.after,
        ordinal: nextType === "ol" ? (block.ordinal ?? 1) + 1 : undefined, done: false };
      blocks.splice(index + 1, 0, added);
      onChange(ensureBlockBoundaries({ ...value, blocks })); activate(added.id, 0); return;
    }
    if (event.key === "Enter" && event.shiftKey && block.type !== "p" && block.type !== "code" && block.type !== "math" && block.type !== "mermaid") {
      event.preventDefault(); return;
    }
    if (event.key === "Backspace" && start === 0 && end === 0 && startInInput === endInInput) {
      if (prefixLength && startInInput > 0 && startInInput < prefixLength) return;
      if (block.type !== "p" && block.type !== "code" && block.type !== "math" && block.type !== "mermaid") {
        event.preventDefault(); edit(block.id, (old) => ({ ...old, type: "p", dirty: true })); activate(block.id, 0); return;
      }
      // 수식·도식은 삭제 버튼으로만 제거해 시작 경계에서 조용히 문단으로 바꾸지 않는다.
      if (block.type === "math" || block.type === "mermaid") { event.preventDefault(); return; }
      if (block.type === "code") return;
      if (!text) { event.preventDefault(); if (index > 0) removeAt(index); return; }
      if (index > 0) {
        event.preventDefault();
        const previous = value.blocks[index - 1];
        if (["raw", "code", "math", "mermaid", "hr", "table", "toggle", "image"].includes(previous.type)) { activate(previous.id); return; }
        const joined = previous.text + text;
        const blocks = [...value.blocks];
        blocks[index - 1] = { ...previous, text: joined, dirty: true, after: block.after };
        blocks.splice(index, 1);
        onChange(ensureBlockBoundaries({ ...value, blocks })); activate(previous.id, previous.text.length);
      }
      return;
    }
    if (event.key === "ArrowUp" && start === 0 && end === 0 && index > 0) {
      event.preventDefault(); activate(value.blocks[index - 1].id); return;
    }
    if (event.key === "ArrowDown" && start === text.length && end === start && index + 1 < value.blocks.length) {
      event.preventDefault(); activate(value.blocks[index + 1].id, 0);
    }
  }

  /** 현재 편집기 직속 블록의 위치를 기억해 {@link moveEditorBlocks} 후 이동 애니메이션을 계산한다. */
  function rememberPositions() {
    beforeMove.current = new Map([...root.current?.querySelectorAll<HTMLElement>(":scope > .editor-block") ?? []]
      .map((element) => [element.dataset.blockId ?? "", element.getBoundingClientRect()]));
  }

  /** 선택 ID를 원래 순서대로 하나의 묶음으로 옮기고 최종 위치를 강조한다. {@link moveEditorBlocks} */
  function reorder(ids: readonly string[], boundaryIndex: number) {
    if (disabled) return;
    const current = withoutTrailing(latest.current);
    const moving = current.blocks.filter((block) => ids.includes(block.id)).map((block) => block.id);
    const next = moveEditorBlocks(current, moving, Math.min(boundaryIndex, current.blocks.length));
    setDropSlot(null);
    if (!next) return;
    rememberPositions();
    latest.current = next;
    onChange(next);
    setSelectedIds(new Set(moving));
    setFlashIds(new Set(moving));
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlashIds(new Set()), 800);
  }

  /** 손잡이의 키보드 명령은 선택 묶음 또는 해당 블록 하나를 한 칸 이동한다. {@link reorder} */
  function move(from: number, to: number) {
    if (disabled || from === to || from < 0 || from >= value.blocks.length) return;
    const id = value.blocks[from].id;
    if (value.blocks[from].transient) return;
    const ids = selectedIds.has(id) ? [...selectedIds] : [id];
    const actual = withoutTrailing(value).blocks;
    const positions = actual.flatMap((block, index) => ids.includes(block.id) ? [index] : []);
    const first = Math.min(...positions);
    const nextUnselected = actual.findIndex((block, index) => index > first && !ids.includes(block.id));
    const boundary = to < from ? first - 1 : nextUnselected < 0 ? -1 : nextUnselected + 1;
    if (boundary < 0 || boundary > actual.length) return;
    selectionAnchor.current = id;
    reorder(ids, boundary);
  }

  /** 손잡이 Shift 범위·Ctrl/⌘ 개별 선택을 현재 {@link BlockEditor}의 형제 블록으로 제한한다. */
  function selectHandle(event: MouseEvent<HTMLButtonElement>, id: string, index: number) {
    if (event.shiftKey) {
      const anchorIndex = value.blocks.findIndex((block) => block.id === selectionAnchor.current);
      const start = anchorIndex < 0 ? index : Math.min(anchorIndex, index);
      const end = anchorIndex < 0 ? index : Math.max(anchorIndex, index);
      setSelectedIds(new Set(value.blocks.slice(start, end + 1).map((block) => block.id)));
      if (anchorIndex < 0) selectionAnchor.current = id;
    } else if (event.ctrlKey || event.metaKey ||
      event.detail > 0 && handlePointerType.current === "touch" && selectedIds.size > 0) {
      setSelectedIds((current) => { const next = new Set(current);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next; });
      selectionAnchor.current = id;
    } else {
      setSelectedIds(new Set([id]));
      selectionAnchor.current = id;
    }
  }

  /** 선택된 블록 수와 첫 내용을 보여 주는 브라우저 드래그 고스트를 만든다. {@link blockNames} */
  function showDragGhost(event: DragEvent<HTMLElement>, ids: readonly string[]) {
    const first = value.blocks.find((block) => block.id === ids[0]);
    const ghost = document.createElement("div");
    ghost.className = "editor-drag-ghost";
    const label = document.createElement("strong");
    label.textContent = ids.length === 1 ? `${blockNames[first?.type ?? "p"]} 블록 이동` : `${ids.length}개 블록 함께 이동`;
    const preview = document.createElement("span");
    preview.textContent = first?.type === "image" ? first.image?.caption || "이미지" :
      first?.text.slice(0, 68) || first?.raw.slice(0, 68) || "빈 블록";
    ghost.append(label, preview);
    document.body.append(ghost);
    event.dataTransfer.setDragImage(ghost, 18, 16);
    requestAnimationFrame(() => ghost.remove());
  }

  /** 손잡이나 실제 이미지에서 시작한 끌기를 동일한 {@link DRAG_FORMAT} 블록 이동으로 통일한다. */
  function beginDrag(event: DragEvent<HTMLElement>, id: string) {
    if (disabled) { event.preventDefault(); return; }
    const ids = selectedIds.has(id) ? value.blocks.filter((item) => selectedIds.has(item.id)).map((item) => item.id) : [id];
    dragIds.current = ids;
    if (!selectedIds.has(id)) { setSelectedIds(new Set(ids)); selectionAnchor.current = id; }
    event.dataTransfer.setData(DRAG_FORMAT, editorToken);
    event.dataTransfer.effectAllowed = "move";
    showDragGhost(event, ids);
  }

  /** 현재 {@link BlockEditor}에서 시작한 블록 또는 외부 이미지 파일만 드롭 위치 미리보기에 허용한다. */
  function dragKind(event: DragEvent<HTMLElement>): DropSlot["kind"] | null {
    if (event.dataTransfer.types.includes(DRAG_FORMAT)) return dragIds.current.length ? "blocks" : null;
    if (event.dataTransfer.types.includes("Files")) return "file";
    return null;
  }

  /** 블록 사이 빈 공간에서도 포인터와 가장 가까운 {@link DropSlot} 경계를 고른다. */
  function slotAt(clientY: number, kind: DropSlot["kind"]): DropSlot {
    for (const element of root.current?.querySelectorAll<HTMLElement>(":scope > .editor-block") ?? []) {
      const rect = element.getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) return { targetId: element.dataset.blockId ?? null, side: "before", kind };
    }
    return { targetId: null, side: "end", kind };
  }

  /** 블록 윗·아랫반의 실제 삽입 경계와 파일·블록 종류를 표시한다. {@link DropSlot} */
  function hoverBlock(event: DragEvent<HTMLDivElement>, id: string) {
    const kind = dragKind(event);
    if (!kind) {
      if (event.dataTransfer.types.includes(DRAG_FORMAT)) {
        event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = "none";
      }
      return;
    }
    if (disabled || kind === "file" && !onImageFile) {
      if (kind === "file") { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = "none"; }
      return;
    }
    event.preventDefault(); event.stopPropagation();
    event.dataTransfer.dropEffect = kind === "file" ? "copy" : "move";
    if (kind === "blocks" && dragIds.current.includes(id)) { setDropSlot(null); return; }
    const rect = event.currentTarget.getBoundingClientRect();
    const side = event.clientY < rect.top + rect.height / 2 ? "before" : "after";
    setDropSlot((current) => current?.targetId === id && current.side === side && current.kind === kind ? current :
      { targetId: id, side, kind });
  }

  /** 파일은 ID 경계에 업로드하고 블록은 같은 편집기 토큰일 때만 옮긴다. {@link DropSlot} */
  function dropOn(event: DragEvent<HTMLElement>, slot: DropSlot) {
    event.preventDefault(); event.stopPropagation();
    setDropSlot(null);
    if (disabled) return;
    if (event.dataTransfer.types.includes(DRAG_FORMAT)) {
      const ids = dragIds.current;
      dragIds.current = [];
      if (!ids.length || event.dataTransfer.getData(DRAG_FORMAT) !== editorToken) return;
      if (slot.targetId && ids.includes(slot.targetId)) return;
      reorder(ids, slotIndex(latest.current, slot));
      return;
    }
    if (event.dataTransfer.files.length) {
      dragIds.current = [];
      if (event.dataTransfer.files.length !== 1) { onImageReject?.("이미지는 한 번에 한 파일씩 올려 주세요."); return; }
      acceptImageFile(event.dataTransfer.files[0], slot); return;
    }
  }

  /** {@link BlockEditor} 내부 빈 여백과 글쓰기 페이지 좌우 여백의 마우스 박스 선택을 시작한다.
   * 본문 글자·메타 입력·손잡이를 제외하고 `selectedIds`와 `selectionAnchor`를 함께 갱신한다. */
  function startBoxSelection(event: ReactPointerEvent<HTMLDivElement> | globalThis.PointerEvent, pageMargin = false) {
    const editor = root.current;
    if (!editor || disabled || composing.current || event.pointerType !== "mouse" || event.button !== 0 ||
      event.shiftKey || event.ctrlKey || event.metaKey || event.altKey || marqueeCleanup.current) return;
    const target = event.target;
    if (!(target instanceof Element) || !pageMargin && target.closest(".block-editor") !== editor ||
      target.closest(".editor-selection-bar, .block-controls, button, input, textarea, select, [contenteditable]")) return;
    if (pageMargin) {
      const page = editor.closest<HTMLElement>("main.write-page.editor-design-page");
      const surface = editor.closest<HTMLElement>(".write-surface");
      const bounds = editor.getBoundingClientRect();
      if (!page || target !== page && target !== surface ||
        event.clientX >= bounds.left && event.clientX <= bounds.right ||
        event.clientY < bounds.top || event.clientY > bounds.bottom) return;
    } else {
      const block = target.closest<HTMLElement>(".editor-block");
      const gutter = target.closest(".editor-box-gutter");
      if (block && (block.parentElement !== editor || !gutter && (
        event.clientX < block.getBoundingClientRect().left ||
        event.clientX >= block.getBoundingClientRect().left + 12))) return;
      if (!block && target !== editor && !target.closest(".editor-click-below")) return;
      event.preventDefault();
    }
    cancelAnimationFrame(marqueeFocusFrame.current);
    setKeepSelectionBarSpace(selectedIds.size > 0);
    const pointerId = event.pointerId;
    const startX = event.clientX + window.scrollX;
    const startY = event.clientY + window.scrollY;
    let clientX = event.clientX;
    let clientY = event.clientY;
    let selecting = false;
    let selectedBlockIds: string[] = [];
    let frame = 0;

    /** 문서 좌표의 선택 사각형과 직속 블록의 교차를 다시 계산한다. */
    const update = () => {
      const pageX = clientX + window.scrollX;
      const pageY = clientY + window.scrollY;
      if (!selecting && Math.hypot(pageX - startX, pageY - startY) < 5) return;
      selecting = true;
      window.getSelection()?.removeAllRanges();
      const left = Math.min(startX, pageX);
      const right = Math.max(startX, pageX);
      const top = Math.min(startY, pageY);
      const bottom = Math.max(startY, pageY);
      const bounds = editor.getBoundingClientRect();
      setSelectionBox({ left: pageMargin ? bounds.left : left - window.scrollX, top: top - window.scrollY,
        width: pageMargin ? bounds.width : Math.max(1, right - left), height: Math.max(1, bottom - top) });
      const ids = [...editor.querySelectorAll<HTMLElement>(":scope > .editor-block:not([data-transient='true'])")].flatMap((element) => {
        const rect = element.getBoundingClientRect();
        const gutterRect = element.querySelector<HTMLElement>(":scope > .editor-box-gutter")?.getBoundingClientRect();
        const hitLeft = gutterRect?.width ? Math.min(rect.left, gutterRect.left) : rect.left;
        return (pageMargin || hitLeft + window.scrollX <= right && rect.right + window.scrollX >= left) &&
          rect.top + window.scrollY <= bottom && rect.bottom + window.scrollY >= top ?
          [element.dataset.blockId ?? ""] : [];
      }).filter(Boolean);
      selectedBlockIds = ids;
      selectionAnchor.current = ids[0] ?? null;
      setSelectedIds((current) => current.size === ids.length && ids.every((id) => current.has(id)) ? current : new Set(ids));
    };

    /** 화면 가장자리에서 문서를 움직이고 같은 포인터 위치로 선택 범위를 확장한다. */
    const autoScroll = () => {
      if (selecting) {
        const edge = 48;
        const distance = clientY < edge ? clientY - edge : clientY > window.innerHeight - edge ?
          clientY - (window.innerHeight - edge) : 0;
        if (distance) {
          const before = window.scrollY;
          window.scrollBy(0, Math.max(-20, Math.min(20, distance / 2)));
          if (window.scrollY !== before) update();
        }
      }
      frame = requestAnimationFrame(autoScroll);
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", escape);
      window.removeEventListener("blur", cancel);
      cancelAnimationFrame(frame);
      marqueeCleanup.current = null;
    };
    const move = (moveEvent: globalThis.PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      clientX = moveEvent.clientX; clientY = moveEvent.clientY;
      if (selecting) moveEvent.preventDefault();
      update();
    };
    const finish = (upEvent: globalThis.PointerEvent) => {
      if (upEvent.pointerId !== pointerId) return;
      if (selecting) {
        suppressMarqueeClick.current = true;
        if (suppressMarqueeClickTimer.current) clearTimeout(suppressMarqueeClickTimer.current);
        suppressMarqueeClickTimer.current = setTimeout(() => { suppressMarqueeClick.current = false; }, 0);
        const firstId = selectedBlockIds[0];
        if (firstId) marqueeFocusFrame.current = requestAnimationFrame(() => {
          const first = [...(root.current?.querySelectorAll<HTMLElement>(":scope > .editor-block") ?? [])]
            .find((element) => element.dataset.blockId === firstId);
          first?.querySelector<HTMLButtonElement>(":scope > .block-controls .drag-handle")?.focus({ preventScroll: true });
        });
      }
      cleanup(); setSelectionBox(null); setKeepSelectionBarSpace(false);
    };
    const cancel = () => { cleanup(); setSelectionBox(null); setKeepSelectionBarSpace(false); };
    const escape = (keyEvent: globalThis.KeyboardEvent) => {
      if (keyEvent.key !== "Escape") return;
      keyEvent.preventDefault();
      cancel(); setSelectedIds(new Set()); selectionAnchor.current = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", escape);
    window.addEventListener("blur", cancel);
    frame = requestAnimationFrame(autoScroll);
    marqueeCleanup.current = cleanup;
  }

  /** 최상위 편집기만 페이지 좌우 여백의 시작 포인터를 받아 내부 {@link startBoxSelection}과 공유한다. */
  useEffect(() => {
    if (depth !== 0) return;
    const down = (event: globalThis.PointerEvent) => { startBoxSelection(event, true); };
    document.addEventListener("pointerdown", down, true);
    return () => document.removeEventListener("pointerdown", down, true);
  }, [depth, disabled, selectedIds.size]);

  return <div className="block-editor" aria-label="글 본문 편집기" ref={root}
    onClickCapture={(event) => { if (suppressMarqueeClick.current) {
      event.preventDefault(); event.stopPropagation(); suppressMarqueeClick.current = false;
    } }}
    onFocusCapture={(event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || target.closest(".block-editor") !== event.currentTarget) return;
      if (target instanceof HTMLTextAreaElement && target.dataset.annotationBlockId)
        captureAnnotationSelectionFrom(target);
    }}
    onPointerDownCapture={(event) => {
      if ((event.target as Element).closest(".block-editor") === event.currentTarget)
        clearAnnotationSelectionForInput(event.target);
      startBoxSelection(event);
    }}
    onKeyDownCapture={(event) => {
      if (event.key === "Escape" && selectedIds.size &&
        (event.target as Element).closest(".block-editor") === event.currentTarget) {
        setSelectedIds(new Set()); selectionAnchor.current = null;
      }
      if (event.key !== "Tab" && (event.target as Element).closest(".block-editor") === event.currentTarget)
        clearAnnotationSelectionForInput(event.target);
    }}
    onInputCapture={(event) => {
      if ((event.target as Element).closest(".block-editor") === event.currentTarget)
        clearAnnotationSelectionForInput(event.target);
    }}
    onPasteCapture={(event: ClipboardEvent<HTMLDivElement>) => {
      if ((event.target as Element).closest(".block-editor") !== event.currentTarget) return;
      const file = Array.from(event.clipboardData.files).find((item) => item.type.startsWith("image/"));
      if (file && !disabled && onImageFile) { event.preventDefault(); event.stopPropagation();
        if (event.clipboardData.files.length !== 1) { onImageReject?.("이미지는 한 번에 한 파일씩 붙여넣어 주세요."); return; }
        const id = (event.target as Element).closest<HTMLElement>(".editor-block")?.dataset.blockId ?? activeId;
        acceptImageFile(file, id ? { targetId: id, side: "after", kind: "file" } : null); }
    }}
    onDragOver={(event) => { const kind = dragKind(event);
      if (!kind) {
        if (event.dataTransfer.types.includes(DRAG_FORMAT)) {
          event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = "none";
        }
        return;
      }
      if (disabled || kind === "file" && !onImageFile) {
        if (kind === "file") { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = "none"; }
        return;
      }
      event.preventDefault(); event.stopPropagation();
      event.dataTransfer.dropEffect = kind === "file" ? "copy" : "move";
      const slot = slotAt(event.clientY, kind);
      setDropSlot((current) => current?.targetId === slot.targetId && current.side === slot.side && current.kind === kind ? current : slot);
    }}
    onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropSlot(null); }}
    onDrop={(event) => dropOn(event, slotAt(event.clientY, dragKind(event) ?? "file"))}>
    {selectionBox && <div className="editor-selection-box" style={selectionBox} aria-hidden="true" />}
    {(selectedIds.size > 0 && !selectionBox || selectionBox && keepSelectionBarSpace) &&
      <div className={`editor-selection-bar${selectionBox ? " editor-selection-bar-hidden" : ""}`} role="status">
      <span>{selectedIds.size}개 블록 선택됨 · 손잡이로 함께 이동</span>
      <button type="button" onClick={() => { setSelectedIds(new Set()); selectionAnchor.current = null; }}>선택 해제</button>
    </div>}
    {pendingUpload && <span className="sr-only" role="status">이미지 업로드 중 · 표시한 삽입 위치에 추가됩니다</span>}
    {value.blocks.map((block, index) => <div key={block.id} data-block-id={block.id}
      data-transient={block.transient ? "true" : undefined}
      data-drop-side={dropSlot?.targetId === block.id ? dropSlot.side : undefined}
      data-upload-before={pendingUpload && resolveBlockInsertion(value, pendingUpload.anchor) === index ? "true" : undefined}
      className={`editor-block editor-${block.type}${selectedIds.has(block.id) ? " editor-block-selected" : ""}${flashIds.has(block.id) ? " editor-block-flash" : ""}`}
      onDragStart={(event) => {
        if (block.type === "image" && event.target instanceof Element && event.target.closest("img")) {
          event.stopPropagation(); beginDrag(event, block.id);
        }
      }}
      onDragEnd={(event) => { if (block.type === "image" && event.target instanceof Element && event.target.closest("img")) {
        event.stopPropagation(); dragIds.current = []; setDropSlot(null);
      } }}
      onDragOver={(event) => hoverBlock(event, block.id)}
      onDrop={(event) => { const rect = event.currentTarget.getBoundingClientRect();
        dropOn(event, { targetId: block.id, side: event.clientY < rect.top + rect.height / 2 ? "before" : "after",
          kind: dragKind(event) ?? "file" }); }}>
      {depth === 0 && <div className="editor-box-gutter" aria-hidden="true" />}
      <div className={`block-controls${depth === 1 || (depth === 0 && index > 0 && value.blocks[index - 1].type === "toggle") ? " block-controls-transfer" : ""}`}
        aria-label={`${index + 1}번 블록 이동`}>
        {!block.transient && <button type="button" className="drag-handle" disabled={disabled} draggable={!disabled}
          aria-pressed={selectedIds.has(block.id)}
          onPointerDown={(event) => { handlePointerType.current = event.pointerType; }}
          onClick={(event) => selectHandle(event, block.id, index)}
          onKeyDown={(event) => {
            if (event.key === "Escape") { event.preventDefault(); setSelectedIds(new Set()); selectionAnchor.current = null; }
            if (event.altKey && event.key === "ArrowUp") { event.preventDefault(); move(index, index - 1); }
            if (event.altKey && event.key === "ArrowDown") { event.preventDefault(); move(index, index + 1); }
          }} onDragStart={(event) => {
          event.stopPropagation();
          beginDrag(event, block.id);
        }} onDragEnd={(event) => {
          event.stopPropagation(); dragIds.current = []; setDropSlot(null);
        }} aria-label={`${index + 1}번 블록 선택 또는 끌어 이동`}>⋮⋮</button>}
        {depth === 1 && onOutdentFrom && <button type="button" disabled={disabled} onClick={() => onOutdentFrom(index)}
          aria-label={`${index + 1}번 블록부터 접기 밖으로 빼기`}>↤</button>}
        {depth === 0 && index > 0 && value.blocks[index - 1].type === "toggle" && block.type !== "toggle" &&
          <button type="button" disabled={disabled} onClick={() => indentIntoPrevious(index)}
            aria-label={`${index + 1}번 블록을 위 접기 안으로 넣기`}>↦</button>}
      </div>
      {block.type === "toggle" && block.toggle && depth === 0 ? <ToggleBlock id={block.id} title={block.text} disabled={disabled}
        focusTitle={toggleTitleFocus?.id === block.id ? toggleTitleFocus.serial : 0}
        rootRef={(node) => { if (node) refs.current.set(block.id, node); else refs.current.delete(block.id); }}
        onTitle={(title) => edit(block.id, (old) => ({ ...old, text: title, dirty: true }))}
        onTitleEnter={() => {
          const inner = block.toggle?.inner;
          if (!block.text && inner && !inner.blocks.some((child) => blockMarkdown(child, inner.newline).trim())) {
            unwrapToggle(index); return;
          }
          if (inner && !inner.blocks.length) edit(block.id, (old) => old.toggle ? { ...old, dirty: true,
            toggle: { ...old.toggle, inner: { ...old.toggle.inner,
              blocks: [{ ...emptyBlock("p", inner.newline), after: "" }] } } } : old);
          setToggleFirstFocus({ id: block.id, serial: (toggleFirstFocus?.serial ?? 0) + 1 });
        }}
        onUnwrap={() => unwrapToggle(index)} onDelete={() => removeAt(index)}
        moveAbove={() => { if (index > 0) activate(value.blocks[index - 1].id); }}
        moveBelow={() => { if (index + 1 < value.blocks.length) activate(value.blocks[index + 1].id, 0); }}>
        <BlockEditor value={block.toggle.inner} disabled={disabled} depth={1}
          annotationController={annotation} annotationPreview={annotationPreview} annotationSessionKey={annotationSessionKey}
          onImageFile={onImageFile} onImageReject={onImageReject}
          focusFirstSignal={toggleFirstFocus?.id === block.id ? toggleFirstFocus.serial : 0}
          focusBlock={toggleChildFocus?.toggleId === block.id ? { id: toggleChildFocus.id, offset: toggleChildFocus.offset,
            serial: toggleChildFocus.serial } : undefined}
          onChange={(inner) => edit(block.id, (old) => old.toggle ? { ...old, dirty: true,
            toggle: { ...old.toggle, inner } } : old)}
          onOutdentFrom={(childIndex) => outdentFrom(index, childIndex)} />
      </ToggleBlock> :
      block.type === "table" && block.table ? <TableBlock value={block.table} disabled={disabled}
        focusFirst={tableFocus?.id === block.id ? tableFocus.serial : 0}
        rootRef={(node) => { if (node) refs.current.set(block.id, node); else refs.current.delete(block.id); }}
        onChange={(table) => edit(block.id, (old) => ({ ...old, table, dirty: true }))}
        onDelete={() => removeAt(index)}
        moveAbove={() => { if (index > 0) activate(value.blocks[index - 1].id); }}
        moveBelow={() => { if (index + 1 < value.blocks.length) activate(value.blocks[index + 1].id, 0); }} /> :
      block.type === "image" && block.image ? <ImageBlock image={block.image} disabled={disabled}
        rootRef={(node) => { if (node) refs.current.set(block.id, node); else refs.current.delete(block.id); }}
        onChange={(image) => edit(block.id, (old) => ({ ...old, image, dirty: true }))}
        onDelete={() => removeAt(index)}
        moveAbove={() => { if (index > 0) activate(value.blocks[index - 1].id); }}
        moveBelow={() => { if (index + 1 < value.blocks.length) activate(value.blocks[index + 1].id, 0); }} /> :
      block.type === "raw" ? <div className="editor-raw" tabIndex={0} role="group"
        aria-label="원문 보존 블록. 위아래 화살표로 이웃 블록 이동"
        ref={(node) => { if (node) refs.current.set(block.id, node); }}
        onKeyDown={(event) => { if (event.target !== event.currentTarget) return;
          if (event.key === "ArrowUp" && index > 0) { event.preventDefault(); activate(value.blocks[index - 1].id); }
          if (event.key === "ArrowDown" && index + 1 < value.blocks.length) { event.preventDefault(); activate(value.blocks[index + 1].id, 0); } }}>
        <strong>원문 보존 · 이 형식은 아직 편집할 수 없습니다</strong>
        <pre tabIndex={0} role="group" aria-label={`${index + 1}번 원문 내용, 스크롤 가능`}>{block.raw}</pre></div> :
        block.type === "hr" ? <button type="button" className="editor-rule" ref={(node) => { if (node) refs.current.set(block.id, node); }}
          disabled={disabled} onKeyDown={(event) => { if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); removeAt(index); }
            if (event.key === "ArrowUp" && index > 0) { event.preventDefault(); activate(value.blocks[index - 1].id); }
            if (event.key === "ArrowDown" && index + 1 < value.blocks.length) { event.preventDefault(); activate(value.blocks[index + 1].id, 0); } }}
          aria-label="구분선 블록. Delete 키로 삭제">────────</button> :
          activeId === block.id ? <div className="block-input-wrap">
            {block.type === "code" && <div className="editor-code-options">
              <label htmlFor={`${block.id}-language`}>코드 언어</label>
              <CodeLanguagePicker id={`${block.id}-language`}
                value={block.lang ?? ""} disabled={disabled} aria-invalid={languageError?.id === block.id}
                aria-describedby={languageError?.id === block.id ? `${block.id}-language-error` : undefined}
                onChange={(language) => changeCodeLanguage(block.id, language)}
                onEditorKeyDown={(event) => {
                  if (event.nativeEvent.isComposing) return;
                  if (event.key === "Escape") {
                    event.preventDefault(); setActiveId(null); setFocusTarget({ id: block.id, offset: 0 });
                  } else if (event.key === "Enter") {
                    event.preventDefault();
                    if (event.ctrlKey || event.metaKey) insertAfter(index, "p");
                    else refs.current.get(block.id)?.focus();
                  }
                }} />
              {languageError?.id === block.id && <span id={`${block.id}-language-error`} className="editor-code-error" role="alert">
                {languageError.message}</span>}
            </div>}
            {block.type === "code" && <label htmlFor={`${block.id}-text`}>코드 내용</label>}
            {block.type === "math" && <label htmlFor={`${block.id}-text`}>수식 원문</label>}
            {block.type === "mermaid" && <label htmlFor={`${block.id}-text`}>Mermaid 도식 원문</label>}
            <textarea id={`${block.id}-text`} ref={(node) => { if (node) refs.current.set(block.id, node); }}
              data-annotation-block-id={ANNOTATION_TEXT_TYPES.has(block.type) ? block.id : undefined}
              aria-label={`${index + 1}번 ${blockNames[block.type]} 블록`} rows={Math.max(1, block.text.split("\n").length)}
              value={visibleBlockText(block)} disabled={disabled} placeholder={block.type === "p" ? "내용을 입력하세요" : "블록 내용을 입력하세요"}
              onChange={(event) => {
                const nextText = event.target.value;
                const shortcut = block.type === "p" && !composing.current && nextText.endsWith(" ") ?
                  shortcuts[nextText.slice(0, -1)] : undefined;
                const parsed = shortcut ? { type: shortcut, text: "" } : parseActiveSource(block, nextText);
                if (ANNOTATION_TEXT_TYPES.has(parsed.type)) {
                  const prefix = sourcePrefix({ ...block, ...parsed }).length;
                  annotation.selection = { id: block.id,
                    start: Math.max(0, event.currentTarget.selectionStart - prefix),
                    end: Math.max(0, event.currentTarget.selectionEnd - prefix), expectedText: parsed.text };
                }
                edit(block.id, (old) => ({ ...old, ...parsed, dirty: true }));
              }}
              onSelect={(event) => captureAnnotationSelectionFrom(event.currentTarget)}
              onKeyUp={(event) => captureAnnotationSelectionFrom(event.currentTarget)}
              onPointerUp={(event) => captureAnnotationSelectionFrom(event.currentTarget)}
              onCompositionStart={() => { composing.current = true; annotation.composing = true; annotation.selection = null; }}
              onCompositionEnd={() => { compositionTimer.current = setTimeout(() => {
                composing.current = false; annotation.composing = false;
                const input = refs.current.get(block.id);
                if (!(input instanceof HTMLTextAreaElement) || block.type !== "p" || !input.value.endsWith(" ")) return;
                const type = shortcuts[input.value.slice(0, -1)];
                if (type) edit(block.id, (old) => ({ ...old, type, text: "", dirty: true }));
              }, 0); }}
              onKeyDown={(event) => handleKey(event, block, index)} />
            {block.type === "math" && <div className="editor-math-actions">
              <button type="button" disabled={disabled} onClick={() => {
                if (window.confirm("수식 블록과 내용을 삭제할까요?")) removeAt(index);
              }}>수식 삭제</button>
            </div>}
            {block.type === "mermaid" && <div className="editor-mermaid-actions">
              <button type="button" disabled={disabled} onClick={() => {
                if (window.confirm("도식 블록과 내용을 삭제할까요?")) removeAt(index);
              }}>도식 삭제</button>
            </div>}
          </div> : <div className="editor-preview">
            <div inert={!annotationPreview?.byBlock.get(block.id)?.length}>{block.type === "p" && !block.text && !block.raw ?
              <span className="editor-empty-placeholder">내용을 입력하세요</span> :
              block.type === "math" && !block.text ?
              <span className="editor-math-empty">빈 수식 · 클릭하여 편집</span> :
              block.type === "mermaid" && !block.text ?
              <span className="editor-mermaid-empty">빈 도식 · 클릭하여 편집</span> :
              <SafeMarkdown body={blockMarkdown(block, value.newline)} source={{ kind: "admin" }}
                annotationMode={annotationPreview?.byBlock.get(block.id)?.length ? "editor" : "literal"}
                annotationRefs={annotationPreview?.byBlock.get(block.id)} />}</div>
            <button type="button" className="editor-preview-trigger" disabled={disabled} ref={(node) => { if (node) refs.current.set(block.id, node); }}
              aria-label={`${index + 1}번 ${blockNames[block.type]} 블록 편집: ${block.text.slice(0, 80) || "빈 블록"}`}
              onClick={() => activate(block.id)} onKeyDown={(event) => {
                if (event.key === "ArrowUp" && index > 0) { event.preventDefault(); activate(value.blocks[index - 1].id); }
                if (event.key === "ArrowDown" && index + 1 < value.blocks.length) { event.preventDefault(); activate(value.blocks[index + 1].id, 0); }
              }} />
          </div>}
      {block.type === "todo" && <button type="button" className="todo-toggle" disabled={disabled} onClick={() => edit(block.id, (old) => ({ ...old, done: !old.done, dirty: true }))}
        aria-label={block.done ? "할 일 미완료로 변경" : "할 일 완료로 변경"}>{block.done ? "☑" : "□"}</button>}
    </div>)}
    {(dropSlot?.side === "end" || pendingUpload && resolveBlockInsertion(value, pendingUpload.anchor) === value.blocks.length) &&
      <div className={`editor-drop-end${pendingUpload ? " editor-upload-pending" : ""}`} role="status">
        {pendingUpload ? "이미지 업로드 중 · 이 위치에 삽입됩니다" : "여기에 삽입"}</div>}
    <button type="button" className="editor-add" disabled={disabled} onClick={() => {
      if (!value.blocks.length) { const block = emptyBlock("p", value.newline); onChange({ ...value, blocks: [block] }); activate(block.id, 0); }
      else if (value.blocks.at(-1)?.type === "p" && !value.blocks.at(-1)?.text && !value.blocks.at(-1)?.raw)
        activate(value.blocks[value.blocks.length - 1].id, 0);
      else insertAfter(value.blocks.length - 1, "p");
    }}>+ 문단 추가</button>
    <button type="button" className="editor-add" disabled={disabled} onClick={addTable}>+ 표 추가</button>
    {onImageFile && <><input ref={fileInput} className="sr-only" type="file" accept="image/jpeg,image/png"
      aria-label="JPEG 또는 PNG 이미지 선택" disabled={disabled} onChange={(event) => {
        const file = event.target.files?.[0]; if (file) acceptImageFile(file); event.target.value = "";
      }} /><button type="button" className="editor-add" disabled={disabled} onClick={() => fileInput.current?.click()}>+ 이미지 추가</button></>}
    {depth === 0 && <button type="button" className="editor-add" disabled={disabled} onClick={addToggle}>+ 접기 추가</button>}
    {depth === 0 && <div className="editor-click-below" aria-hidden="true" onClick={() => {
      const last = value.blocks.at(-1);
      if (last) activate(last.id);
    }} />}
  </div>;
});
