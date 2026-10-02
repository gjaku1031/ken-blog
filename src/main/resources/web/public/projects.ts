import '../shared/forms.css';
import { request, mutate, HttpError } from '../shared/admin-api';
import { el, setMessage, field, area, submit, projectFields, seriesMetadata, type Badge } from '../shared/forms';
import { updateHeaderSession } from '../shared/header';

type Project = { id: number; name: string };

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
      const form = el('form', 'field-grid');
      field(form, '이름', 'name', '', { required: true, max: 200, wide: true });
      area(form, '개요', 'description', '', 1000);
      projectFields(form, badges);
      submit(form, '프로젝트 만들기');
      form.addEventListener('submit', async event => {
        event.preventDefault(); if (!form.reportValidity()) return;
        const save = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
        save.disabled = true; setMessage(message, '');
        try {
          const project = await mutate<Project>('/admin/series', 'POST', { kind: 'PROJECT', metadata: seriesMetadata(new FormData(form), true) });
          const done = el('div', 'project-created');
          done.append(el('p', '', `${project.name} 프로젝트를 만들었습니다.`));
          const write = el('a', 'button primary', '첫 글 작성');
          write.href = `/ken-blog/projects/new/?project=${project.id}`;
          done.append(write); content.replaceChildren(done); write.focus();
          // 정적 사이트를 다시 배포하기 전에도 방금 만든 프로젝트에서 이어서 작성한다.
          const card = el('article', 'project-card card project-draft');
          card.append(el('span', 'project-card-counts', '미발행 프로젝트'), el('h2', '', project.name));
          const link = el('a', 'write-button', '글쓰기'); link.href = write.href; card.append(link);
          card.dataset.adminWrite = ''; trigger.before(card);
        } catch (error) { showError(error); }
        finally { save.disabled = false; }
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
