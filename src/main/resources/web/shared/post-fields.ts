import { el, field, area, choice, value } from './forms';
import { listbox } from './dropdown';
import type { Series } from './series-editor';
import { categoryTreePicker } from './category-select';

/**
 * 분류 트리 노드
 */
export type Category = {
  /**
   * ID
   */
  id: number;

  /**
   * 분류 경로
   */
  path: string;

  /**
   * 이름
   */
  name: string;

  /**
   * 분류 깊이
   */
  depth: number;

  /**
   * 정렬 순서
   */
  sortOrder: number;

  /**
   * 초안을 포함한 해당 분류와 모든 하위 분류의 글 수
   */
  totalCount?: number;

  /**
   * 초안을 포함한 해당 분류의 직접 글 수
   */
  directCount: number;

  /**
   * 하위 분류 목록
   */
  children: Category[]
};

/**
 * 태그 이름과 사용 건수
 */
export type Tag = {
  /**
   * 이름
   */
  name: string;

  /**
   * 분류의 직접 글과 하위 글 수 합산
   */
  count: number
};

/**
 * 글 작성에 사용할 분류·태그·시리즈 목록
 */
export type PostOptions = {
  /**
   * 분류 목록
   */
  categories: Category[];

  /**
   * 태그 목록
   */
  tags: Tag[];

  /**
   * 시리즈
   */
  series: Series[]
};

/**
 * 대분류·소분류를 구분하는 분류 선택 입력
 */
