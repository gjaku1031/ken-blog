import { mutate } from './admin-api';
import { el, seriesFormFields, seriesMetadata, submit, value, type Badge, type SeriesMetadata } from './forms';

/**
 * 시리즈 속성과 기술 목록
 */
export type Series = SeriesMetadata & {
  /**
   * ID
   */
  id: number;
  /**
   * 공개 주소 식별자
   */
  slug: string;
  /**
   * 시리즈 종류
   */
  kind: 'TECH' | 'PROJECT';
  /**
   * 수정 시각
   */
  updatedAt: string
};

/**
 * 시리즈 생성·편집 폼과 부분 저장 실패 후 재시도 흐름 공유
 *
 * 1. 기존 항목 또는 마지막 저장 성공 결과 유지
 * 2. 유효성 검사 후 중복 제출 차단
 * 3. 신규 생성 또는 수정 시각 비교를 포함한 메타데이터 저장
 * 4. 순서는 별도 저장, 실패하면 생성된 항목을 유지해 재시도
 * 5. 완료 콜백 실행, 성공·실패 모두 버튼 복구
 */
export function seriesEditor(options: {
  /**
   * 프로젝트 시리즈 FK 매핑
   */
  project: boolean;
  /**
   * 기술 목록
   */
  badges: Badge[];
  /**
   * 수정할 시리즈, 생략하면 새로 생성
   */
  item?: Series;
  /**
   * 저장 시작 알림 콜백
   */
  onSaving?: () => void;
  /**
   * 저장 결과 반영 콜백
   */
  onSaved: (item: Series) => Promise<void> | void;
  /**
   * 작업 실패 안내 콜백
   */
  onError: (error: unknown) => void;
}) {
  // 기존 항목 또는 마지막 저장 성공 결과 유지
  let saved = options.item;
  const form = el('form', 'field-grid series-editor');
  seriesFormFields(form, options.badges, options.project, saved);
  submit(form, saved ? '저장' : options.project ? '프로젝트 만들기' : '시리즈 만들기');
  // 유효성 검사 후 중복 제출 차단
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (!form.reportValidity()) return;
    const button = form.querySelector<HTMLButtonElement>('button[type=submit]')!; button.disabled = true;
    options.onSaving?.();
    try {
      const input = new FormData(form);
      const metadata = seriesMetadata(input, options.project);
      // 신규 생성 또는 수정 시각 비교를 포함한 메타데이터 저장
      saved = saved
        ? await mutate<Series>(`/admin/series/${saved.id}/metadata`, 'PUT', { ...metadata, baseUpdatedAt: saved.updatedAt })
        : await mutate<Series>('/admin/series', 'POST', { kind: options.project ? 'PROJECT' : 'TECH', metadata });
      const order = Number(value(input, 'order'));
      // 순서는 별도 저장, 실패하면 생성된 항목을 유지해 재시도
      if (order !== saved.sortOrder) {
        try { saved = await mutate<Series>(`/admin/series/${saved.id}/order`, 'PUT', { order }); }
        catch (error) { throw new Error(`기본 정보는 저장됐지만 카드 순서를 저장하지 못했습니다. 다시 저장하면 이어서 처리합니다. ${error instanceof Error ? error.message : ''}`); }
      }
      // 완료 콜백 실행, 성공·실패 모두 버튼 복구
      await options.onSaved(saved);
    } catch (error) { options.onError(error); }
    finally { button.disabled = false; }
  });
  return form;
}
