import { categoryCount } from './category-count';
import { el } from './forms';
import type { Category } from './post-fields';

/**
 * 한 문서 안의 분류 선택 트리 식별자 순번
 */
let pickerSequence = 0;

/**
 * 기존 분류 트리를 사용하는 단일 분류 선택 입력
 *
 * 1. 분류 없음과 현재 선택값을 제출할 숨김 입력 준비
 * 2. 깊이 안내선·접기 버튼·글 수를 포함한 스크롤 목록 구성
 * 3. 선택 표시와 분류 ID 동기화, 접기는 선택값 유지
 */
export function categoryTreePicker(parent: HTMLElement, categories: Category[], selected: number | null = null) {
  // 공개 사이드바·다른 편집 폼과 겹치지 않는 트리 ID 준비
  const prefix = `post-category-${++pickerSequence}`;
  const group = el('fieldset', 'post-category-picker');
  group.append(el('legend', '', '분류'));
  const hidden = el('input'); hidden.type = 'hidden'; hidden.name = 'categoryId';
  // 선택 결과는 스크린 리더로만 안내, 화면에서는 선택한 분류 버튼으로 표시
  const selection = el('p', 'sr-only'); selection.setAttribute('aria-live', 'polite');
  const buttons = new Map<string, HTMLButtonElement>();

  /**
   * 선택 분류와 제출값 갱신, 빈 ID는 분류 연결 해제
   */
  function select(id: string, path: string) {
    hidden.value = id;
    for (const [key, button] of buttons) button.setAttribute('aria-pressed', String(key === id));
    selection.textContent = id ? `선택: ${path}` : '분류 없음';
  }

  /**
   * 키보드와 클릭으로 선택할 분류 버튼 생성
   */
  function option(id: string, name: string, path: string) {
    const button = el('button', 'category-name'); button.type = 'button';
    button.dataset.categoryId = id; button.title = path; button.setAttribute('aria-pressed', 'false');
    if (id) button.innerHTML = '<svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true"><path d="M3 5h5l2 2h7v9H3Z" fill="none" stroke="currentColor" stroke-linejoin="round"/></svg>';
    button.append(el('span', 'category-label', name));
    button.addEventListener('click', () => select(id, path)); buttons.set(id, button);
    return button;
  }

  /**
   * 분류 깊이에 따른 중첩 목록 구성, 초기에는 현재 선택도 보이도록 모두 펼침
   */
  function tree(items: Category[]) {
    const list = el('ul', 'category-tree');
    for (const category of items) {
      const item = el('li'); const line = el('div', 'category-line');
      const button = option(String(category.id), category.name, category.path);
      const total = el('span', 'category-total mono', String(categoryCount(category)));
      total.setAttribute('aria-label', `글 ${categoryCount(category)}개`); button.append(total);
      // 하위 목록 접기와 분류 선택을 별도 버튼으로 분리
      if (category.children.length) {
        const children = tree(category.children); children.id = `${prefix}-${category.id}`;
        const toggle = el('button', 'category-expand', '›'); toggle.type = 'button';
        toggle.setAttribute('aria-label', `${category.name} 하위 분류`);
        toggle.setAttribute('aria-controls', children.id); toggle.setAttribute('aria-expanded', 'true');
        toggle.addEventListener('click', () => {
          children.hidden = !children.hidden; toggle.setAttribute('aria-expanded', String(!children.hidden));
        });
        line.append(toggle, button); item.append(line, children);
      } else {
        line.append(el('span', 'category-expand-spacer'), button); item.append(line);
      }
      list.append(item);
    }
    return list;
  }
  // 분류가 없어도 연결 해제 가능, 초기 선택은 목록에 존재하는 ID만 반영
  const clear = option('', '분류 없음', '분류 없음'); clear.classList.add('category-clear');
  // 긴 목록만 스크롤하며 분류 해제 버튼은 목록 밖에 유지
  const viewport = el('div', 'category-tree-scroll scroll-region');
  viewport.tabIndex = 0; viewport.setAttribute('role', 'region'); viewport.setAttribute('aria-label', '분류 목록');
  const list = tree(categories);
  viewport.append(list); group.append(hidden, clear, viewport);
  if (!categories.length) viewport.append(el('p', 'stack-empty', '등록된 분류가 없습니다.'));
  group.append(selection); parent.append(group);
  const current = buttons.get(String(selected));
  select(current ? String(selected) : '', current?.title ?? '분류 없음');
  // 수정 창에서 아래쪽 분류도 즉시 보이도록 목록 내부만 이동
  if (current) requestAnimationFrame(() => {
    if (!viewport.isConnected) return;
    const offset = current.getBoundingClientRect().top - viewport.getBoundingClientRect().top;
    if (offset + current.offsetHeight > viewport.clientHeight) viewport.scrollTop += offset - viewport.clientHeight / 2 + current.offsetHeight / 2;
  });
}
