import { listbox, styleChoice } from './dropdown';
/**
 * 기술 뱃지
 */
export type Badge = {
  /**
   * ID
   */
  id: number;
  /**
   * 이름
   */
  name: string;
  /**
   * 공개 이미지 URL
   */
  imageUrl: string
};
/**
 * 시리즈 편집에 필요한 메타데이터
 */
export type SeriesMetadata = {
  /**
   * 이름
   */
  name: string;
  /**
   * 설명
   */
  description: string;
  /**
   * 정렬 순서
   */
  sortOrder: number;
  /**
   * 프로젝트 진행 상태
   */
  projectStatus: string | null;
  /**
   * 시작 연월
   */
  startPeriod: string | null;
  /**
   * 종료 연월
   */
  endPeriod: string | null;
  /**
   * 선택 순서의 기술 뱃지 목록
   */
  stackBadges: Badge[]
};
/**
 * 관리자 API 기준 URL
 */
const apiBase = document.body.dataset.apiBase ?? '';

/**
 * 태그·클래스·텍스트로 DOM 요소 생성
 */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (text) item.textContent = text;
  return item;
}
/**
 * 결과 메시지와 오류 표시 갱신
 */
export function setMessage(target: HTMLElement, message: string, error = false) {
  target.textContent = message;
  target.hidden = !message;
  target.classList.toggle('error', error);
  target.setAttribute('role', error ? 'alert' : 'status');
}

/**
 * 입력 필드 생성
 */
export function field(form: HTMLElement, title: string, name: string, value = '', options: {
  /**
   * 필수 입력 여부
   */
  required?: boolean;
  /**
   * 입력 길이 상한
   */
  max?: number;
  /**
   * 종류
   */
  type?: string;
  /**
   * 넓은 입력 영역 여부
   */
  wide?: boolean;
  /**
   * 입력 안내 문구
   */
  placeholder?: string
} = {}) {
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
/**
 * 여러 줄 입력 필드 생성
 */
export function area(form: HTMLElement, title: string, name: string, value = '', max = 500, wide = true) {
  const label = el('label', wide ? 'wide' : '', title);
  const input = el('textarea');
  input.name = name; input.value = value; input.rows = 3; input.maxLength = max;
  label.append(input); form.append(label);
  return input;
}
/**
 * 선택 목록 생성
 */
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
  styleChoice(input, label, title);
  return input;
}
/**
 * 폼 제출 버튼 추가
 */
export function submit(form: HTMLFormElement, title: string) {
  const row = el('div', 'form-actions');
  const button = el('button', 'button primary', title);
  button.type = 'submit';
  row.append(button);
  form.append(row);
}
/**
 * 폼 입력의 앞뒤 공백 제거
 */
export function value(data: FormData, name: string): string { return String(data.get(name) ?? '').trim(); }

/**
 * 등록 기술 아이콘 표시, 로딩 실패 시 숨김
 */
export function stackIcon(badge: Badge) {
  const image = el('img'); image.src = new URL(`/api/v1/stack-badges/${badge.id}/image`, apiBase).href;
  image.width = 20; image.height = 20; image.alt = ''; image.dataset.stackName = badge.name; image.addEventListener('error', () => { image.hidden = true; });
  return image;
}

/**
 * 검색·다중 선택·해제를 지원하는 기술 입력 구성
 *
 * 1. 현재 기술 선택 순서 보존
 * 2. 검색어와 선택 개수 제한에 맞는 후보 구성
 * 3. 선택 기술 칩·제출 값을 함께 갱신
 * 4. 검색 포커스·입력·키보드 처리를 선택 목록에 연결
 */
