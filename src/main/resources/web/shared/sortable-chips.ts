/**
 * 입력별 스크린 리더 순서 변경 안내의 고유 ID
 */
let sequence = 0;

/**
 * 줄바꿈되는 태그·기술 칩의 포인터·키보드 순서 변경
 *
 * 1. 손잡이와 순서 안내 구성, 삭제 버튼은 드래그에서 제외
 * 2. 이동 중에는 자리 표시자와 주변 칩의 위치만 변경
 * 3. 놓을 때 이름 배열 전달, Escape·외부 놓기·취소는 원래 순서 복원
 * 4. 동작 축소 설정에서는 이동·착지 애니메이션 생략
 */
export function sortableChips(container: HTMLElement, onChange: (names: string[]) => void) {
  // 화면에 별도 문구를 표시하지 않는 스크린 리더 안내와 이동 상태 보관
  const hint = document.createElement('p'); hint.className = 'sr-only'; hint.id = `chip-order-${++sequence}`;
  hint.textContent = '드래그 또는 ← → 키로 순서 변경';
  const status = document.createElement('span'); status.className = 'sr-only'; status.setAttribute('role', 'status');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const animations = new Map<HTMLElement, Animation>();
  let cancelActive: (() => void) | undefined;
  let suppressClickUntil = 0;
  container.classList.add('sortable-chips');

  /**
   * DOM 순서의 실제 칩 목록
   */
  const items = () => [...container.children] as HTMLElement[];

  /**
   * 현재 칩의 손잡이와 위치 설명 갱신
   */
  function refresh() {
    container.before(hint, status); hint.hidden = items().length < 2;
    items().forEach((chip, index, all) => {
      let handle = chip.querySelector<HTMLButtonElement>('.chip-drag-handle');
      if (!handle) {
        handle = document.createElement('button'); handle.type = 'button'; handle.className = 'chip-drag-handle';
        handle.innerHTML = '<svg width="12" height="16" viewBox="0 0 12 16" aria-hidden="true"><path d="M3 3h1m4 0h1M3 8h1m4 0h1M3 13h1m4 0h1" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
        chip.prepend(handle);
      }
      handle.disabled = all.length < 2;
      handle.setAttribute('aria-label', `${chip.dataset.sortKey} 순서 이동, ${index + 1}/${all.length}`);
      handle.setAttribute('aria-describedby', hint.id);
      handle.title = '드래그 또는 방향키로 순서 변경';
    });
  }

  /**
   * 실제 DOM 순서 변경과 이전 위치에서 새 위치로 이어지는 애니메이션
   */
  function arrange(order: HTMLElement[], moving?: HTMLElement) {
    const before = new Map(items().map(chip => [chip, chip.getBoundingClientRect()]));
    animations.forEach(animation => animation.cancel()); animations.clear();
    container.append(...order);
    if (reducedMotion.matches) return;
    for (const chip of order) {
      const first = before.get(chip), last = chip.getBoundingClientRect();
      if (!first || chip === moving || (first.x === last.x && first.y === last.y)) continue;
      const animation = chip.animate([
        { transform: `translate(${first.x - last.x}px,${first.y - last.y}px)` }, { transform: 'translate(0,0)' },
      ], { duration: 180, easing: 'cubic-bezier(.2,.8,.2,1)' });
      animations.set(chip, animation);
    }
  }

  /**
   * 확정한 순서를 폼 값과 보조 기술의 안내에 반영
   */
  function commit(chip: HTMLElement) {
    const order = items(); onChange(order.map(item => item.dataset.sortKey!)); refresh();
    status.textContent = `${chip.dataset.sortKey}, ${order.length}개 중 ${order.indexOf(chip) + 1}번째로 이동했습니다.`;
  }

  /**
   * 이동 완료 위치의 짧은 강조, 동작 축소 설정은 강조 애니메이션 생략
   */
  function landed(chip: HTMLElement) {
    chip.classList.remove('is-drag-placeholder');
    if (!reducedMotion.matches && chip.isConnected) chip.animate([
      { boxShadow: '0 0 0 3px var(--accent)', offset: 0 }, { boxShadow: '0 0 0 0 transparent', offset: 1 },
    ], { duration: 320, easing: 'ease-out' });
  }

  // 실제 제거 버튼의 클릭과 일반 스크롤은 유지, 손잡이는 터치 드래그 시작점
  container.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button !== 0 || cancelActive || items().length < 2 || !(event.target instanceof Element)) return;
    const targetChip = event.target.closest<HTMLElement>('[data-sort-key]');
    if (!targetChip || targetChip.parentElement !== container || event.target.closest('.chip-remove')) return;
    const chip = targetChip;
    if (event.pointerType !== 'mouse' && !event.target.closest('.chip-drag-handle')) return;
    event.preventDefault();
    const original = items(); const start = chip.getBoundingClientRect();
    const offsetX = event.clientX - start.x, offsetY = event.clientY - start.y;
    let x = event.clientX, y = event.clientY, frame = 0;
    let ghost: HTMLElement | undefined;
    const listeners = new AbortController(); const { signal } = listeners;
    const dialog = container.closest('dialog');
    const scrollParent = dialog ?? document.scrollingElement as HTMLElement;
    container.setPointerCapture(event.pointerId);

    /**
     * 분류·다른 입력 영역으로 놓은 경우 취소할 칩 목록 경계
     */
    const inside = () => {
      const rect = container.getBoundingClientRect();
      return x >= rect.left - 24 && x <= rect.right + 24 && y >= rect.top - 24 && y <= rect.bottom + 24;
    };

    /**
     * 애니메이션 중간 좌표와 무관하게 실제 줄 배치에서 가장 가까운 칩 계산
     */
    function movePlaceholder() {
      if (!inside()) return;
      const bounds = container.getBoundingClientRect();
      const rows = items().map(item => ({ item, top: bounds.top + item.offsetTop, left: bounds.left + item.offsetLeft }));
      const distances = rows.map(row => Math.max(row.top - y, y - row.top - row.item.offsetHeight, 0));
      const nearestRow = Math.min(...distances);
      const candidates = rows.filter((_, index) => distances[index] === nearestRow);
      const target = candidates.sort((a, b) => Math.abs(a.left + a.item.offsetWidth / 2 - x) - Math.abs(b.left + b.item.offsetWidth / 2 - x))[0];
      if (!target || target.item === chip) return;
      const order = items(), from = order.indexOf(chip), to = order.indexOf(target.item);
      const sameRow = Math.abs(chip.offsetTop - target.item.offsetTop) < 2;
      if (sameRow && (to > from ? x < target.left + target.item.offsetWidth / 2 : x > target.left + target.item.offsetWidth / 2)) return;
      order.splice(from, 1); order.splice(to, 0, chip); arrange(order, chip);
    }

    /**
     * 포인터 위치의 떠 있는 칩과 목록 밖 놓기 표시 갱신
     */
    function positionGhost() {
      if (!ghost) return;
      ghost.style.transform = `translate(${x - offsetX}px,${y - offsetY}px) scale(1.04)`;
      ghost.classList.toggle('is-outside', !inside());
    }

    /**
     * 좁은 화면에서 손잡이를 유지하며 대화상자 가장자리 자동 스크롤
     */
    function tick() {
      if (!ghost || !container.isConnected) { finish(false, false); return; }
      const bounds = dialog?.getBoundingClientRect() ?? { top: 0, bottom: innerHeight };
      const list = container.getBoundingClientRect();
      const delta = y < bounds.top + 36 ? -8 : y > bounds.bottom - 36 ? 8 : 0;
      if (delta && x >= list.left && x <= list.right && y >= bounds.top && y <= bounds.bottom) {
        const before = scrollParent.scrollTop; scrollParent.scrollTop += delta;
        if (scrollParent.scrollTop !== before) { movePlaceholder(); positionGhost(); }
      }
      frame = requestAnimationFrame(tick);
    }

    /**
     * 임시 이벤트·캡처 해제 후 순서 확정 또는 복원, 떠 있는 칩의 착지
     */
    function finish(accept: boolean, animate = true) {
      listeners.abort(); cancelAnimationFrame(frame); cancelActive = undefined;
      if (container.hasPointerCapture(event.pointerId)) container.releasePointerCapture(event.pointerId);
      if (!ghost) return;
      suppressClickUntil = performance.now() + 150;
      if (!accept) {
        arrange(original, chip); status.textContent = `${chip.dataset.sortKey} 순서 변경을 취소했습니다.`;
      } else commit(chip);
      const preview = ghost; ghost = undefined;

      /**
       * 착지 표시·복제본 정리 후 보이는 손잡이로 포커스 복원
       */
      const complete = () => {
        preview.remove();
        if (animate) landed(chip); else chip.classList.remove('is-drag-placeholder');
        if (accept) {
          chip.querySelector<HTMLButtonElement>('.chip-drag-handle')?.focus({ preventScroll: true });
          // 검색 입력의 blur가 입력 중인 태그를 확정해 칩을 다시 그린 경우 새 손잡이 사용
          if (!chip.isConnected) items().find(item => item.dataset.sortKey === chip.dataset.sortKey)
            ?.querySelector<HTMLButtonElement>('.chip-drag-handle')?.focus({ preventScroll: true });
        }
      };
      if (animate && !reducedMotion.matches && chip.isConnected) {
        const target = chip.getBoundingClientRect();
        preview.animate([{ transform: preview.style.transform }, { transform: `translate(${target.x}px,${target.y}px) scale(1)` }],
          { duration: 160, easing: 'ease-out', fill: 'forwards' }).finished.then(complete, complete);
      } else complete();
    }
    cancelActive = () => finish(false, false);
    // 일정 거리 이상 움직인 뒤 드래그 시작, 단순 클릭은 순서를 바꾸지 않음
    window.addEventListener('pointermove', move => {
      if (move.pointerId !== event.pointerId) return;
      x = move.clientX; y = move.clientY;
      if (!ghost && Math.hypot(x - event.clientX, y - event.clientY) < 6) return;
      move.preventDefault();
      if (!ghost) {
        ghost = chip.cloneNode(true) as HTMLElement; ghost.classList.add('chip-drag-preview'); ghost.inert = true; ghost.setAttribute('aria-hidden', 'true');
        ghost.style.width = `${start.width}px`; ghost.style.height = `${start.height}px`;
        (dialog ?? document.body).append(ghost); chip.classList.add('is-drag-placeholder');
        status.textContent = `${chip.dataset.sortKey} 이동 중. 놓아서 확정하거나 Escape로 취소하세요.`;
        frame = requestAnimationFrame(tick);
      }
      positionGhost(); movePlaceholder();
    }, { signal, passive: false });
    window.addEventListener('pointerup', up => {
      if (up.pointerId !== event.pointerId) return;
      x = up.clientX; y = up.clientY; finish(inside());
    }, { signal });
    window.addEventListener('pointercancel', cancel => { if (cancel.pointerId === event.pointerId) finish(false, false); }, { signal });
    container.addEventListener('lostpointercapture', () => finish(false, false), { signal });
    window.addEventListener('resize', () => finish(false, false), { signal });
    dialog?.addEventListener('close', () => finish(false, false), { signal });
    container.closest('form')?.addEventListener('submit', () => finish(false, false), { signal, capture: true });
    window.addEventListener('keydown', key => {
      if (key.key === 'Escape') { key.preventDefault(); key.stopPropagation(); finish(false); }
    }, { signal, capture: true });
  });
  // 드래그 직후 발생하는 클릭이 삭제 버튼으로 전달되지 않도록 차단
  container.addEventListener('click', event => {
    if (event.detail && performance.now() < suppressClickUntil) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, { capture: true });
  // 포커스한 손잡이에서 방향키·Home·End로 순서 변경
  container.addEventListener('keydown', event => {
    if (cancelActive || !(event.target instanceof Element) || !event.target.closest('.chip-drag-handle')) return;
    const chip = event.target.closest<HTMLElement>('[data-sort-key]')!;
    const order = items(), from = order.indexOf(chip);
    const to = event.key === 'Home' ? 0 : event.key === 'End' ? order.length - 1 : ['ArrowLeft', 'ArrowUp'].includes(event.key) ? from - 1 : ['ArrowRight', 'ArrowDown'].includes(event.key) ? from + 1 : null;
    if (to === null) return;
    event.preventDefault();
    if (to < 0 || to >= order.length || to === from) return;
    order.splice(from, 1); order.splice(to, 0, chip); arrange(order); commit(chip); landed(chip);
    chip.querySelector<HTMLButtonElement>('.chip-drag-handle')?.focus({ preventScroll: true });
  });
  return { refresh, cancel: () => cancelActive?.() };
}
