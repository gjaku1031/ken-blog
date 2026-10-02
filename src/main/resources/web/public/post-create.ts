import '../shared/forms.css';
import { request, mutate, HttpError } from '../shared/admin-api';
import { el, setMessage, submit } from '../shared/forms';
import { postCreateFields, postPayload, type Category, type Tag } from '../shared/post-fields';
import type { Series } from '../shared/series-editor';
import { updateHeaderSession } from '../shared/header';

export function connectPostCreator() {
  const dialog = el('dialog', 'edit-dialog post-create-dialog'); dialog.id = 'post-dialog';
  const heading = el('div', 'dialog-heading'); const title = el('h2'); title.id = 'post-dialog-title';
  dialog.setAttribute('aria-labelledby', title.id);
  const close = el('button', 'dialog-close', '×'); close.type = 'button'; close.setAttribute('aria-label', '닫기');
  heading.append(title, close);
  const message = el('p', 'notice'); message.hidden = true;
  const content = el('div'); dialog.append(heading, message, content); document.body.append(dialog);
  close.addEventListener('click', () => dialog.close());
  let generation = 0; dialog.addEventListener('close', () => { generation++; });
  document.addEventListener('click', async event => {
    const trigger = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-post-create]') : null;
    if (!trigger || (event instanceof MouseEvent && (event.button || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey))) return;
    event.preventDefault();
    document.querySelector<HTMLDialogElement>('#project-dialog')?.close();
    const run = ++generation;
    const project = trigger.dataset.postCreate === 'PROJECT';
    title.textContent = project ? 'Projects 글쓰기' : 'Posts 글쓰기';
    content.replaceChildren(); setMessage(message, '글 정보를 불러오는 중입니다.'); dialog.showModal();
    try {
      const [categories, tags, series] = await Promise.all([
        request<Category[]>('/admin/categories'), request<Tag[]>('/admin/tags'), request<Series[]>('/admin/series'),
      ]);
      if (run !== generation || !dialog.open) return;
      setMessage(message, '');
      const form = el('form', 'field-grid');
      postCreateFields(form, { categories, tags, series }, project, trigger.dataset.project ?? '');
      submit(form, '글 정보 저장');
      form.addEventListener('submit', async event => {
        event.preventDefault(); if (!form.reportValidity()) return;
        const button = form.querySelector<HTMLButtonElement>('button[type=submit]')!; button.disabled = true;
        try {
          const post = await mutate<{ title: string }>('/admin/posts', 'POST', postPayload(new FormData(form)));
          if (!dialog.open || run !== generation) return;
          const done = el('div', 'creation-complete');
          done.append(el('h3', '', '미발행 글로 저장했습니다.'), el('p', '', post.title));
          const manage = el('a', 'button', '글 관리'); manage.href = '/ken-blog/manage/#posts';
          const finish = el('button', 'button primary', '완료'); finish.type = 'button'; finish.addEventListener('click', () => dialog.close());
          done.append(manage, finish); content.replaceChildren(done); finish.focus();
        } catch (error) { showError(error); }
        finally { button.disabled = false; }
      });
      content.replaceChildren(form); form.querySelector('input')?.focus();
    } catch (error) { if (run === generation && dialog.open) showError(error); }
  });
  function showError(error: unknown) {
    if (error instanceof HttpError && error.status === 401) {
      updateHeaderSession(false); content.replaceChildren();
      const login = el('a', 'button', '관리자 로그인'); login.href = '/ken-blog/manage/'; content.append(login);
    }
    setMessage(message, error instanceof Error ? error.message : '글 정보를 저장하지 못했습니다.', true);
  }
}
