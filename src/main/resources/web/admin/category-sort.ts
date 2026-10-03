/**
 * 같은 부모의 분류만 손잡이·키보드로 정렬하고 저장 실패 시 원래 순서 복원
 *
 * 1. 직접 자식만 이동 대상으로 선택, 하위 트리는 부모와 함께 이동
 * 2. 포인터를 놓거나 방향키를 누를 때 전체 형제 ID를 한 번에 저장
 * 3. Escape·포인터 취소·목록 밖 놓기는 저장 없이 복원
 */
export function sortableCategories(container: HTMLUListElement, save: (ids: number[]) => Promise<boolean>): () => void {
  /**
   * 현재 드래그를 취소하고 임시 이벤트를 해제하는 함수
   */
  let cancel: (() => void) | undefined;

  /**
   * 저장 중 추가 정렬 차단 상태
   */
  let saving = false;

  /**
   * 직접 자식 분류만 현재 DOM 순서로 조회
   */
  const items = () => Array.from(container.children).filter((item): item is HTMLLIElement => item instanceof HTMLLIElement && !!item.dataset.categoryId);

  /**
   * 하단의 추가 버튼 위치를 유지하며 분류 DOM 순서 교체
   */
  function arrange(order: HTMLLIElement[]) {
    for (const item of order) container.insertBefore(item, container.querySelector(':scope > .category-add-row'));
  }

  /**
   * 변경이 있을 때만 저장하고 실패하면 화면 순서 복원, 새 목록에서도 손잡이 포커스 유지
   */
  async function commit(original: HTMLLIElement[], moving: HTMLLIElement) {
    /**
     * 확정할 형제 순서
     */
    const ordered = items();
    if (ordered.every((item, index) => item === original[index])) return;
    saving = true;
    try {
      if (!await save(ordered.map(item => Number(item.dataset.categoryId))) && container.isConnected) arrange(original);
    } finally {
      saving = false;
      document.querySelector<HTMLButtonElement>(`[data-category-id="${moving.dataset.categoryId}"] > .category-line .category-drag-handle`)?.focus({ preventScroll: true });
    }
  }

  // 실제 손잡이에서만 이동 시작, 이름 수정·삭제·트리 접기는 드래그로 해석하지 않음
  container.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button !== 0 || saving || cancel || !(event.target instanceof Element)) return;
    /**
     * 이벤트가 시작된 분류와 직접 손잡이
     */
    const handle = event.target.closest<HTMLButtonElement>('.category-drag-handle');
    const moving = handle?.closest<HTMLLIElement>('[data-category-id]');
    if (!handle || !moving || moving.parentElement !== container || items().length < 2 || container.closest('#category-list')?.querySelector('.category-rename')) return;
    event.preventDefault(); event.stopPropagation();
    /**
     * 취소·실패 시 복원할 형제 순서와 포인터 이벤트 수명
     */
    const original = items();
    const listeners = new AbortController();
    const { signal } = listeners;
    /**
     * 현재 포인터 위치·이동 여부·자동 스크롤 프레임
     */
    let x = event.clientX, y = event.clientY, started = false, frame = 0;
    handle.focus({ preventScroll: true }); container.setPointerCapture(event.pointerId);

    /**
     * 같은 형제 목록의 경계 안에 있는지 확인
     */
    function inside() {
      const bounds = container.getBoundingClientRect();
      return x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom;
    }

    /**
     * 다른 형제 행의 중간선을 넘었을 때 부모를 유지하며 순서 변경
     */
    function move() {
      if (!inside()) return;
      const ordered = items();
      const from = ordered.indexOf(moving!);
      for (const [index, item] of ordered.entries()) {
        if (item === moving) continue;
        const row = item.querySelector('.category-line')!.getBoundingClientRect();
        if (index < from && y < row.top + row.height / 2 || index > from && y > row.bottom - row.height / 2) {
          ordered.splice(from, 1); ordered.splice(index, 0, moving!); arrange(ordered); break;
        }
      }
    }

    /**
     * 긴 분류 목록을 드래그하는 동안 화면 가장자리 자동 스크롤
     */
    function tick() {
      if (!container.isConnected) { finish(false); return; }
      if (started) {
        const bounds = container.getBoundingClientRect();
        const delta = y < 100 ? -10 : y > innerHeight - 48 ? 10 : 0;
        if (delta && x >= bounds.left && x <= bounds.right) { window.scrollBy(0, delta); move(); }
      }
      frame = requestAnimationFrame(tick);
    }

    /**
     * 임시 이벤트·포인터 캡처 해제 후 저장 또는 원래 순서 복원
     */
    function finish(accept: boolean) {
      listeners.abort(); cancelAnimationFrame(frame); cancel = undefined;
      if (container.hasPointerCapture(event.pointerId)) container.releasePointerCapture(event.pointerId);
      moving!.classList.remove('category-dragging');
      if (!accept) arrange(original);
      else if (started) void commit(original, moving!);
    }
    cancel = () => finish(false);
    // 일정 거리 이상 움직인 경우만 드래그로 처리
    window.addEventListener('pointermove', pointer => {
      if (pointer.pointerId !== event.pointerId) return;
      x = pointer.clientX; y = pointer.clientY;
      if (!started && Math.hypot(x - event.clientX, y - event.clientY) < 5) return;
      started = true; moving.classList.add('category-dragging'); pointer.preventDefault(); move();
    }, { signal, passive: false });
    window.addEventListener('pointerup', pointer => {
      if (pointer.pointerId !== event.pointerId) return;
      x = pointer.clientX; y = pointer.clientY; finish(inside());
    }, { signal });
    window.addEventListener('pointercancel', pointer => { if (pointer.pointerId === event.pointerId) finish(false); }, { signal });
    container.addEventListener('lostpointercapture', () => finish(false), { signal });
    window.addEventListener('keydown', key => { if (key.key === 'Escape') { key.preventDefault(); finish(false); } }, { signal, capture: true });
    window.addEventListener('resize', () => finish(false), { signal });
    frame = requestAnimationFrame(tick);
  });
  // 키보드로도 동일한 형제 집합을 한 번에 저장
  container.addEventListener('keydown', event => {
    if (saving || cancel || !(event.target instanceof Element) || !event.target.closest('.category-drag-handle')) return;
    const moving = event.target.closest<HTMLLIElement>('[data-category-id]');
    if (!moving || moving.parentElement !== container || container.closest('#category-list')?.querySelector('.category-rename')) return;
    const original = items(), from = original.indexOf(moving);
    const to = event.key === 'ArrowUp' ? from - 1 : event.key === 'ArrowDown' ? from + 1 : event.key === 'Home' ? 0 : event.key === 'End' ? original.length - 1 : null;
    if (to === null) return;
    event.preventDefault(); event.stopPropagation();
    if (to < 0 || to >= original.length || to === from) return;
    const ordered = [...original]; ordered.splice(from, 1); ordered.splice(to, 0, moving); arrange(ordered);
    void commit(original, moving);
  });
  return () => cancel?.();
}
