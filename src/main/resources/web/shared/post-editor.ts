import { HttpError, mutate } from './admin-api';
import { el, submit } from './forms';
import { postFields, postPayload, type PostOptions } from './post-fields';

/**
 * 본문과 선언 관계를 제외한 글 편집 정보
 */
export type EditablePost = {
  /**
   * 글 ID
   */
  id: number;

  /**
   * 글 섹션
   */
  section: 'TECH' | 'PROJECT';

  /**
   * 제목
   */
  title: string;

  /**
   * 요약
   */
  summary: string;

  /**
   * 선택 분류
   */
  category: {
    /**
     * 분류 ID
     */
    id: number
  } | null;

  /**
   * 태그 목록
   */
  tags: string[];

  /**
   * 소속 시리즈 또는 프로젝트
   */
  series: {
    /**
     * 시리즈 ID
     */
    id: number
  } | null;

  /**
   * 소속 내 순서
   */
  seriesOrder: number | null;

  /**
   * 관련 프로젝트 ID
   */
  relatedSeriesId: number | null;
};

/**
 * 상세 페이지와 관리자에서 공유하는 글 편집 폼
 *
 * 1. 작성 폼과 같은 입력에 기존 값 반영
 * 2. 기본 정보를 먼저 저장한 뒤 변경된 소속·순서 저장
 * 3. 부분 실패 시 입력 유지와 오류 전달, 성공 시 호출 화면 갱신
 */
export function postEditor(post: EditablePost, data: PostOptions, callbacks: {
  /**
   * 저장 시작 안내
   */
  onSaving: () => void;

  /**
   * 저장 완료 처리
   */
  onSaved: () => Promise<void> | void;

  /**
   * 인증·부분 실패 안내
   */
  onError: (error: unknown) => void;
}) {
  // 기존 값을 공통 폼에 반영
  const initial = {
    title: post.title, summary: post.summary, categoryId: post.category?.id ?? null, tags: post.tags,
    seriesId: post.series?.id ?? null, order: post.seriesOrder, relatedSeriesId: post.relatedSeriesId,
  };
  const form = el('form', 'field-grid');
  postFields(form, data, post.section === 'PROJECT', initial);
  submit(form, '글 정보 저장');
  // 유효한 입력만 저장하고 중복 제출 차단
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const button = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
    button.disabled = true; callbacks.onSaving();
    try {
      const { seriesId, order, relatedSeriesId, ...metadata } = postPayload(new FormData(form));
      // 분류 변경을 소속·순서 검증에 반영하기 위해 기본 정보 먼저 저장
      await mutate(`/admin/posts/${post.id}/metadata`, 'PATCH', metadata);
      if (seriesId !== initial.seriesId || order !== initial.order || relatedSeriesId !== initial.relatedSeriesId) {
        try {
          await mutate(`/admin/posts/${post.id}/series`, 'PUT', { seriesId, order, relatedSeriesId });
        } catch (error) {
          // 두 요청은 별도 저장이므로 이미 저장한 정보와 실패 범위를 구분
          const detail = error instanceof Error ? error.message : '요청에 실패했습니다.';
          const message = `기본 정보는 저장했지만 소속·문서 순서를 저장하지 못했습니다. ${detail} 다시 저장해 주세요.`;
          if (error instanceof HttpError) throw new HttpError(error.status, message);
          throw new Error(message);
        }
      }
      await callbacks.onSaved();
    } catch (error) { callbacks.onError(error); }
    finally { button.disabled = false; }
  });
  return form;
}