export function categoryPicker(parent: HTMLElement, categories: Category[], selected: number | null = null) {
  const group = el('fieldset', 'wide category-picker field-grid'); group.append(el('legend', '', '분류'));
  const root = categories.find(item => item.id === selected || item.children.some(child => child.id === selected));
  const major = choice(group, '대분류', 'categoryRoot', [['', '분류 없음'], ...categories.map(item => [String(item.id), item.name] as [string, string])], String(root?.id ?? ''));
  const minor = choice(group, '소분류', 'categoryChild', []);
  const hidden = el('input'); hidden.type = 'hidden'; hidden.name = 'categoryId'; group.append(hidden);

  /**
   * 소분류 우선으로 제출할 분류 ID 갱신
   */
  const sync = () => { hidden.value = minor.value || major.value; };

  /**
   * 선택한 대분류의 소분류 목록 갱신
   */
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

/**
 * 기존 태그 검색과 새 태그 입력 구성
 *
 * 1. 기존 태그 선택 목록 준비
 * 2. 길이·개수·대소문자 중복 검사 후 추가
 * 3. 기존 태그 검색과 새 태그 생성 후보 구성
 * 4. Enter 없이 저장해도 입력 중인 태그를 선택에 반영
 */
export function tagPicker(parent: HTMLElement, tags: Tag[], initial: string[] = []) {
  const group = el('fieldset', 'wide tag-picker'); group.append(el('legend', '', '태그'));
  // 기존 태그 선택 목록 준비
  let selected = [...initial];
  const chips = el('div', 'stack-chips'); const values = el('div');
  const input = el('input'); input.type = 'text'; input.placeholder = '기존 태그 검색 또는 새 태그 입력'; input.autocomplete = 'off'; input.maxLength = 80;
  input.setAttribute('aria-label', '태그 검색'); input.setAttribute('aria-autocomplete', 'list');
  const list = el('div');

  /**
   * 대소문자와 무관하게 이미 선택한 태그인지 확인
   */
  const has = (name: string) => selected.some(tag => tag.toLowerCase() === name.toLowerCase());

  /**
   * 선택 태그 칩과 제출할 폼 값 갱신
   */
  function render() {
    chips.replaceChildren(); values.replaceChildren();
    for (const name of selected) {
      const chip = el('span', 'stack-chip', `#${name}`); const remove = el('button', 'chip-remove', '×'); remove.type = 'button'; remove.setAttribute('aria-label', `${name} 태그 제거`);
      remove.addEventListener('click', () => { selected = selected.filter(tag => tag !== name); render(); input.focus(); popup.refresh(); });
      chip.append(remove); chips.append(chip);
      const hidden = el('input'); hidden.type = 'hidden'; hidden.name = 'tags'; hidden.value = name; values.append(hidden);
    }
  }
  // 길이·개수·대소문자 중복 검사 후 추가

  /**
   * 유효한 태그를 중복 없이 선택 목록에 추가
   */
  function add(raw: string) {
    const name = raw.trim().replace(/^#/, '');
    const error = [...name].length > 40 ? '태그는 40자까지 입력하세요.' : name && !has(name) && selected.length >= 16 ? '태그는 16개까지 선택하세요.' : '';
    input.setCustomValidity(error);
    if (error) { input.reportValidity(); return; }
    if (name && !has(name)) selected.push(name);
    input.value = ''; render(); popup.refresh();
  }
  // 기존 태그 검색과 새 태그 생성 후보 구성
  const popup = listbox(input, list, () => {
    list.replaceChildren(); const term = input.value.trim().replace(/^#/, '');
    const matches = tags.filter(tag => !has(tag.name) && tag.name.toLocaleLowerCase().includes(term.toLocaleLowerCase()));

    /**
     * 이름·표시 문구·사용 건수로 태그 후보 생성
     */
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
  // Enter 없이 저장해도 입력 중인 태그를 선택에 반영
  // Enter 없이 저장해도 입력 중인 태그를 선택에 반영
  input.addEventListener('blur', () => { if (input.value.trim()) add(input.value); });
  group.append(chips, input, list, values); parent.append(group); render();
}

/**
 * 글 작성·수정에 공통으로 사용하는 메타데이터 입력 구성
 * 생략한 초기값은 빈 입력, 프로젝트 글은 태그·관련 프로젝트 제외
 * Posts는 왼쪽 메타데이터 입력과 오른쪽 분류 트리로 분리
 */
export function postFields(parent: HTMLElement, data: PostOptions, project: boolean, initial: Partial<ReturnType<typeof postPayload>> = {}) {
  // Posts의 작성·수정 진입점 모두 같은 두 칸 배치 사용
  let fields = parent;
  if (!project) {
    const columns = el('div', 'post-form-columns wide');
    fields = el('div', 'post-form-main field-grid');
    columns.append(fields); categoryTreePicker(columns, data.categories, initial.categoryId);
    parent.append(columns);
  }
  // 제목·요약·분류·태그의 기존 값 반영
  field(fields, '제목', 'title', initial.title ?? '', { required: true, max: 200, wide: true });
  area(fields, '요약', 'summary', initial.summary ?? '', 120);
  if (project) categoryPicker(fields, data.categories, initial.categoryId);
  else tagPicker(fields, data.tags, initial.tags);
  // 글 섹션에 맞는 소속만 선택 가능, 프로젝트 글은 소속 필수
  const groups = data.series.filter(item => item.kind === (project ? 'PROJECT' : 'TECH'));
  const select = choice(fields, project ? '프로젝트' : '시리즈', 'seriesId', [['', project ? '프로젝트 선택' : '없음'], ...groups.map(item => [String(item.id), item.name] as [string, string])], groups.some(item => item.id === initial.seriesId) ? String(initial.seriesId) : '');
  select.required = project;
  field(fields, '문서 순서 (비우면 마지막)', 'order', String(initial.order ?? ''), { type: 'number' }).min = '1';
  if (!project) {
    const related = choice(fields, '관련 프로젝트', 'relatedSeriesId', [['', '없음'], ...data.series.filter(item => item.kind === 'PROJECT').map(item => [String(item.id), item.name] as [string, string])], String(initial.relatedSeriesId ?? ''));
    related.closest('label')?.classList.add('wide');
  }
}

/**
 * 폼에서 순서대로 선택한 태그 이름 수집
 */
export const postTags = (data: FormData) => data.getAll('tags').map(String);

/**
 * 글 작성·수정 폼을 메타데이터 값으로 변환
 */
export function postPayload(input: FormData) {
  /**
   * 선택 숫자 입력 변환, 빈 값이면 null
   */
  const number = (name: string) => value(input, name) ? Number(value(input, name)) : null;
  return { title: value(input, 'title'), summary: value(input, 'summary'), categoryId: number('categoryId'), tags: postTags(input),
    seriesId: number('seriesId'), relatedSeriesId: number('relatedSeriesId'), order: number('order') };
}
