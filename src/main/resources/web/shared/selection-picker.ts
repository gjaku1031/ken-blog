import { el } from './dom';
import { listbox } from './dropdown';
import { sortableChips } from './sortable-chips';

/**
 * 여러 값 선택 입력의 후보
 */
export type PickerOption = {
  /**
   * 제출할 값
   */
  value: string;

  /**
   * 후보 옆의 사용 건수
   */
  count?: number;

  /**
   * 칩·후보의 장식 아이콘 생성기
   */
  icon?: () => HTMLElement;
};

/**
 * 태그·기술 선택의 표시·생성·검증 정책
 */
type PickerOptions = {
  /**
   * 범례
   */
  title: string;

  /**
   * 폼 필드명
   */
  name: string;

  /**
   * 화면별 스타일 클래스
   */
  className: string;

  /**
   * 입력 안내
   */
  placeholder: string;

  /**
   * 접근성 검색 이름
   */
  searchLabel: string;

  /**
   * 저장 순서를 유지할 초기 값
   */
  initial: string[];

  /**
   * 등록 후보 목록
   */
  items: PickerOption[];

  /**
   * 최대 선택 수
   */
  maximum: number;

  /**
   * 신규 값 입력 허용 시 코드포인트 길이 제한
   */
  createMaxLength?: number;

  /**
   * 입력 정규화
   */
  normalize?: (value: string) => string;

  /**
   * 표시 문구 변환
   */
  caption?: (value: string) => string;

  /**
   * 제거 버튼의 접근성 이름
   */
  removeLabel: (value: string) => string;
};

/**
 * 선택 순서·검색·칩 제거·키보드·숨은 제출값을 공유하는 입력
 *
 * 1. 후보와 초기 선택값 구성
 * 2. 길이·개수·대소문자 중복 검사 후 선택 변경
 * 3. 폼 제출 전에 입력 중인 신규 값 반영
 */
export function selectionPicker(parent: HTMLElement, options: PickerOptions) {
  const group = el('fieldset', `wide ${options.className}`); group.append(el('legend', '', options.title));
  let selected = [...options.initial];
  const chips = el('div', 'stack-chips'), values = el('div'), list = el('div');
  const input = el('input', 'stack-search'); input.type = 'text'; input.autocomplete = 'off'; input.placeholder = options.placeholder;
  input.setAttribute('aria-label', options.searchLabel); input.setAttribute('aria-autocomplete', 'list');
  if (options.createMaxLength) input.maxLength = options.createMaxLength * 2;
  // 정렬 결과를 같은 선택 상태와 제출값에 반영, 태그·기술별 중복 구현 방지
  const sorting = sortableChips(chips, order => { selected = order; syncValues(); });

  /**
   * 현재 선택·정렬 순서의 숨김 폼 값 갱신
   */
  function syncValues() {
    values.replaceChildren();
    for (const value of selected) {
      const hidden = el('input'); hidden.type = 'hidden'; hidden.name = options.name; hidden.value = value; values.append(hidden);
    }
  }

  /**
   * 후보·선택 비교용 대소문자 정규화
   */
  const key = (value: string) => value.toLocaleLowerCase('und');

  /**
   * 입력 공백과 화면별 접두사 정리
   */
  const normalize = (value: string) => options.normalize?.(value.trim()) ?? value.trim();

  /**
   * 표시 문구 변환
   */
  const caption = (value: string) => options.caption?.(value) ?? value;

  /**
   * 선택된 값의 대소문자 무관 중복 판별
   */
  const has = (value: string) => selected.some(item => key(item) === key(value));

  /**
   * 아이콘과 문구로 칩·후보 내용 구성
   */
  function label(target: HTMLElement, value: string) {
    const icon = options.items.find(item => key(item.value) === key(value))?.icon?.();
    if (icon) target.append(icon);
    target.append(el('span', 'chip-label', caption(value)));
  }

  /**
   * 선택 순서대로 칩과 제출 값을 함께 갱신
   */
  function render() {
    sorting.cancel(); chips.replaceChildren();
    for (const value of selected) {
      const chip = el('span', 'stack-chip'); chip.dataset.sortKey = value; chip.title = caption(value); label(chip, value);
      const remove = el('button', 'chip-remove', '×'); remove.type = 'button'; remove.setAttribute('aria-label', options.removeLabel(value));
      remove.addEventListener('click', () => {
        selected = selected.filter(item => item !== value); input.setCustomValidity(''); render(); input.focus(); popup.refresh();
      });
      chip.append(remove); chips.append(chip);
    }
    syncValues(); sorting.refresh();
  }

  /**
   * 유효한 후보·신규 값을 선택하고 입력 오류 갱신
   */
  function add(raw: string) {
    const value = normalize(raw);
    const candidate = options.items.find(item => key(item.value) === key(value));
    if (!value || (!candidate && !options.createMaxLength)) return;
    const error = options.createMaxLength && [...value].length > options.createMaxLength ? `${options.title}는 ${options.createMaxLength}자까지 입력하세요.`
      : !has(value) && selected.length >= options.maximum ? `${options.title}는 ${options.maximum}개까지 선택하세요.` : '';
    input.setCustomValidity(error);
    if (error) { input.reportValidity(); return; }
    if (!has(value)) selected.push(candidate?.value ?? value);
    input.value = ''; render(); popup.refresh();
  }

  // 선택 후보의 포인터 동작은 blur보다 먼저 처리하여 입력 중인 값의 중복 추가 방지
  const popup = listbox(input, list, () => {
    list.replaceChildren();
    const term = normalize(input.value);
    const matches = options.items.filter(item => !has(item.value) && key(item.value).includes(key(term)));

    /**
     * 키보드·포인터로 선택할 한 후보 구성
     */
    function option(item: PickerOption, create = false) {
      const row = el('button', 'picker-option stack-option'); row.type = 'button'; row.tabIndex = -1;
      row.setAttribute('role', 'option'); row.setAttribute('aria-selected', 'false');
      if (create) row.textContent = `＋ “${item.value}” 추가`; else label(row, item.value);
      if (item.count !== undefined) row.append(el('span', 'picker-count', String(item.count)));
      row.addEventListener('mousedown', event => event.preventDefault());
      row.addEventListener('click', () => { add(item.value); input.focus(); }); list.append(row);
    }
    matches.forEach(item => option(item));
    if (options.createMaxLength && term && !has(term) && !options.items.some(item => key(item.value) === key(term))) option({ value: term }, true);
    if (!list.childElementCount) list.append(el('p', 'stack-empty', `선택할 ${options.title}가 없습니다.`));
  });
  input.addEventListener('focus', popup.open);
  input.addEventListener('input', () => { input.setCustomValidity(''); popup.open(); });
  input.addEventListener('keydown', event => {
    if (!event.isComposing && (event.key === 'Enter' || (options.createMaxLength && event.key === ','))) {
      if (!event.defaultPrevented && options.createMaxLength) add(input.value);
      event.preventDefault();
    }
  });
  if (options.createMaxLength) input.addEventListener('blur', () => { if (input.value.trim()) add(input.value); });
  group.append(chips, input, list, values); parent.append(group); render();
}
