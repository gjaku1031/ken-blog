/** 편집 가능한 GFM 표의 셀 원문과 열 정렬. 첫 행은 머리글이다. */
export type TableAlignment = "left" | "center" | "right" | null;
export type TableData = { rows: string[][]; align: TableAlignment[] };
/** 브라우저 입력 개수와 한 셀의 렌더 비용을 제한한다. 초과 원문은 raw로 보존한다. */
export const TABLE_MAX_ROWS = 200;
export const TABLE_MAX_COLUMNS = 20;
export const TABLE_MAX_CELL_LENGTH = 4096;

/** 새 표를 머리글과 빈 본문 한 행으로 만든다. */
export function emptyTable(headers: string[] = ["", ""]): TableData {
  if (headers.length < 1 || headers.length > TABLE_MAX_COLUMNS || headers.some((header) => header.length > TABLE_MAX_CELL_LENGTH)) {
    return { rows: [["", ""], ["", ""]], align: [null, null] };
  }
  return { rows: [[...headers], headers.map(() => "")], align: headers.map(() => null) };
}

/** 짝지어진 코드 스팬 안의 파이프도 GFM 분리자로 쓰이므로 모호하면 원문 편집을 막는다. */
function hasAmbiguousCodePipe(line: string): boolean {
  const matches = [...line.matchAll(/`+/g)];
  for (let index = 0; index < matches.length; index += 1) {
    const opening = matches[index];
    let close = index + 1;
    while (close < matches.length && matches[close][0].length !== opening[0].length) close += 1;
    if (close >= matches.length) break;
    const inner = line.slice(opening.index + opening[0].length, matches[close].index);
    if (/(^|[^\\])(?:\\\\)*\|/.test(inner)) return true;
    index = close;
  }
  return false;
}

/** 외곽 파이프가 있는 한 줄을 이스케이프 경계에 맞춰 셀 원문으로 나눈다. */
function splitPipeRow(line: string): string[] | null {
  if (line.length > TABLE_MAX_COLUMNS * TABLE_MAX_CELL_LENGTH + 100 ||
    !/^ {0,3}\|/.test(line) || !/\|[ \t]*$/.test(line) || hasAmbiguousCodePipe(line)) return null;
  const first = line.indexOf("|");
  const last = line.lastIndexOf("|");
  const cells: string[] = [];
  let beginning = first + 1;
  for (let index = beginning; index <= last; index += 1) {
    if (line[index] !== "|") continue;
    let slashes = 0;
    for (let previous = index - 1; previous >= beginning && line[previous] === "\\"; previous -= 1) slashes += 1;
    if (slashes % 2) continue;
    cells.push(line.slice(beginning, index).trim());
    beginning = index + 1;
  }
  return beginning === last + 1 && cells.length > 0 ? cells : null;
}

/** 명확한 파이프 머리글만 단축키로 인정해 일반 문단의 세로선을 보존한다. */
export function parsePipeHeaderCommand(text: string): string[] | null {
  const cells = splitPipeRow(text);
  return cells && cells.length >= 2 && cells.length <= TABLE_MAX_COLUMNS &&
    cells.every((cell) => cell.length > 0 && cell.length <= TABLE_MAX_CELL_LENGTH) ? cells : null;
}

/** AST 열 수와 원문 행을 대조하고, 초과 셀·모호한 셀은 원문 블록으로 남긴다. */
export function parseEditableTable(raw: string, astColumns: number, astRows: number,
  astAlign: TableAlignment[] | undefined): TableData | null {
  if (raw.length > 256 * 1024) return null;
  const lines = raw.split(/\r?\n/);
  if (lines.length < 2 || lines.length - 1 > TABLE_MAX_ROWS || astColumns < 1 ||
    astColumns > TABLE_MAX_COLUMNS || astRows !== lines.length - 1) return null;
  const header = splitPipeRow(lines[0]);
  const delimiter = splitPipeRow(lines[1]);
  if (!header || !delimiter || header.length !== astColumns || delimiter.length !== astColumns) return null;
  const align: TableAlignment[] = [];
  for (const marker of delimiter) {
    if (!/^:?-{3,}:?$/.test(marker)) return null;
    align.push(marker.startsWith(":") && marker.endsWith(":") ? "center" :
      marker.startsWith(":") ? "left" : marker.endsWith(":") ? "right" : null);
  }
  if (astAlign && (astAlign.length !== align.length || astAlign.some((value, index) => value !== align[index]))) return null;
  const rows = [header];
  for (const line of lines.slice(2)) {
    const cells = splitPipeRow(line);
    if (!cells || cells.length > astColumns) return null;
    rows.push([...cells, ...Array(astColumns - cells.length).fill("")]);
  }
  if (rows.some((row) => row.some((cell) => cell.length > TABLE_MAX_CELL_LENGTH))) return null;
  if (rows.length === 1) rows.push(Array(astColumns).fill(""));
  return { rows, align };
}

/** 수정된 셀의 비이스케이프 세로선만 보호해 열 개수가 바뀌지 않게 한다. */
function safeCell(source: string): string {
  const text = source.replace(/\r?\n/g, " ").trim();
  let result = "";
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "|") {
      let slashes = 0;
      for (let previous = index - 1; previous >= 0 && text[previous] === "\\"; previous -= 1) slashes += 1;
      if (slashes % 2 === 0) result += "\\";
    }
    result += text[index];
  }
  return result;
}

/** 변경한 표만 안정적인 파이프 구문으로 직렬화한다. 무수정 원문은 호출자가 그대로 사용한다. */
export function serializeTable(table: TableData, newline = "\n"): string {
  const width = table.rows[0]?.length ?? 0;
  const lines = [`| ${table.rows[0].map(safeCell).join(" | ")} |`];
  lines.push(`| ${Array.from({ length: width }, (_, index) => {
    const alignment = table.align[index];
    return alignment === "left" ? ":---" : alignment === "center" ? ":---:" : alignment === "right" ? "---:" : "---";
  }).join(" | ")} |`);
  for (const row of table.rows.slice(1)) lines.push(`| ${row.map(safeCell).join(" | ")} |`);
  return lines.join(newline);
}
