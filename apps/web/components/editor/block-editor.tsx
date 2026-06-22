"use client";

import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { SafeMarkdown } from "@/components/safe-markdown";
import { blockMarkdown, emptyBlock, ensureBlockBoundaries, type BlockType, type EditorBlock, type MarkdownDocument } from "@/lib/editor-markdown";
import { emptyTable, parsePipeHeaderCommand, TABLE_MAX_COLUMNS, TABLE_MAX_CELL_LENGTH } from "@/lib/editor-table";
import { TableBlock } from "@/components/editor/table-block";

type Props = { value: MarkdownDocument; onChange: (next: MarkdownDocument) => void; disabled?: boolean; focusFirstSignal?: number };
type FocusTarget = { id: string; offset: number | "end" };
const blockNames: Record<BlockType, string> = { p: "문단", h1: "제목 1", h2: "제목 2", h3: "제목 3",
  ul: "글머리 목록", ol: "번호 목록", todo: "할 일", quote: "인용", code: "코드", hr: "구분선", table: "표", raw: "원문" };
const shortcuts: Record<string, BlockType> = { "#": "h1", "##": "h2", "###": "h3", "-": "ul", "*": "ul",
  "1.": "ol", "[]": "todo", "[ ]": "todo", "|": "quote" };

/** 기본 블록을 키보드와 마우스로 편집하고 원문 블록은 읽기 전용으로 보존한다. */
export function BlockEditor({ value, onChange, disabled = false, focusFirstSignal = 0 }: Props) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [focusTarget, setFocusTarget] = useState<FocusTarget | null>(null);
  const [tableFocus, setTableFocus] = useState<{ id: string; serial: number } | null>(null);
  const refs = useRef(new Map<string, HTMLElement>());
  const composing = useRef(false);
  const compositionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragId = useRef<string | null>(null);
  useEffect(() => () => { if (compositionTimer.current) clearTimeout(compositionTimer.current); }, []);

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

  /** 조합 중 keydown이 한글 마지막 글자를 분리하지 않게 모든 구조 키를 통과시킨다. */
  function isComposing(event: KeyboardEvent<HTMLTextAreaElement>): boolean {
    return composing.current || event.nativeEvent.isComposing || event.keyCode === 229;
  }

  /** 한 블록만 복사해 변경하고 나머지 원문 slice를 유지한다. */
  function edit(id: string, change: (block: EditorBlock) => EditorBlock) {
    if (disabled) return;
    onChange(ensureBlockBoundaries({ ...value, blocks: value.blocks.map((block) => block.id === id ? change(block) : block) }));
  }

  /** 블록 변경 후 새 커서 위치를 요청한다. */
  function activate(id: string, offset: number | "end" = "end") {
    setActiveId(id);
    setFocusTarget({ id, offset });
  }

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

  /** 커서와 조합 상태에 따라 블록 단축키·분할·경계 이동만 가로챈다. */
  function handleKey(event: KeyboardEvent<HTMLTextAreaElement>, block: EditorBlock, index: number) {
    if (disabled) return;
    if (isComposing(event)) return;
    const input = event.currentTarget;
    const start = input.selectionStart;
    const end = input.selectionEnd;
    const text = input.value;
    if (event.key === "Escape") { event.preventDefault(); setActiveId(null); setFocusTarget({ id: block.id, offset: 0 }); return; }
    if (event.key === " " && block.type === "p" && start === end && end === text.length) {
      const type = shortcuts[text];
      if (type) { event.preventDefault(); edit(block.id, (old) => ({ ...old, type, text: "", dirty: true })); activate(block.id, 0); return; }
    }
    if (event.key === "Enter" && !event.shiftKey && !event.altKey) {
      if (block.type === "p" && start === end && end === text.length && (text === "/표" || text === "/table")) {
        event.preventDefault(); replaceWithTable(index); return;
      }
      const headers = block.type === "p" && start === end && end === text.length ? parsePipeHeaderCommand(text) : null;
      if (headers && headers.length <= TABLE_MAX_COLUMNS && headers.every((header) => header.length <= TABLE_MAX_CELL_LENGTH)) {
        event.preventDefault(); replaceWithTable(index, headers); return;
      }
      if (block.type === "code") {
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
      const codeCommand = /^```([^`\s]*)$/.exec(text);
      if (block.type === "p" && start === end && codeCommand && codeCommand[1].toLowerCase() !== "mermaid") {
        event.preventDefault(); edit(block.id, (old) => ({ ...old, type: "code", lang: codeCommand[1], text: "", dirty: true }));
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
    if (event.key === "Enter" && event.shiftKey && block.type !== "p" && block.type !== "code") {
      event.preventDefault(); return;
    }
    if (event.key === "Backspace" && start === 0 && end === 0) {
      if (block.type !== "p" && block.type !== "code") {
        event.preventDefault(); edit(block.id, (old) => ({ ...old, type: "p", dirty: true })); activate(block.id, 0); return;
      }
      if (block.type === "code") return;
      if (!text) { event.preventDefault(); if (index > 0) removeAt(index); return; }
      if (index > 0) {
        event.preventDefault();
        const previous = value.blocks[index - 1];
        if (["raw", "code", "hr", "table"].includes(previous.type)) { activate(previous.id); return; }
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
    if (from === to || from < 0 || to < 0 || to >= value.blocks.length) return;
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
    event.preventDefault();
    const from = value.blocks.findIndex((block) => block.id === dragId.current);
    if (from !== -1) move(from, index);
    dragId.current = null;
  }

  return <div className="block-editor" aria-label="글 본문 편집기">
    {value.blocks.map((block, index) => <div key={block.id} className={`editor-block editor-${block.type}`}
      onDragOver={(event) => event.preventDefault()} onDrop={(event) => onDrop(event, index)}>
      <div className="block-controls" aria-label={`${index + 1}번 블록 이동`}>
        <button type="button" className="drag-handle" disabled={disabled} draggable={!disabled} onDragStart={(event) => {
          dragId.current = block.id; event.dataTransfer.setData("text/plain", block.id); event.dataTransfer.effectAllowed = "move";
        }} aria-label={`${index + 1}번 블록 끌어 이동`}>⋮⋮</button>
        <button type="button" disabled={disabled || index === 0} onClick={() => move(index, index - 1)} aria-label={`${index + 1}번 블록 위로 이동`}>↑</button>
        <button type="button" disabled={disabled || index === value.blocks.length - 1} onClick={() => move(index, index + 1)} aria-label={`${index + 1}번 블록 아래로 이동`}>↓</button>
      </div>
      {block.type === "table" && block.table ? <TableBlock value={block.table} disabled={disabled}
        focusFirst={tableFocus?.id === block.id ? tableFocus.serial : 0}
        rootRef={(node) => { if (node) refs.current.set(block.id, node); else refs.current.delete(block.id); }}
        onChange={(table) => edit(block.id, (old) => ({ ...old, table, dirty: true }))}
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
            {block.type === "code" && <label htmlFor={`${block.id}-text`}>코드 {block.lang || "text"} · Ctrl/⌘ Enter로 아래 문단</label>}
            <textarea id={`${block.id}-text`} ref={(node) => { if (node) refs.current.set(block.id, node); }}
              aria-label={`${index + 1}번 ${blockNames[block.type]} 블록`} rows={Math.max(1, block.text.split("\n").length)}
              value={block.text} disabled={disabled} placeholder={block.type === "p" ? "내용을 입력하세요" : "블록 내용을 입력하세요"}
              onChange={(event) => {
                const nextText = event.target.value;
                const shortcut = block.type === "p" && !composing.current && nextText.endsWith(" ") ?
                  shortcuts[nextText.slice(0, -1)] : undefined;
                edit(block.id, (old) => ({ ...old, type: shortcut ?? old.type, text: shortcut ? "" : nextText, dirty: true }));
              }}
              onCompositionStart={() => { composing.current = true; }}
              onCompositionEnd={() => { compositionTimer.current = setTimeout(() => {
                composing.current = false;
                const input = refs.current.get(block.id);
                if (!(input instanceof HTMLTextAreaElement) || block.type !== "p" || !input.value.endsWith(" ")) return;
                const type = shortcuts[input.value.slice(0, -1)];
                if (type) edit(block.id, (old) => ({ ...old, type, text: "", dirty: true }));
              }, 0); }}
              onKeyDown={(event) => handleKey(event, block, index)} />
          </div> : <div className="editor-preview">
            <div inert><SafeMarkdown body={blockMarkdown(block, value.newline)} /></div>
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
  </div>;
}
