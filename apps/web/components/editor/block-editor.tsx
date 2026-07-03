"use client";

import { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState,
  type ClipboardEvent, type DragEvent, type KeyboardEvent } from "react";
import { SafeMarkdown } from "@/components/safe-markdown";
import { blockMarkdown, emptyBlock, emptyImageBlock, emptyToggleBlock, ensureBlockBoundaries, type BlockType, type EditorBlock, type MarkdownDocument } from "@/lib/editor-markdown";
import type { ImageData } from "@/lib/editor-image";
import { emptyTable, parsePipeHeaderCommand, TABLE_MAX_COLUMNS, TABLE_MAX_CELL_LENGTH } from "@/lib/editor-table";
import { TableBlock } from "@/components/editor/table-block";
import { ToggleBlock } from "@/components/editor/toggle-block";
import { ImageBlock } from "@/components/editor/image-block";
import { insertAnnotationAt, insertInlineTextAt, type EditorAnnotationModel, type EditorAnnotationSelection } from "@/lib/editor-annotation";
import { validWikiTitle } from "@/lib/wiki-link-syntax";
import "./editor.css";

type Props = { value: MarkdownDocument; onChange: (next: MarkdownDocument) => void; disabled?: boolean;
  focusFirstSignal?: number; focusBlock?: { id: string; serial: number; offset?: number }; depth?: 0 | 1; onOutdentFrom?: (index: number) => void;
  onImageFile?: (file: File) => Promise<ImageData | null>; onImageReject?: (message: string) => void;
  annotationPreview?: EditorAnnotationModel | null; annotationController?: AnnotationController; annotationSessionKey?: string };
/** 글쓰기 고정 도구에서 커서를 보관하고 주석을 삽입할 수 있는 편집기 경계. */
export type BlockEditorHandle = { captureAnnotationSelection: () => void; insertAnnotation: () => boolean;
  insertWikiLink: (title: string) => boolean };
type AnnotationController = { selection: EditorAnnotationSelection | null; composing: boolean; suppressNext: boolean };
type FocusTarget = { id: string; offset: number | "end" };
const ANNOTATION_TEXT_TYPES = new Set<BlockType>(["p", "h1", "h2", "h3", "ul", "ol", "todo", "quote"]);
/** 편집과 미리보기 조작에 쓰는 블록 종류별 한국어 이름. */
const blockNames: Record<BlockType, string> = { p: "문단", h1: "제목 1", h2: "제목 2", h3: "제목 3",
  ul: "글머리 목록", ol: "번호 목록", todo: "할 일", quote: "인용", code: "코드", math: "수식", mermaid: "도식", hr: "구분선", table: "표", toggle: "접기", image: "이미지", raw: "원문" };
const shortcuts: Record<string, BlockType> = { "#": "h1", "##": "h2", "###": "h3", "-": "ul", "*": "ul",
  "1.": "ol", "[]": "todo", "[ ]": "todo", "|": "quote" };
const DRAG_FORMAT = "application/x-ken-blog-editor-block";
const CODE_LANGUAGES = ["kotlin", "java", "javascript", "typescript", "json", "sql", "bash", "yaml", "python", "css", "html", "markdown"];
const CODE_LANGUAGE_PATTERN = /^[A-Za-z0-9_-]{0,32}$/;

