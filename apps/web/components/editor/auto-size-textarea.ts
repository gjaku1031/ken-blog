/** 현재 {@link HTMLTextAreaElement}를 접지 않고 같은 폭의 임시 입력칸으로 필요한 높이를 잰다. */
function measuredHeight(input: HTMLTextAreaElement): number | null {
  const parent = input.parentElement;
  const width = input.getBoundingClientRect().width;
  if (!parent || width <= 0) return null;
  const mirror = input.cloneNode(false) as HTMLTextAreaElement;
  mirror.removeAttribute("id");
  mirror.removeAttribute("name");
  mirror.removeAttribute("aria-label");
  mirror.setAttribute("aria-hidden", "true");
  mirror.tabIndex = -1;
  mirror.value = input.value;
  mirror.style.position = "fixed";
  mirror.style.top = "0";
  mirror.style.left = "0";
  mirror.style.visibility = "hidden";
  mirror.style.pointerEvents = "none";
  mirror.style.width = `${width}px`;
  mirror.style.height = "auto";
  parent.appendChild(mirror);
  const height = mirror.scrollHeight + mirror.offsetHeight - mirror.clientHeight;
  mirror.remove();
  return height;
}

/** 자동 줄바꿈과 내용 삭제를 반영하고 실제 입력칸에는 최종 높이만 적용한다. */
export function fitTextareaHeight(input: HTMLTextAreaElement): void {
  const height = measuredHeight(input);
  if (height !== null && input.style.height !== `${height}px`) input.style.height = `${height}px`;
}

/** 표의 모든 셀을 기존 행 높이를 유지한 채 측정한 뒤 한 번에 새 높이를 적용한다. */
export function fitTextareaHeights(inputs: Iterable<HTMLTextAreaElement>): void {
  const cells = Array.from(inputs);
  const heights = cells.map(measuredHeight);
  cells.forEach((input, index) => {
    const height = heights[index];
    if (height !== null && input.style.height !== `${height}px`) input.style.height = `${height}px`;
  });
}
