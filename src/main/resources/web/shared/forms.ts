export type Badge = { id: number; name: string; imageUrl: string };
type ProjectMetadata = { projectStatus: string | null; startPeriod: string | null; endPeriod: string | null; stackBadges: Badge[] };
const apiBase = document.body.dataset.apiBase ?? '';

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (text) item.textContent = text;
  return item;
}
export function setMessage(target: HTMLElement, message: string, error = false) {
  target.textContent = message;
  target.hidden = !message;
  target.classList.toggle('error', error);
  target.setAttribute('role', error ? 'alert' : 'status');
}

export function field(form: HTMLElement, title: string, name: string, value = '', options: { required?: boolean; max?: number; type?: string; wide?: boolean; placeholder?: string } = {}) {
  const label = el('label', options.wide ? 'wide' : '', title);
  const input = el('input');
  input.name = name;
  input.type = options.type ?? 'text';
  input.value = value;
  input.required = options.required ?? false;
  if (options.max) input.maxLength = options.max;
  if (options.placeholder) input.placeholder = options.placeholder;
  label.append(input);
  form.append(label);
  return input;
}
export function area(form: HTMLElement, title: string, name: string, value = '', max = 500, wide = true) {
  const label = el('label', wide ? 'wide' : '', title);
  const input = el('textarea');
  input.name = name; input.value = value; input.rows = 3; input.maxLength = max;
  label.append(input); form.append(label);
  return input;
}
export function choice(form: HTMLElement, title: string, name: string, options: Array<[string, string]>, value = options[0]?.[0] ?? '') {
  const label = el('label', '', title);
  const input = el('select');
  input.name = name;
  for (const [key, caption] of options) {
    const option = el('option', '', caption);
    option.value = key;
    input.append(option);
  }
  input.value = value;
  label.append(input); form.append(label);
  return input;
}
export function submit(form: HTMLFormElement, title: string) {
  const row = el('div', 'form-actions');
  const button = el('button', 'button primary', title);
  button.type = 'submit';
  row.append(button);
  form.append(row);
}
export function value(data: FormData, name: string): string { return String(data.get(name) ?? '').trim(); }

let pickerId = 0;
export function stackPicker(parent: HTMLElement, badges: Badge[], initial: string[] = []) {
  const group = el('fieldset', 'wide stack-picker');
  group.append(el('legend', '', '기술 스택'));
  let selected = [...initial];
  const chips = el('div', 'stack-chips');
  const input = el('input', 'stack-search');
  input.type = 'search'; input.placeholder = '기술 스택 검색'; input.autocomplete = 'off';
  input.setAttribute('aria-label', '기술 스택 검색'); input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list'); input.setAttribute('aria-expanded', 'false');
  const list = el('div', 'stack-options'); list.id = `stack-options-${++pickerId}`;
  list.setAttribute('role', 'listbox'); list.setAttribute('aria-label', '등록된 기술 스택'); list.hidden = true;
  input.setAttribute('aria-controls', list.id);
  const values = el('div');
  let active = -1;
  function icon(badge: Badge) {
    const image = el('img'); image.src = new URL(`/api/v1/stack-badges/${badge.id}/image`, apiBase).href;
    image.width = 20; image.height = 20; image.alt = ''; image.addEventListener('error', () => { image.hidden = true; });
    return image;
  }
  function close() { list.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); active = -1; }
  function options() {
    list.replaceChildren(); active = -1; input.removeAttribute('aria-activedescendant');
    const matches = badges.filter(b => !selected.includes(b.name) && b.name.toLocaleLowerCase().includes(input.value.trim().toLocaleLowerCase()));
    for (const badge of matches) {
      const option = el('button', 'stack-option'); option.type = 'button'; option.tabIndex = -1;
      option.id = `${list.id}-${badge.id}`; option.setAttribute('role', 'option'); option.setAttribute('aria-selected', 'false');
      option.append(icon(badge), document.createTextNode(badge.name));
      option.addEventListener('mousedown', event => event.preventDefault());
      option.addEventListener('click', () => {
        if (selected.length >= 30) return;
        selected.push(badge.name); input.value = ''; render(); input.focus(); options();
      }); list.append(option);
    }
    if (!matches.length) list.append(el('p', 'stack-empty', badges.length ? '선택할 기술 스택이 없습니다.' : '등록된 기술 스택이 없습니다.'));
    if (selected.length >= 30) list.replaceChildren(el('p', 'stack-empty', '기술 스택은 최대 30개까지 선택할 수 있습니다.'));
    list.hidden = false; input.setAttribute('aria-expanded', 'true');
  }
  function render() {
    chips.replaceChildren(); values.replaceChildren();
    for (const name of selected) {
      const chip = el('span', 'stack-chip');
      const badge = badges.find(b => b.name === name); if (badge) chip.append(icon(badge));
      chip.append(document.createTextNode(name));
      const remove = el('button', 'chip-remove', '×'); remove.type = 'button'; remove.setAttribute('aria-label', `${name} 선택 해제`);
      remove.addEventListener('click', () => { selected = selected.filter(item => item !== name); render(); input.focus(); options(); });
      chip.append(remove); chips.append(chip);
      const hidden = el('input'); hidden.type = 'hidden'; hidden.name = 'stackBadgeNames'; hidden.value = name; values.append(hidden);
    }
  }
  input.addEventListener('focus', options); input.addEventListener('input', options);
  input.addEventListener('keydown', event => {
    if (event.isComposing) return;
    if (event.key === 'Escape' && !list.hidden) { event.preventDefault(); event.stopPropagation(); close(); return; }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault(); if (list.hidden) options();
      const buttons = [...list.querySelectorAll<HTMLButtonElement>('button')];
      if (!buttons.length) return;
      active = (active + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      buttons.forEach((button, index) => button.setAttribute('aria-selected', String(index === active)));
      input.setAttribute('aria-activedescendant', buttons[active].id); buttons[active].scrollIntoView({ block: 'nearest' });
    } else if (event.key === 'Enter') {
      event.preventDefault(); if (!list.hidden && active >= 0) list.querySelectorAll<HTMLButtonElement>('button')[active]?.click();
    }
  });
  group.addEventListener('focusout', event => { if (!(event.relatedTarget instanceof Node) || !group.contains(event.relatedTarget)) close(); });
  group.append(chips, input, list, values); parent.append(group); render();
}
function badgeNames(data: FormData): string[] { return data.getAll('stackBadgeNames').map(String); }

export function seriesMetadata(input: FormData, project: boolean) {
  return { name: value(input, 'name'), description: value(input, 'description'),
    ...(project ? { projectStatus: value(input, 'projectStatus'), startPeriod: value(input, 'startPeriod'),
      endPeriod: value(input, 'endPeriod') || null, stackBadgeNames: badgeNames(input) } : {}) };
}
export function projectFields(parent: HTMLElement, badges: Badge[], item?: ProjectMetadata) {
  choice(parent, '상태', 'projectStatus', [['PLAN', '기획'], ['DEV', '개발'], ['MAINT', '유지보수'], ['DONE', '완료']], item?.projectStatus ?? 'PLAN');
  const start = field(parent, '시작 기간', 'startPeriod', item?.startPeriod ?? '', { required: true, placeholder: 'YYYY.MM', max: 7 });
  start.pattern = '[0-9]{4}\\.(0[1-9]|1[0-2])';
  const end = field(parent, '종료 기간', 'endPeriod', item?.endPeriod ?? '', { placeholder: 'YYYY.MM', max: 7 });
  end.pattern = start.pattern;
  stackPicker(parent, badges, item?.stackBadges.map(b => b.name) ?? []);
}

