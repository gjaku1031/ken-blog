"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { TABLE_MAX_CELL_LENGTH, TABLE_MAX_COLUMNS, TABLE_MAX_ROWS, type TableAlignment, type TableData } from "@/lib/editor-table";
import "./table-block.css";

type Props = {
  value: TableData; onChange: (table: TableData) => void; onDelete: () => void;
  disabled: boolean; focusFirst: number; rootRef: (node: HTMLDivElement | null) => void;
  moveAbove: () => void; moveBelow: () => void;
};

/** 표의 셀을 복사해 부모의 원문 블록 상태에 반영한다. */
function changedCell(table: TableData, row: number, column: number, text: string): TableData {
  return { ...table, rows: table.rows.map((cells, index) => index === row ?
    cells.map((cell, position) => position === column ? text : cell) : cells) };
}

/** 머리글·본문 입력, 행열과 정렬 조작을 한 표 안에서 키보드로 제공한다. */
export function TableBlock({ value, onChange, onDelete, disabled, focusFirst, rootRef, moveAbove, moveBelow }: Props) {
  const root = useRef<HTMLDivElement | null>(null);
  const composing = useRef(false);
  const [pendingFocus, setPendingFocus] = useState<string | null>(null);
  const width = value.rows[0].length;

  /** 행열 인덱스가 바뀐 뒤에도 현재 DOM에서 새 셀을 찾아 초점을 맞춘다. */
  function focusCell(key: string) {
    root.current?.querySelector<HTMLInputElement>(`input[data-cell="${key}"]`)?.focus();
  }

  /** 새 셀 추가 후와 명령으로 생성한 표에서 원하는 입력 칸에 초점을 준다. */
  useEffect(() => {
    if (!pendingFocus) return;
    focusCell(pendingFocus);
    setPendingFocus(null);
  }, [pendingFocus, value.rows]);
  useEffect(() => { if (focusFirst > 0) focusCell("0-0"); }, [focusFirst]);

  /** 같은 열의 다음 행으로 가고 마지막 본문 행이면 행을 하나 만든다. */
  function enterCell(event: KeyboardEvent<HTMLInputElement>, row: number, column: number) {
    if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "Escape") { event.preventDefault(); root.current?.focus(); return; }
    if (event.key !== "Enter") return;
    event.preventDefault();
    const next = row + 1;
    if (next < value.rows.length) { focusCell(`${next}-${column}`); return; }
    if (value.rows.length >= TABLE_MAX_ROWS || disabled) return;
    onChange({ ...value, rows: [...value.rows, Array(width).fill("")] });
    setPendingFocus(`${next}-${column}`);
  }

  /** 선택한 본문 행만 지우고 머리글과 최소 한 본문 행을 남긴다. */
  function deleteRow(index: number) {
    if (disabled || index === 0 || value.rows.length <= 2) return;
    onChange({ ...value, rows: value.rows.filter((_, row) => row !== index) });
    setPendingFocus(`${Math.min(index, value.rows.length - 2)}-0`);
  }

  /** 열을 끝에 추가하고 새 머리글 셀로 초점을 옮긴다. */
  function addColumn() {
    if (disabled || width >= TABLE_MAX_COLUMNS) return;
    onChange({ align: [...value.align, null], rows: value.rows.map((row) => [...row, ""]) });
    setPendingFocus(`0-${width}`);
  }

  /** 마지막 한 열은 지울 수 없고 나머지 열은 모든 행에서 함께 제거한다. */
  function deleteColumn(index: number) {
    if (disabled || width <= 1) return;
    onChange({ align: value.align.filter((_, column) => column !== index),
      rows: value.rows.map((row) => row.filter((_, column) => column !== index)) });
    setPendingFocus(`0-${Math.min(index, width - 2)}`);
  }

  /** 없음→왼쪽→가운데→오른쪽→없음 순으로 해당 열 정렬을 바꾼다. */
  function cycleAlignment(index: number) {
    const order: TableAlignment[] = [null, "left", "center", "right"];
    const current = order.indexOf(value.align[index]);
    onChange({ ...value, align: value.align.map((item, column) => column === index ? order[(current + 1) % order.length] : item) });
  }

  const alignmentName: Record<Exclude<TableAlignment, null>, string> = { left: "왼쪽", center: "가운데", right: "오른쪽" };
  return <div className="editor-table-block" tabIndex={0} role="group" aria-label="표 블록. 위아래 화살표로 이웃 블록 이동"
    ref={(node) => { root.current = node; rootRef(node); }}
    onKeyDown={(event) => {
      if (event.target !== root.current) return;
      if (event.key === "ArrowUp") { event.preventDefault(); moveAbove(); }
      if (event.key === "ArrowDown") { event.preventDefault(); moveBelow(); }
    }}>
    <div className="editor-table-scroll" tabIndex={0} role="group" aria-label="표 가로 스크롤 영역">
      <table style={{ minWidth: `${width * 150 + 60}px` }}><caption className="sr-only">글 본문 표 편집</caption><thead><tr>{value.rows[0].map((cell, column) => <th key={column} scope="col">
        <input type="text" value={cell} disabled={disabled} maxLength={TABLE_MAX_CELL_LENGTH} data-cell={`0-${column}`}
          aria-label={`머리글 ${column + 1}열`}
          onChange={(event) => onChange(changedCell(value, 0, column, event.target.value.replace(/[\r\n]+/g, " ")))}
          onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
          onKeyDown={(event) => enterCell(event, 0, column)} />
      </th>)}<th scope="col" className="editor-table-tool-heading">행 도구</th></tr></thead>
      <tbody>{value.rows.slice(1).map((row, offset) => {
        const rowIndex = offset + 1;
        return <tr key={rowIndex}>{row.map((cell, column) => <td key={column}>
          <input type="text" value={cell} disabled={disabled} maxLength={TABLE_MAX_CELL_LENGTH} data-cell={`${rowIndex}-${column}`}
            aria-label={`${rowIndex + 1}행 ${column + 1}열`}
            onChange={(event) => onChange(changedCell(value, rowIndex, column, event.target.value.replace(/[\r\n]+/g, " ")))}
            onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
            onKeyDown={(event) => enterCell(event, rowIndex, column)} />
        </td>)}<td className="editor-table-row-tool"><button type="button" disabled={disabled || value.rows.length <= 2}
          onClick={() => deleteRow(rowIndex)} aria-label={`${rowIndex + 1}행 삭제`}>×</button></td></tr>;
      })}</tbody>
      <tfoot><tr>{value.align.map((alignment, index) => <td key={index}>
        <div className="editor-table-column-tool">
          <button type="button" disabled={disabled} onClick={() => cycleAlignment(index)}
            aria-label={`${index + 1}열 정렬: ${alignment ? alignmentName[alignment] : "기본"}. 누르면 다음 정렬`}>
            {alignment ? alignmentName[alignment] : "기본"}</button>
          <button type="button" disabled={disabled || width <= 1} onClick={() => deleteColumn(index)} aria-label={`${index + 1}열 삭제`}>×</button>
        </div>
      </td>)}<td className="editor-table-tool-heading">열 도구</td></tr></tfoot></table>
    </div>
    <div className="editor-table-actions">
      <button type="button" disabled={disabled || value.rows.length >= TABLE_MAX_ROWS} onClick={() => {
        onChange({ ...value, rows: [...value.rows, Array(width).fill("")] });
        setPendingFocus(`${value.rows.length}-0`);
      }}>+ 행 추가</button>
      <button type="button" disabled={disabled || width >= TABLE_MAX_COLUMNS} onClick={addColumn}>+ 열 추가</button>
      <button type="button" disabled={disabled} onClick={() => { if (window.confirm("표 전체를 삭제할까요?")) onDelete(); }}>표 삭제</button>
    </div>
    <p className="editor-table-help">셀 Enter: 아래 셀 · 마지막 행에서 새 행 · Esc: 표 이동 · 최대 {TABLE_MAX_ROWS}행, {TABLE_MAX_COLUMNS}열</p>
  </div>;
}
