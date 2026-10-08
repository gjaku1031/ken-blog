import { selectionPicker } from './selection-picker';
import { el, field, area, choice, value } from './forms';
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
function categoryPicker(parent: HTMLElement, categories: Category[], selected: number | null = null) {
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
 * 기존·새 태그를 최대 16개 선택, 이름은 40 코드포인트까지 허용
 */
function tagPicker(parent: HTMLElement, tags: Tag[], initial: string[] = []) {
  selectionPicker(parent, { title: '태그', name: 'tags', className: 'tag-picker',
    placeholder: '기존 태그 검색 또는 새 태그 입력', searchLabel: '태그 검색', initial, maximum: 16, createMaxLength: 40,
    items: tags.map(tag => ({ value: tag.name, count: tag.count })), normalize: value => value.replace(/^#/, ''),
    caption: value => `#${value}`, removeLabel: value => `${value} 태그 제거` });
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
const postTags = (data: FormData) => data.getAll('tags').map(String);

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
