import { mutate } from './admin-api';
import { el, seriesFormFields, seriesMetadata, submit, value, type Badge, type SeriesMetadata } from './forms';

export type Series = SeriesMetadata & { id: number; slug: string; kind: 'TECH' | 'PROJECT'; updatedAt: string };

/** Creation and editing share the layout, validation and retry-safe save flow. */
export function seriesEditor(options: {
  project: boolean; badges: Badge[]; item?: Series;
  onSaving?: () => void;
  onSaved: (item: Series) => Promise<void> | void;
  onError: (error: unknown) => void;
}) {
  let saved = options.item;
  const form = el('form', 'field-grid series-editor');
  seriesFormFields(form, options.badges, options.project, saved);
  submit(form, saved ? '저장' : options.project ? '프로젝트 만들기' : '시리즈 만들기');
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (!form.reportValidity()) return;
    const button = form.querySelector<HTMLButtonElement>('button[type=submit]')!; button.disabled = true;
    options.onSaving?.();
    try {
      const input = new FormData(form);
      const metadata = seriesMetadata(input, options.project);
      saved = saved
        ? await mutate<Series>(`/admin/series/${saved.id}/metadata`, 'PUT', { ...metadata, baseUpdatedAt: saved.updatedAt })
        : await mutate<Series>('/admin/series', 'POST', { kind: options.project ? 'PROJECT' : 'TECH', metadata });
      const order = Number(value(input, 'order'));
      if (order !== saved.sortOrder) {
        try { saved = await mutate<Series>(`/admin/series/${saved.id}/order`, 'PUT', { order }); }
        catch (error) { throw new Error(`기본 정보는 저장됐지만 카드 순서를 저장하지 못했습니다. 다시 저장하면 이어서 처리합니다. ${error instanceof Error ? error.message : ''}`); }
      }
      await options.onSaved(saved);
    } catch (error) { options.onError(error); }
    finally { button.disabled = false; }
  });
  return form;
}