/** 기본 블록을 키보드와 마우스로 편집하고 원문 블록은 읽기 전용으로 보존한다. */
export const BlockEditor = forwardRef<BlockEditorHandle, Props>(function BlockEditorInner({ value, onChange, disabled = false,
  focusFirstSignal = 0, focusBlock, depth = 0, onOutdentFrom, onImageFile, onImageReject,
  annotationPreview, annotationController, annotationSessionKey }: Props, ref) {
  const editorToken = useId();
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
  const dragId = useRef<string | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const latest = useRef(value);
  const root = useRef<HTMLDivElement | null>(null);
  const ownedAnnotation = useRef<AnnotationController>({ selection: null, composing: false, suppressNext: false });
  const annotation = annotationController ?? ownedAnnotation.current;
  latest.current = value;
  useEffect(() => () => {
    if (compositionTimer.current) clearTimeout(compositionTimer.current);
    if (composing.current) annotation.composing = false;
  }, [annotation]);
  useEffect(() => {
    if (depth === 0) { annotation.selection = null; annotation.composing = false; annotation.suppressNext = false; }
  }, [annotationSessionKey, depth]);

  /** 상태가 적용된 뒤 커서를 지정한 블록의 정확한 위치로 돌린다. */
  useEffect(() => {
    if (!focusTarget) return;
    const target = refs.current.get(focusTarget.id);
    target?.focus();
    if (target instanceof HTMLTextAreaElement) {
      const offset = focusTarget.offset === "end" ? target.value.length : Math.min(focusTarget.offset, target.value.length);
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

  /** 텍스트 값까지 함께 보관해 선택 범위가 다른 원고에 재사용되지 않게 한다. */
  function captureAnnotationSelectionFrom(input: HTMLTextAreaElement) {
    const id = input.dataset.annotationBlockId;
    if (!id) return;
    annotation.selection = { id, start: input.selectionStart, end: input.selectionEnd, expectedText: input.value };
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

  useImperativeHandle(ref, () => ({ captureAnnotationSelection, insertAnnotation, insertWikiLink }));

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

  /** 업로드가 끝난 시점의 최신 원고에 이미지를 삽입하고 다음 문단을 유지한다. */
  function insertUploaded(image: ImageData, targetId: string | null) {
    const current = latest.current;
    const blocks = [...current.blocks];
    const index = targetId ? blocks.findIndex((block) => block.id === targetId) : blocks.length - 1;
    if (targetId && index < 0) return;
    const picture = emptyImageBlock(image, current.newline);
    if (index < 0) {
      blocks.push({ ...picture, after: current.newline.repeat(2) }, emptyBlock("p", current.newline));
    } else {
      const previous = blocks[index];
      if (previous.type === "p" && !previous.text && !previous.raw) {
        blocks[index] = { ...picture, after: previous.after };
      } else {
        blocks[index] = { ...previous, after: current.newline.repeat(2) };
        blocks.splice(index + 1, 0, { ...picture, after: previous.after });
      }
      if (index === current.blocks.length - 1) {
        const last = blocks.at(-1)!;
        blocks[blocks.length - 1] = { ...last, after: current.newline.repeat(2) };
        blocks.push({ ...emptyBlock("p", current.newline), after: previous.after });
      }
    }
    onChange(ensureBlockBoundaries({ ...current, blocks }));
    activate(picture.id);
  }

  /** 파일 선택·드롭·클립보드 이미지를 같은 관리자 업로드 작업으로 연결한다. */
  function acceptImageFile(file: File, targetId = activeId) {
    if (disabled || !onImageFile) return;
    void onImageFile(file).then((image) => { if (image) insertUploaded(image, targetId); });
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
    const child = { ...current, after: value.newline.repeat(2) };
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
    const start = input.selectionStart;
    const end = input.selectionEnd;
    const text = input.value;
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
    if (event.key === "Backspace" && start === 0 && end === 0) {
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

  /** 손잡이나 버튼으로 순서를 바꾸되 원문 블록 내용은 편집하지 않는다. */
  function move(from: number, to: number) {
    if (disabled || from === to || from < 0 || to < 0 || to >= value.blocks.length) return;
    const blocks = [...value.blocks];
    const separators = blocks.map((block) => block.after);
    const [moved] = blocks.splice(from, 1);
    blocks.splice(to, 0, moved);
    // 구분자는 문서 위치에 두고 부족한 개행은 raw 꼬리까지 고려하는 공통 함수에서 보강한다.
    onChange(ensureBlockBoundaries({ ...value, blocks: blocks.map((block, index) => ({ ...block, after: separators[index] })) }));
    activate(moved.id);
  }

  /** HTML Drag and Drop 식별자를 오직 현재 화면 블록에서만 받는다. */
  function onDrop(event: DragEvent<HTMLElement>, index: number) {
    if (event.dataTransfer.files.length) {
      event.preventDefault(); event.stopPropagation();
      dragId.current = null;
      if (event.dataTransfer.files.length !== 1) { onImageReject?.("이미지는 한 번에 한 파일씩 올려 주세요."); return; }
      if (!disabled) acceptImageFile(event.dataTransfer.files[0], value.blocks[index]?.id ?? null);
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const id = dragId.current;
    dragId.current = null;
    if (disabled) return;
    if (!id || event.dataTransfer.getData(DRAG_FORMAT) !== `${editorToken}:${id}`) return;
    const from = value.blocks.findIndex((block) => block.id === id);
    if (from !== -1) move(from, index);
  }

  return <div className="block-editor" aria-label="글 본문 편집기" ref={root}
    onFocusCapture={(event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || target.closest(".block-editor") !== event.currentTarget) return;
      if (target instanceof HTMLTextAreaElement && target.dataset.annotationBlockId)
        captureAnnotationSelectionFrom(target);
    }}
    onPointerDownCapture={(event) => {
      if ((event.target as Element).closest(".block-editor") === event.currentTarget)
        clearAnnotationSelectionForInput(event.target);
    }}
    onKeyDownCapture={(event) => {
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
        acceptImageFile(file, id); }
    }}
    onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); }}
    onDrop={(event) => { if (!event.dataTransfer.files.length) return;
      event.preventDefault(); event.stopPropagation();
      if (event.dataTransfer.files.length !== 1) { onImageReject?.("이미지는 한 번에 한 파일씩 올려 주세요."); return; }
      if (!disabled) acceptImageFile(event.dataTransfer.files[0]); }}>
    {value.blocks.map((block, index) => <div key={block.id} data-block-id={block.id} className={`editor-block editor-${block.type}`}
      onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); }} onDrop={(event) => onDrop(event, index)}>
      <div className={`block-controls${depth === 1 || (depth === 0 && index > 0 && value.blocks[index - 1].type === "toggle") ? " block-controls-transfer" : ""}`}
        aria-label={`${index + 1}번 블록 이동`}>
        <button type="button" className="drag-handle" disabled={disabled} draggable={!disabled} onDragStart={(event) => {
          event.stopPropagation();
          if (disabled) { event.preventDefault(); return; }
          dragId.current = block.id;
          event.dataTransfer.setData(DRAG_FORMAT, `${editorToken}:${block.id}`);
          event.dataTransfer.effectAllowed = "move";
        }} onDragEnd={(event) => {
          event.stopPropagation(); dragId.current = null;
        }} aria-label={`${index + 1}번 블록 끌어 이동`}>⋮⋮</button>
        <button type="button" disabled={disabled || index === 0} onClick={() => move(index, index - 1)} aria-label={`${index + 1}번 블록 위로 이동`}>↑</button>
        <button type="button" disabled={disabled || index === value.blocks.length - 1} onClick={() => move(index, index + 1)} aria-label={`${index + 1}번 블록 아래로 이동`}>↓</button>
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
              <input id={`${block.id}-language`} type="text" list={`${block.id}-languages`} autoComplete="off"
                value={block.lang ?? ""} disabled={disabled} aria-invalid={languageError?.id === block.id}
                aria-describedby={`${block.id}-language-help${languageError?.id === block.id ? ` ${block.id}-language-error` : ""}`}
                onChange={(event) => changeCodeLanguage(block.id, event.target.value)}
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing) return;
                  if (event.key === "Escape") {
                    event.preventDefault(); setActiveId(null); setFocusTarget({ id: block.id, offset: 0 });
                  } else if (event.key === "Enter") {
                    event.preventDefault();
                    if (event.ctrlKey || event.metaKey) insertAfter(index, "p");
                    else refs.current.get(block.id)?.focus();
                  }
                }} />
              <datalist id={`${block.id}-languages`}>{CODE_LANGUAGES.map((language) =>
                <option key={language} value={language} />)}</datalist>
              <span id={`${block.id}-language-help`} className="editor-code-help">언어를 비우면 일반 코드로 표시합니다. Ctrl/⌘ Enter로 아래 문단을 추가합니다.</span>
              {languageError?.id === block.id && <span id={`${block.id}-language-error`} className="editor-code-error" role="alert">
                {languageError.message}</span>}
            </div>}
            {block.type === "code" && <label htmlFor={`${block.id}-text`}>코드 내용</label>}
            {block.type === "math" && <label htmlFor={`${block.id}-text`}>수식 원문</label>}
            {block.type === "mermaid" && <label htmlFor={`${block.id}-text`}>Mermaid 도식 원문</label>}
            <textarea id={`${block.id}-text`} ref={(node) => { if (node) refs.current.set(block.id, node); }}
              data-annotation-block-id={ANNOTATION_TEXT_TYPES.has(block.type) ? block.id : undefined}
              aria-label={`${index + 1}번 ${blockNames[block.type]} 블록`} rows={Math.max(1, block.text.split("\n").length)}
              aria-describedby={block.type === "math" ? `${block.id}-math-help` : block.type === "mermaid" ? `${block.id}-mermaid-help` : undefined}
              value={block.text} disabled={disabled} placeholder={block.type === "p" ? "내용을 입력하세요" : "블록 내용을 입력하세요"}
              onChange={(event) => {
                const nextText = event.target.value;
                captureAnnotationSelectionFrom(event.currentTarget);
                const shortcut = block.type === "p" && !composing.current && nextText.endsWith(" ") ?
                  shortcuts[nextText.slice(0, -1)] : undefined;
                edit(block.id, (old) => ({ ...old, type: shortcut ?? old.type, text: shortcut ? "" : nextText, dirty: true }));
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
              <span id={`${block.id}-math-help`} className="editor-math-help">TeX 원문 입력 · Enter 줄바꿈 · Esc 미리보기 · Ctrl/⌘ Enter 아래 문단</span>
              <button type="button" disabled={disabled} onClick={() => {
                if (window.confirm("수식 블록과 내용을 삭제할까요?")) removeAt(index);
              }}>수식 삭제</button>
            </div>}
            {block.type === "mermaid" && <div className="editor-mermaid-actions">
              <span id={`${block.id}-mermaid-help`} className="editor-mermaid-help">Mermaid 원문 입력 · Enter 줄바꿈 · Esc 미리보기 · Ctrl/⌘ Enter 아래 문단</span>
              <button type="button" disabled={disabled} onClick={() => {
                if (window.confirm("도식 블록과 내용을 삭제할까요?")) removeAt(index);
              }}>도식 삭제</button>
            </div>}
          </div> : <div className="editor-preview">
            <div inert={!annotationPreview?.byBlock.get(block.id)?.length}>{block.type === "math" && !block.text ?
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
    <button type="button" className="editor-add" disabled={disabled} onClick={() => {
      if (!value.blocks.length) { const block = emptyBlock("p", value.newline); onChange({ ...value, blocks: [block] }); activate(block.id, 0); }
      else insertAfter(value.blocks.length - 1, "p");
    }}>+ 문단 추가</button>
    <button type="button" className="editor-add" disabled={disabled} onClick={addTable}>+ 표 추가</button>
    {onImageFile && <><input ref={fileInput} className="sr-only" type="file" accept="image/jpeg,image/png"
      aria-label="JPEG 또는 PNG 이미지 선택" disabled={disabled} onChange={(event) => {
        const file = event.target.files?.[0]; if (file) acceptImageFile(file); event.target.value = "";
      }} /><button type="button" className="editor-add" disabled={disabled} onClick={() => fileInput.current?.click()}>+ 이미지 추가</button></>}
    {depth === 0 && <button type="button" className="editor-add" disabled={disabled} onClick={addToggle}>+ 접기 추가</button>}
  </div>;
});
