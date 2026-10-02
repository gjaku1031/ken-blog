let sequence = 0;

/** Native form values with one keyboard-accessible, themeable popup across the site. */
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
  const options = () => [...list.querySelectorAll<HTMLButtonElement>('[role=option]')];
  function highlight(index: number) {
    const items = options(); active = index;
    items.forEach((item, i) => { item.classList.toggle('is-active', i === index); item.id = `${list.id}-${i}`; });
    if (items[index]) {
      anchor.setAttribute('aria-activedescendant', items[index].id);
      items[index].scrollIntoView({ block: 'nearest' });
    } else anchor.removeAttribute('aria-activedescendant');
  }
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
  function close() {
    if (!opened) return;
    opened = false; list.hidePopover(); listeners?.abort();
    anchor.setAttribute('aria-expanded', 'false'); anchor.removeAttribute('aria-activedescendant');
  }
  function refresh() {
    render(); highlight(-1); if (opened) position();
  }
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
  return { open, close, refresh, toggle: () => opened ? close() : open(), get active() { return active; } };
}

export function styleChoice(select: HTMLSelectElement, label: HTMLLabelElement, title: string) {
  select.classList.add('choice-native'); select.tabIndex = -1; select.setAttribute('aria-hidden', 'true');
  const trigger = document.createElement('button'); trigger.type = 'button'; trigger.className = 'choice-trigger';
  trigger.setAttribute('aria-label', title);
  const caption = document.createElement('span'); const arrow = document.createElement('span'); arrow.className = 'choice-arrow'; arrow.textContent = '⌄'; arrow.setAttribute('aria-hidden', 'true');
  trigger.append(caption, arrow);
  // Label the visible control, not the hidden native select.
  trigger.id = `choice-${++sequence}`; label.htmlFor = trigger.id;
  const list = document.createElement('div'); label.append(trigger, list);
  function sync() {
    caption.textContent = select.selectedOptions[0]?.textContent ?? '선택';
    trigger.disabled = select.disabled; trigger.setAttribute('aria-disabled', String(select.disabled));
    trigger.setAttribute('aria-required', String(select.required));
  }
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
  new MutationObserver(sync).observe(select, { childList: true, attributes: true, subtree: true });
  select.form?.addEventListener('reset', () => queueMicrotask(sync));
  sync();
}
