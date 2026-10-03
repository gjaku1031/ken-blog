/**
 * 파서가 인식한 HTML 태그의 원문 위치
 */
type HtmlRange = {
  /**
   * 시작 오프셋
   */
  start: number;

  /**
   * 끝 오프셋
   */
  end: number;
};

/**
 * 안전 접기 태그를 제외한 raw HTML의 내부와 미닫힌 태그 뒤를 보호함
 */
export function coverRawHtml(source: string, ranges: HtmlRange[], cover: (start: number, end: number) => void): void {
  const stack: Array<{
    /**
     * 소문자 태그 이름
     */
    name: string;

    /**
     * 여는 태그 위치
     */
    start: number;
  }> = [];
  // 가장 가까운 같은 이름의 태그를 닫고, void 태그는 스택에서 제외
  for (const item of [...ranges].sort((left, right) => left.start - right.start)) {
    const raw = source.slice(item.start, item.end);
    const tag = /^<(\/)?([A-Za-z][\w:-]*)(?:\s[^>]*)?>$/.exec(raw);
    if (!tag) continue;
    const name = tag[2].toLowerCase();
    if (name === "details" || name === "summary") continue;
    if (tag[1]) {
      const index = stack.findLastIndex(open => open.name === name);
      if (index >= 0) { cover(stack[index].start, item.end); stack.length = index; }
    } else if (!/\/>$/.test(raw) && !/^(?:br|hr|img|input|meta|link|source|wbr)$/.test(name)) {
      stack.push({ name, start: item.start });
    }
  }
  // 닫히지 않은 HTML은 문서 끝까지 보호
  for (const open of stack) cover(open.start, source.length);
}
