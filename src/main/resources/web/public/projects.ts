import '../shared/forms.css';
import { request, HttpError } from '../shared/admin-api';
import { el, setMessage, type Badge } from '../shared/forms';
import { seriesEditor } from '../shared/series-editor';
import { updateHeaderSession } from '../shared/header';


/** Projects 목록에서 기존 프로젝트 API와 공통 기술 스택 선택기를 사용한다. */
export function connectProjectCreator(): void {
  const trigger = document.getElementById('new-project') as HTMLButtonElement;
  const dialog = document.getElementById('project-dialog') as HTMLDialogElement;
  const content = document.getElementById('project-dialog-content')!;
  const message = document.getElementById('project-dialog-message')!;
  document.getElementById('project-dialog-close')?.addEventListener('click', () => dialog.close());
  trigger.addEventListener('click', async () => {
    content.replaceChildren(); setMessage(message, '기술 스택을 불러오는 중입니다.');
    dialog.showModal();
    try {
      const badges = await request<Badge[]>('/admin/stack-badges');
      if (!dialog.open) return;
      setMessage(message, '');
      const form = seriesEditor({ project: true, badges,
        onSaving: () => setMessage(message, ''),
        onSaved: project => {
          const done = el('div', 'project-created');
          done.append(el('p', '', `${project.name} 프로젝트를 만들었습니다.`));
          const write = el('a', 'button primary', '첫 글 작성');
          write.href = `/ken-blog/projects/new/?project=${project.id}`; write.dataset.postCreate = 'PROJECT'; write.dataset.project = String(project.id);
          done.append(write); content.replaceChildren(done); write.focus();
          // 정적 사이트를 다시 배포하기 전에도 방금 만든 프로젝트에서 이어서 작성한다.
          const card = el('article', 'project-card card project-draft');
          card.append(el('span', 'project-card-counts', '미발행 프로젝트'), el('h2', '', project.name));
          const link = el('a', 'write-button', '글쓰기'); link.href = write.href; link.dataset.postCreate = 'PROJECT'; link.dataset.project = String(project.id); card.append(link);
          card.dataset.adminWrite = ''; trigger.before(card);
        }, onError: showError,
      });
      content.replaceChildren(form); form.querySelector('input')?.focus();
    } catch (error) { showError(error); }
  });
  function showError(error: unknown) {
    if (error instanceof HttpError && error.status === 401) {
      updateHeaderSession(false); content.replaceChildren();
      const login = el('a', 'button', '관리자 로그인'); login.href = '/ken-blog/manage/'; content.append(login);
    }
    setMessage(message, error instanceof Error ? error.message : '프로젝트를 만들지 못했습니다.', true);
  }
}
