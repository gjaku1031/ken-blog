/**
 * 선택 목록·버튼의 고유 ID 순번
 */
let sequence = 0;

/**
 * 사이트 전역에서 기본 폼 값과 키보드 탐색을 유지하는 공통 선택 목록
 *
 * 1. 화면 공간에 맞춰 위·아래 팝업 배치
 * 2. 선택 항목·활성 상태를 복원하고 종료 이벤트 구독
 * 3. 조합 입력은 유지하고 방향키·Enter·Escape·첫 글자 탐색 처리
 */
export function listbox(anchor: HTMLElement, list: HTMLElement, render: () => void) {
  list.id = `options-${++sequence}`;
  list.classList.add('picker-options');
  list.setAttribute('popover', 'manual');
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', anchor.getAttribute('aria-label') ?? '선택');
  anchor.setAttribute('role', 'combobox');
  anchor.setAttribute('aria-haspopup', 'listbox');
  anchor.setAttribute('aria-controls', list.id);
  anchor.setAttribute('aria-expanded', 'false');
  let opened = false;
  let active = -1;
  let listeners: AbortController | undefined;
  /**
   * 선택 가능한 목록 항목 조회
   */
  const options = () => [...list.querySelectorAll<HTMLButtonElement>('[role=option]')];
  /**
   * 키보드 탐색 중인 항목과 접근성 상태 갱신
   */
  function highlight(index: number) {
    const items = options(); active = index;
    items.forEach((item, i) => { item.classList.toggle('is-active', i === index); item.id = `${list.id}-${i}`; });
    if (items[index]) {
      anchor.setAttribute('aria-activedescendant', items[index].id);
      items[index].scrollIntoView({ block: 'nearest' });
    } else anchor.removeAttribute('aria-activedescendant');
  }
  // 화면 공간에 맞춰 위·아래 팝업 배치
  /**
   * 화면 여백에 맞춰 선택 목록의 위치·높이 계산
   */
  function position() {
    const rect = anchor.getBoundingClientRect();
    const width = Math.min(Math.max(rect.width, 200), innerWidth - 24);
    const below = innerHeight - rect.bottom - 12;
    const above = rect.top - 12;
    const up = below < 190 && above > below;
    list.style.width = `${width}px`;
    list.style.maxHeight = `${Math.min(256, Math.max(80, up ? above : below))}px`;
    list.style.left = `${Math.max(12, Math.min(rect.left, innerWidth - width - 12))}px`;
    list.style.top = `${up ? Math.max(12, rect.top - list.offsetHeight - 6) : rect.bottom + 6}px`;
  }
  /**
   * 선택 목록을 닫고 임시 이벤트 구독 해제
   */
  function close() {
    if (!opened) return;
    opened = false; list.hidePopover(); listeners?.abort();
    anchor.setAttribute('aria-expanded', 'false'); anchor.removeAttribute('aria-activedescendant');
  }
  /**
   * 선택 목록과 활성 항목·표시 위치 갱신
   */
  function refresh() {
    render(); highlight(-1); if (opened) position();
  }
  // 선택 항목·활성 상태를 복원하고 종료 이벤트 구독
  /**
   * 선택 목록을 열고 현재 선택·종료 이벤트 연결
   */
  function open() {
    if (anchor.getAttribute('aria-disabled') === 'true') return;
    if (opened) { refresh(); return; }
    render(); opened = true; list.showPopover();
    anchor.setAttribute('aria-expanded', 'true'); position();
    highlight(options().findIndex(option => option.getAttribute('aria-selected') === 'true'));
    listeners = new AbortController(); const { signal } = listeners;
    document.addEventListener('pointerdown', event => {
      if (event.target instanceof Node && !anchor.contains(event.target) && !list.contains(event.target)) close();
    }, { capture: true, signal });
    document.addEventListener('focusin', event => {
      if (event.target instanceof Node && !anchor.contains(event.target) && !list.contains(event.target)) close();
    }, { signal });
    window.addEventListener('resize', position, { signal });
    document.addEventListener('scroll', event => { if (!list.contains(event.target as Node)) position(); }, { capture: true, signal });
    anchor.closest('dialog')?.addEventListener('close', close, { signal });
  }
  list.addEventListener('mousedown', event => event.preventDefault());
  // 조합 입력은 유지하고 방향키·Enter·Escape·첫 글자 탐색 처리
  anchor.addEventListener('keydown', event => {
    if (event.isComposing) return;
    if (event.key === 'Escape' && opened) { event.preventDefault(); event.stopPropagation(); close(); }
    else if (event.key === 'Tab') close();
    else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) && (opened || event.key.startsWith('Arrow'))) {
      event.preventDefault(); if (!opened) open();
      const count = options().length; if (!count) return;
      highlight(event.key === 'Home' ? 0 : event.key === 'End' ? count - 1 :
        active < 0 ? (event.key === 'ArrowDown' ? 0 : count - 1) :
          (active + (event.key === 'ArrowDown' ? 1 : -1) + count) % count);
    } else if ((event.key === 'Enter' || (event.key === ' ' && anchor.tagName === 'BUTTON')) && opened && active >= 0) {
      event.preventDefault(); options()[active]?.click();
    } else if (anchor.tagName === 'BUTTON' && event.key.length === 1 && event.key !== ' ') {
      if (!opened) open();
      const index = options().findIndex(option => option.textContent?.toLocaleLowerCase().startsWith(event.key.toLocaleLowerCase()));
      if (index >= 0) highlight(index);
    }
  });
  return { open, close, refresh, toggle: () => opened ? close() : open(),
  /**
   * 현재 활성 선택 항목의 인덱스
   */
  get active() { return active; } };
}

