import { mutate } from './admin-api';
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
   * Git 원고 주소
   */
  slug: string;

  /**
   * 서버에서 읽은 편집 기준 버전
   */
  editVersion: number;

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
 * 2. 편집 기준 버전과 모든 필드를 한 요청으로 저장
 * 3. 충돌·오류 시 입력 유지, 성공 시 기준 버전과 호출 화면 갱신
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
  form.append(el('p', 'form-help', `원고: content/posts/${post.slug}.md`));
  let baseVersion = post.editVersion;
  postFields(form, data, post.section === 'PROJECT', initial);
  submit(form, '글 정보 저장');
  // 유효한 입력만 저장하고 중복 제출 차단
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const button = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
    button.disabled = true; callbacks.onSaving();
    try {
      const saved = await mutate<EditablePost>(`/admin/posts/${post.id}/metadata`, 'PATCH', {
        ...postPayload(new FormData(form)), baseVersion,
      });
      baseVersion = saved.editVersion;
      await callbacks.onSaved();
    } catch (error) { callbacks.onError(error); }
    finally { button.disabled = false; }
  });
  return form;
}
