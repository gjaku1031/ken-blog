/** 자동 줄바꿈으로 늘어난 줄을 포함해 입력칸 높이를 내용에 맞춘다. */
export function fitTextareaHeight(input: HTMLTextAreaElement): void {
  input.style.height = "auto";
  input.style.height = `${input.scrollHeight + input.offsetHeight - input.clientHeight}px`;
}

/** 표의 모든 셀 높이를 한 번에 읽어 폭 변경 후 행 배치를 다시 계산한다. */
export function fitTextareaHeights(inputs: Iterable<HTMLTextAreaElement>): void {
  const cells = Array.from(inputs);
  for (const input of cells) input.style.height = "auto";
  const heights = cells.map((input) => input.scrollHeight + input.offsetHeight - input.clientHeight);
  cells.forEach((input, index) => { input.style.height = `${heights[index]}px`; });
}
