import { el, field, area, choice, value } from './forms';
import { listbox } from './dropdown';
import type { Series } from './series-editor';

export type Category = { id: number; path: string; name: string; depth: number; sortOrder: number; totalCount?: number; directCount: number; children: Category[] };
export type Tag = { name: string; count: number };
export type PostOptions = { categories: Category[]; tags: Tag[]; series: Series[] };

export function categoryPicker(parent: HTMLElement, categories: Category[], selected: number | null = null) {
  const group = el('fieldset', 'wide category-picker field-grid'); group.append(el('legend', '', '분류'));
  const root = categories.find(item => item.id === selected || item.children.some(child => child.id === selected));
  const major = choice(group, '대분류', 'categoryRoot', [['', '분류 없음'], ...categories.map(item => [String(item.id), item.name] as [string, string])], String(root?.id ?? ''));
  const minor = choice(group, '소분류', 'categoryChild', []);
  const hidden = el('input'); hidden.type = 'hidden'; hidden.name = 'categoryId'; group.append(hidden);
  const sync = () => { hidden.value = minor.value || major.value; };
  function children(current = '') {
    const children = categories.find(item => String(item.id) === major.value)?.children ?? [];
    minor.replaceChildren();
    for (const [key, caption] of [['', major.value ? '소분류 없음' : '대분류를 먼저 선택하세요'], ...children.map(item => [String(item.id), item.name])]) {
      const option = el('option', '', caption); option.value = key; minor.append(option);
    }
    minor.value = current; minor.disabled = !children.length;
    minor.dispatchEvent(new Event('change')); sync();
  }
  major.addEventListener('change', () => children()); minor.addEventListener('change', sync);
  children(root?.id !== selected ? String(selected ?? '') : ''); parent.append(group);
}

export function tagPicker(parent: HTMLElement, tags: Tag[], initial: string[] = []) {
  const group = el('fieldset', 'wide tag-picker'); group.append(el('legend', '', '태그'));
  let selected = [...initial];
  const chips = el('div', 'stack-chips'); const values = el('div');
  const input = el('input'); input.type = 'text'; input.placeholder = '기존 태그 검색 또는 새 태그 입력'; input.autocomplete = 'off'; input.maxLength = 80;
  input.setAttribute('aria-label', '태그 검색'); input.setAttribute('aria-autocomplete', 'list');
  const list = el('div');
  const has = (name: string) => selected.some(tag => tag.toLowerCase() === name.toLowerCase());
  function render() {
    chips.replaceChildren(); values.replaceChildren();
    for (const name of selected) {
      const chip = el('span', 'stack-chip', `#${name}`); const remove = el('button', 'chip-remove', '×'); remove.type = 'button'; remove.setAttribute('aria-label', `${name} 태그 제거`);
      remove.addEventListener('click', () => { selected = selected.filter(tag => tag !== name); render(); input.focus(); popup.refresh(); });
      chip.append(remove); chips.append(chip);
      const hidden = el('input'); hidden.type = 'hidden'; hidden.name = 'tags'; hidden.value = name; values.append(hidden);
    }
  }
  function add(raw: string) {
    const name = raw.trim().replace(/^#/, '');
    const error = [...name].length > 40 ? '태그는 40자까지 입력하세요.' : name && !has(name) && selected.length >= 16 ? '태그는 16개까지 선택하세요.' : '';
    input.setCustomValidity(error);
    if (error) { input.reportValidity(); return; }
    if (name && !has(name)) selected.push(name);
    input.value = ''; render(); popup.refresh();
  }
  const popup = listbox(input, list, () => {
    list.replaceChildren(); const term = input.value.trim().replace(/^#/, '');
    const matches = tags.filter(tag => !has(tag.name) && tag.name.toLocaleLowerCase().includes(term.toLocaleLowerCase()));
    const option = (name: string, caption: string, count?: number) => {
      const row = el('button', 'picker-option', caption); row.type = 'button'; row.tabIndex = -1; row.setAttribute('role', 'option'); row.setAttribute('aria-selected', 'false');
      if (count !== undefined) row.append(el('span', 'picker-count', String(count)));
      row.addEventListener('click', () => add(name)); list.append(row);
    };
    matches.forEach(tag => option(tag.name, `#${tag.name}`, tag.count));
    if (term && !has(term) && !tags.some(tag => tag.name.toLowerCase() === term.toLowerCase())) option(term, `＋ “${term}” 추가`);
    if (!list.childElementCount) list.append(el('p', 'stack-empty', term ? '이미 선택한 태그입니다.' : '태그를 입력하고 Enter로 추가하세요.'));
  });
  input.addEventListener('focus', popup.open); input.addEventListener('input', () => { input.setCustomValidity(''); popup.open(); });
  input.addEventListener('keydown', event => {
    if (!event.isComposing && (event.key === 'Enter' || event.key === ',')) {
      if (!event.defaultPrevented) add(input.value); event.preventDefault();
    }
  });
  // Include a typed tag even when the user saves without pressing Enter.
  input.addEventListener('blur', () => { if (input.value.trim()) add(input.value); });
  group.append(chips, input, list, values); parent.append(group); render();
}

export function taxonomyFields(parent: HTMLElement, data: PostOptions, post?: { category: { id: number } | null; tags: string[] }, includeTags = true) {
  categoryPicker(parent, data.categories, post?.category?.id);
  if (includeTags) tagPicker(parent, data.tags, post?.tags);
}

export function postCreateFields(parent: HTMLElement, data: PostOptions, project: boolean, projectId = '') {
  field(parent, '제목', 'title', '', { required: true, max: 200, wide: true });
  area(parent, '요약', 'summary', '', 120);
  taxonomyFields(parent, data, undefined, !project);
  const groups = data.series.filter(item => item.kind === (project ? 'PROJECT' : 'TECH'));
  const select = choice(parent, project ? '프로젝트' : '시리즈', 'seriesId', [['', project ? '프로젝트 선택' : '없음'], ...groups.map(item => [String(item.id), item.name] as [string, string])], groups.some(item => String(item.id) === projectId) ? projectId : '');
  select.required = project;
  field(parent, '문서 순서 (비우면 마지막)', 'order', '', { type: 'number' }).min = '1';
  if (!project) choice(parent, '관련 프로젝트', 'relatedSeriesId', [['', '없음'], ...data.series.filter(item => item.kind === 'PROJECT').map(item => [String(item.id), item.name] as [string, string])]);
}
export const postTags = (data: FormData) => data.getAll('tags').map(String);
export function postPayload(input: FormData) {
  const number = (name: string) => value(input, name) ? Number(value(input, name)) : null;
  return { title: value(input, 'title'), summary: value(input, 'summary'), categoryId: number('categoryId'), tags: postTags(input),
    seriesId: number('seriesId'), relatedSeriesId: number('relatedSeriesId'), order: number('order') };
}