export function stackPicker(parent: HTMLElement, badges: Badge[], initial: string[] = []) {
  const group = el('fieldset', 'wide stack-picker');
  group.append(el('legend', '', '기술 스택'));
  // 현재 기술 선택 순서 보존
  let selected = [...initial];
  const chips = el('div', 'stack-chips');
  const input = el('input', 'stack-search');
  input.type = 'search'; input.placeholder = '기술 스택 검색'; input.autocomplete = 'off';
  input.setAttribute('aria-label', '기술 스택 검색'); input.setAttribute('aria-autocomplete', 'list');
  const list = el('div');
  const values = el('div');
  // 검색어와 선택 개수 제한에 맞는 후보 구성
  /**
   * 검색어에 맞는 미선택 기술 후보 표시
   */
  function options() {
    list.replaceChildren();
    const matches = badges.filter(b => !selected.includes(b.name) && b.name.toLocaleLowerCase().includes(input.value.trim().toLocaleLowerCase()));
    for (const badge of matches) {
      const option = el('button', 'picker-option stack-option'); option.type = 'button'; option.tabIndex = -1;
      option.setAttribute('role', 'option'); option.setAttribute('aria-selected', 'false');
      option.append(stackIcon(badge), document.createTextNode(badge.name));
      option.addEventListener('mousedown', event => event.preventDefault());
      option.addEventListener('click', () => {
        if (selected.length >= 30) return;
        selected.push(badge.name); input.value = ''; render(); input.focus(); popup.refresh();
      }); list.append(option);
    }
    if (!matches.length) list.append(el('p', 'stack-empty', badges.length ? '선택할 기술 스택이 없습니다.' : '등록된 기술 스택이 없습니다.'));
    if (selected.length >= 30) list.replaceChildren(el('p', 'stack-empty', '기술 스택은 최대 30개까지 선택할 수 있습니다.'));
  }
  // 선택 기술 칩·제출 값을 함께 갱신
  /**
   * 선택 기술을 칩·숨김 폼 값으로 갱신
   */
  function render() {
    chips.replaceChildren(); values.replaceChildren();
    for (const name of selected) {
      const chip = el('span', 'stack-chip');
      const badge = badges.find(b => b.name === name); if (badge) chip.append(stackIcon(badge));
      chip.append(document.createTextNode(name));
      const remove = el('button', 'chip-remove', '×'); remove.type = 'button'; remove.setAttribute('aria-label', `${name} 선택 해제`);
      remove.addEventListener('click', () => { selected = selected.filter(item => item !== name); render(); input.focus(); popup.refresh(); });
      chip.append(remove); chips.append(chip);
      const hidden = el('input'); hidden.type = 'hidden'; hidden.name = 'stackBadgeNames'; hidden.value = name; values.append(hidden);
    }
  }
  group.append(chips, input, list, values); parent.append(group); render();
  // 검색 포커스·입력·키보드 처리를 선택 목록에 연결
  const popup = listbox(input, list, options);
  input.addEventListener('focus', popup.open); input.addEventListener('input', popup.open);
  input.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.isComposing) event.preventDefault(); });
}
/**
 * 선택한 기술 이름 목록 조회
 */
function badgeNames(data: FormData): string[] { return data.getAll('stackBadgeNames').map(String); }

/**
 * 폼 입력을 시리즈 속성 요청으로 변환
 */
export function seriesMetadata(input: FormData, project: boolean) {
  return { name: value(input, 'name'), description: value(input, 'description'),
    ...(project ? { projectStatus: value(input, 'projectStatus'), startPeriod: value(input, 'startPeriod'),
      endPeriod: value(input, 'endPeriod') || null, stackBadgeNames: badgeNames(input) } : {}) };
}
/**
 * 시리즈 공통 항목과 프로젝트 전용 상태·기간·기술 입력 구성
 */
export function seriesFormFields(parent: HTMLElement, badges: Badge[], project: boolean, item?: SeriesMetadata) {
  const layout = el('div', project ? 'wide project-form-columns' : 'wide series-form-basic');
  const main = el('div', 'project-form-main');
  field(main, '이름', 'name', item?.name ?? '', { required: true, max: 200 });
  area(main, '개요', 'description', item?.description ?? '', 1000);
  const order = field(main, '카드 순서', 'order', String(item?.sortOrder ?? 0), { type: 'number', required: true });
  order.min = '-2147483648'; order.max = '2147483647';
  layout.append(main); parent.append(layout);
  if (!project) return;
  const details = el('div', 'project-form-details'); layout.append(details);
  const period = el('fieldset', 'project-period-fields'); period.append(el('legend', '', '기간'));
  const start = field(period, '시작', 'startPeriod', item?.startPeriod ?? '', { required: true, placeholder: 'YYYY.MM', max: 7 });
  start.pattern = '[0-9]{4}\\.(0[1-9]|1[0-2])';
  const end = field(period, '종료', 'endPeriod', item?.endPeriod ?? '', { placeholder: '현재', max: 7 });
  end.pattern = start.pattern;
  details.append(period);
  choice(details, '상태', 'projectStatus', [['PLAN', '기획'], ['DEV', '개발'], ['MAINT', '유지보수'], ['DONE', '완료']], item?.projectStatus ?? 'PLAN');
  stackPicker(details, badges, item?.stackBadges.map(b => b.name) ?? []);
}
