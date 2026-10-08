import { el } from './dom';
export { el } from './dom';
import { selectionPicker } from './selection-picker';
import { styleChoice } from './dropdown';

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
 * 기술 목록에서 선택 순서를 보존하며 최대 30개 지정
 */
function stackPicker(parent: HTMLElement, badges: Badge[], initial: string[] = []) {
  selectionPicker(parent, { title: '기술 스택', name: 'stackBadgeNames', className: 'stack-picker',
    placeholder: '기술 스택 검색', searchLabel: '기술 스택 검색', initial, maximum: 30,
    items: badges.map(badge => ({ value: badge.name, icon: () => stackIcon(badge) })), removeLabel: value => `${value} 선택 해제` });
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
