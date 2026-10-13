import { postPath, sitePath } from '../shared/site-path';
import { request } from '../shared/admin-api';
import { el } from '../shared/dom';
import { statusLabel, type PostStatus } from '../shared/deployment-status';

/**
 * 관리자에게만 보이는 연결 글
 */
type Link = {
  /**
   * ID
   */
  id: number;

  /**
   * 제목
   */
  title: string;

  /**
   * 공개 주소 식별자
   */
  slug: string;

  /**
   * 공개 범위와 검수 단계
   */
  status: PostStatus
};

/**
 * 공개 글 상세에 관리자에게만 보이는 연결 글 표시
 *
 * 정적 HTML에는 연결 정보가 없으며 관리자 확인 뒤 API로 받아 본문 위에 끼움
 * 연결이 없거나 조회에 실패하면 화면을 바꾸지 않음
 */
export async function connectPrivateLinks(): Promise<void> {
  const id = document.querySelector<HTMLElement>('[data-post-edit]')?.dataset.postEdit;
  const body = document.querySelector<HTMLElement>('.post-main-content .markdown-body');
  if (!id || !/^[1-9][0-9]*$/.test(id) || !body) return;
  let links: Link[];
  try { links = await request<Link[]>(`/admin/posts/${id}/links`); }
  catch { return; /* 부가 표시이므로 실패해도 본문 열람은 그대로 유지 */ }
  if (!links.length || document.querySelector('.private-links')) return;
  // 로그아웃 시 공통 헤더 처리로 함께 숨겨지도록 관리자 전용 표시 지정
  const nav = el('nav', 'private-links'); nav.setAttribute('aria-label', '나만 보이는 연결 글'); nav.dataset.adminWrite = '';
  nav.append(el('span', 'private-links-label', '나만 보기'));
  const list = el('ul');
  for (const link of links) {
    const item = el('li'); const anchor = el('a', '', link.title);
    anchor.href = link.status === 'PUBLISHED' ? postPath(link) : sitePath(`manage/review/?post=${link.id}`);
    item.append(anchor, el('small', '', statusLabel(link))); list.append(item);
  }
  nav.append(list); body.before(nav);
}
