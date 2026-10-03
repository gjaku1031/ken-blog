import '../shared/forms.css';
import { HttpError, request } from '../shared/admin-api';
import { el, setMessage, type Badge } from '../shared/forms';
import { updateHeaderSession } from '../shared/header';
import { postEditor, type EditablePost } from '../shared/post-editor';
import type { Category, Tag } from '../shared/post-fields';
import { seriesEditor, type Series } from '../shared/series-editor';

/**
 * 상세 페이지를 유지하며 글·프로젝트 메타데이터 모달 연결
 *
 * 1. 대화상자·저장 안내 준비
 * 2. 클릭 대상의 최신 메타데이터 조회, 닫힌 모달 응답 폐기
 * 3. 관리자와 같은 편집 폼 연결, 저장 후 배포 대기 안내
 */
export function connectPostEditor() {
  // 주소와 스크롤 위치를 바꾸지 않는 상세 페이지 전용 대화상자
  const dialog = el('dialog', 'edit-dialog'); dialog.id = 'detail-edit-dialog';
  const heading = el('div', 'dialog-heading'); const title = el('h2'); title.id = 'detail-edit-title';
  const close = el('button', 'dialog-close', '×'); close.type = 'button'; close.setAttribute('aria-label', '닫기');
  const message = el('p', 'notice'); message.hidden = true; message.setAttribute('role', 'status');
  const content = el('div'); heading.append(title, close); dialog.append(heading, message, content);
  dialog.setAttribute('aria-labelledby', title.id); document.body.append(dialog);
  const notice = el('p', 'notice post-edit-notice'); notice.hidden = true; notice.setAttribute('role', 'status');
  document.querySelector('.post-toolbar')?.after(notice);
  let generation = 0;
  close.addEventListener('click', () => dialog.close());

  // 수정 버튼에서 최신 정보를 읽어 같은 화면에 모달 표시
  document.addEventListener('click', async event => {
    const trigger = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-post-edit],[data-project-edit]') : null;
    if (!trigger) return;
    const project = !!trigger.dataset.projectEdit;
    const id = trigger.dataset.projectEdit || trigger.dataset.postEdit;
    if (!id || !/^[1-9][0-9]*$/.test(id)) return;
    const run = ++generation;
    title.textContent = project ? '프로젝트 수정' : '글 수정';
    dialog.classList.toggle('project-edit-dialog', project);
    content.replaceChildren(); setMessage(message, '수정할 정보를 불러오는 중입니다.'); dialog.showModal();

    /**
     * 닫히거나 다른 편집으로 교체되지 않은 요청 여부
     */
    const active = () => dialog.open && run === generation;

    /**
     * 현재 모달의 저장 실패·세션 만료 안내
     */
    const onError = (error: unknown) => {
      if (!active()) return;
      if (error instanceof HttpError && error.status === 401) {
        updateHeaderSession(false); content.replaceChildren();
        const login = el('a', 'button', '관리자 로그인'); login.href = '/ken-blog/manage/'; content.append(login);
      }
      setMessage(message, error instanceof Error ? error.message : '정보를 불러오지 못했습니다.', true);
    };

    /**
     * 저장한 최신 데이터는 재진입 시 조회하고 현재 정적 화면에는 대기 안내
     */
    const onSaved = () => {
      if (!active()) return;
      dialog.close();
      setMessage(notice, '저장했습니다. 현재 공개 화면은 배포 전 내용이며, GitHub Pages 배포 후 수정 내용이 반영됩니다.');
    };
    try {
      if (project) {
        const [{ series }, badges] = await Promise.all([
          request<{
            /**
             * 최신 프로젝트 정보
             */
            series: Series
          }>(`/admin/series/${id}`), request<Badge[]>('/admin/stack-badges'),
        ]);
        if (!active()) return;
        setMessage(message, '');
        content.replaceChildren(seriesEditor({ project: true, badges, item: series,
          onSaving: () => setMessage(message, ''), onSaved, onError }));
      } else {
        const [post, categories, tags, series] = await Promise.all([
          request<EditablePost>(`/admin/posts/${id}`), request<Category[]>('/admin/categories'),
          request<Tag[]>('/admin/tags'), request<Series[]>('/admin/series'),
        ]);
        if (!active()) return;
        title.textContent = post.section === 'PROJECT' ? 'Projects 글 수정' : 'Posts 글 수정';
        setMessage(message, '');
        content.replaceChildren(postEditor(post, { categories, tags, series }, {
          onSaving: () => setMessage(message, ''), onSaved, onError,
        }));
      }
      content.querySelector('input')?.focus({ preventScroll: true });
    } catch (error) { onError(error); }
  });
}