/**
 * 기본 select를 키보드 접근 가능한 선택 목록으로 연결
 *
 * 1. 기본 select 값을 유지하며 접근 가능한 표시 버튼 구성
 * 2. 선택지를 버튼으로 구성하고 변경을 원래 select에 전달
 * 3. 옵션·입력 제약·폼 초기화에 맞춰 표시값 동기화
 */
export function styleChoice(select: HTMLSelectElement, label: HTMLLabelElement, title: string) {
  // 기본 select 값을 유지하며 접근 가능한 표시 버튼 구성
  select.classList.add('choice-native'); select.tabIndex = -1; select.setAttribute('aria-hidden', 'true');
  const trigger = document.createElement('button'); trigger.type = 'button'; trigger.className = 'choice-trigger';
  trigger.setAttribute('aria-label', title);
  const caption = document.createElement('span'); const arrow = document.createElement('span'); arrow.className = 'choice-arrow'; arrow.textContent = '⌄'; arrow.setAttribute('aria-hidden', 'true');
  trigger.append(caption, arrow);
  // 라벨을 실제 표시·조작하는 선택 버튼에 연결
  trigger.id = `choice-${++sequence}`; label.htmlFor = trigger.id;
  const list = document.createElement('div'); label.append(trigger, list);
  /**
   * 선택 값·입력 제약을 보이는 선택 버튼에 반영
   */
  function sync() {
    caption.textContent = select.selectedOptions[0]?.textContent ?? '선택';
    trigger.disabled = select.disabled; trigger.setAttribute('aria-disabled', String(select.disabled));
    trigger.setAttribute('aria-required', String(select.required));
  }
  // 선택지를 버튼으로 구성하고 변경을 원래 select에 전달
  const popup = listbox(trigger, list, () => {
    sync(); list.replaceChildren();
    for (const option of select.options) {
      const row = document.createElement('button'); row.type = 'button'; row.tabIndex = -1;
      row.className = 'picker-option'; row.textContent = option.textContent; row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(option.selected)); row.disabled = option.disabled;
      row.addEventListener('click', () => { select.value = option.value; select.dispatchEvent(new Event('change', { bubbles: true })); popup.close(); trigger.focus(); });
      list.append(row);
    }
  });
  trigger.addEventListener('click', () => popup.toggle());
  select.addEventListener('change', sync);
  select.addEventListener('invalid', event => { event.preventDefault(); trigger.focus(); popup.open(); });
  // 옵션·입력 제약·폼 초기화에 맞춰 표시값 동기화
  new MutationObserver(sync).observe(select, { childList: true, attributes: true, subtree: true });
  select.form?.addEventListener('reset', () => queueMicrotask(sync));
  sync();
}
