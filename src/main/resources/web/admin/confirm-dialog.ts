import { el } from '../shared/dom';

/**
 * 확인 모달의 문구와 강조 방식
 */
type ConfirmOptions = {
  /**
   * 모달 제목
   */
  title: string;

  /**
   * 결과와 영향을 설명하는 본문
   */
  message: string;

  /**
   * 확인 버튼 문구
   */
  confirmLabel: string;

  /**
   * 되돌리기 어려운 동작이면 확인 버튼을 위험 색으로 표시하고 취소에 초기 포커스
   */
  danger?: boolean
};

/**
 * 재사용하는 확인 모달; 처음 호출할 때 생성
 */
let modal: HTMLDialogElement | undefined;

/**
 * 진행 중인 확인 요청의 결과 전달 함수
 */
let settle: ((accepted: boolean) => void) | undefined;

/**
 * 모달을 닫고 대기 중인 요청에 결과 전달
 */
function finish(accepted: boolean) {
  const done = settle; settle = undefined;
  if (modal?.open) modal.close();
  done?.(accepted);
}

/**
 * 확인 모달 골격 생성과 닫기·Escape·배경 클릭 처리 연결
 */
function ensureModal(): HTMLDialogElement {
  if (modal) return modal;
  const dialog = el('dialog', 'confirm-dialog');
  dialog.setAttribute('aria-labelledby', 'confirm-dialog-title');
  dialog.setAttribute('aria-describedby', 'confirm-dialog-message');
  const title = el('h2', 'confirm-dialog-title'); title.id = 'confirm-dialog-title';
  const message = el('p', 'confirm-dialog-message'); message.id = 'confirm-dialog-message';
  const actions = el('div', 'confirm-dialog-actions');
  const cancel = el('button', 'button', '취소'); cancel.type = 'button'; cancel.dataset.confirmCancel = '';
  const accept = el('button', 'button primary'); accept.type = 'button'; accept.dataset.confirmAccept = '';
  actions.append(cancel, accept);
  // 안쪽 상자에 여백을 두어 dialog 자체를 누른 경우만 배경 클릭으로 판정
  const body = el('div', 'confirm-dialog-body');
  body.append(title, message, actions);
  dialog.append(body);
  // 버튼·Escape·배경 클릭에서 결과를 바로 전달; 비동기 close 이벤트는 다음 요청과 섞일 수 있어 쓰지 않음
  cancel.addEventListener('click', () => finish(false));
  accept.addEventListener('click', () => finish(true));
  dialog.addEventListener('cancel', event => { event.preventDefault(); finish(false); });
  dialog.addEventListener('click', event => { if (event.target === dialog) finish(false); });
  document.body.append(dialog);
  modal = dialog;
  return dialog;
}

/**
 * 시스템 확인창 대신 관리자 화면 모달로 확인
 *
 * 이전 요청이 열려 있으면 취소로 끝낸 뒤 새 요청을 표시함
 *
 * @returns 확인을 누르면 true, 취소·Escape·배경 클릭이면 false
 */
export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  const dialog = ensureModal();
  finish(false);
  dialog.querySelector('.confirm-dialog-title')!.textContent = options.title;
  dialog.querySelector('.confirm-dialog-message')!.textContent = options.message;
  const accept = dialog.querySelector<HTMLButtonElement>('[data-confirm-accept]')!;
  accept.textContent = options.confirmLabel;
  accept.classList.toggle('danger', !!options.danger);
  return new Promise(resolve => {
    settle = resolve;
    dialog.showModal();
    (options.danger ? dialog.querySelector<HTMLButtonElement>('[data-confirm-cancel]')! : accept).focus();
  });
}
