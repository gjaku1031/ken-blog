import { postPath, sitePath, wikiKey } from '../shared/site-path';
import { apiUrl, HttpError, mutate, request } from '../shared/admin-api';
import { el } from '../shared/dom';
import { statusLabel, type PostStatus } from '../shared/deployment-status';
import { enhanceMarkdown } from '../shared/enhance';
import { connectTableOfContents } from './toc';

/**
 * 검수 화면에 쓰는 관리자 글 정보
 */
type ReviewPost = {
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
   * 탐색 구획
   */
  section: 'TECH' | 'PROJECT';

  /**
   * 공개 범위와 검수 단계
   */
  status: PostStatus;

  /**
   * 검수 완료 시각
   */
  reviewedAt: string | null;

  /**
   * DB 본문 수정 시각, 본문이 저장소 원고에만 있으면 null
   */
  bodyUpdatedAt: string | null;

  /**
   * 소속 시리즈·프로젝트
   */
  series: {
    /**
     * 시리즈 ID
     */
    id: number;

    /**
     * 시리즈 이름
     */
    name: string
  } | null;

  /**
   * 시리즈 내 정렬 순서
   */
  seriesOrder: number | null
};

/**
 * 관리자 본문 응답
 */
type Body = {
  /**
   * Markdown 본문
   */
  body: string;

  /**
   * 본문 수정 시각, 검수 완료 요청에 그대로 되돌려 보내는 값
   */
  updatedAt: string
};

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
 * 공개하지 않은 글의 검수 화면 주소
 */
export const reviewPath = (id: number): string => sitePath(`manage/review/?post=${id}`);

/**
 * 공개 글은 공개 상세, 그 밖의 글은 검수 화면으로 가는 주소
 */
const hrefOf = (post: {
  /**
   * ID
   */
  id: number;

  /**
   * 공개 주소 식별자
   */
  slug: string;

  /**
   * 공개 범위와 검수 단계
   */
  status: PostStatus
}): string => post.status === 'PUBLISHED' ? postPath(post) : reviewPath(post.id);

/**
 * 시각 문자열의 날짜 부분을 화면 표기로 변환
 */
const day = (value: string): string => value.slice(0, 10).replaceAll('-', '.');

/**
 * 프로젝트·시리즈별 문서 순서, 소속이 없는 글은 뒤에서 ID 순서
 */
function readingOrder(a: ReviewPost, b: ReviewPost): number {
  return (a.series ? 0 : 1) - (b.series ? 0 : 1)
    || (a.series?.id ?? 0) - (b.series?.id ?? 0)
    || (a.seriesOrder ?? Number.MAX_SAFE_INTEGER) - (b.seriesOrder ?? Number.MAX_SAFE_INTEGER)
    || a.id - b.id;
}

/**
 * 구획과 소속을 한 줄로 표시
 */
function context(post: ReviewPost): string {
  return [post.section === 'PROJECT' ? 'Projects' : 'Posts', post.series?.name].filter(Boolean).join(' · ');
}

/**
 * 관리자 확인 뒤 공개하지 않은 글의 목록 또는 본문을 그림
 *
 * 1. 전체 글 정보를 한 번 읽어 목록·이전/다음·링크 해석에 함께 사용
 * 2. 주소에 글 ID가 없으면 미검수·검수 완료·비공개 목록 표시
 * 3. 글 ID가 있으면 DB 본문을 공개 글과 같은 렌더러로 그리고 검수 동작 연결
 * 4. 세션 만료는 로그인 안내로, 그 밖의 실패는 사유 표시로 처리
 */
export async function connectReview(): Promise<void> {
  const message = document.getElementById('review-message');
  const login = document.getElementById('review-login');
  const content = document.getElementById('review-content');
  const actions = document.getElementById('review-actions');
  if (!message || !login || !content || !actions) return;

  /**
   * 진행·실패 안내 표시, 빈 문구면 숨김
   */
  const say = (text: string, error = false) => {
    message.textContent = text; message.hidden = !text; message.classList.toggle('error', error);
  };

  /**
   * 세션 만료는 로그인 안내, 그 밖의 실패는 서버가 준 사유 표시
   */
  const fail = (error: unknown) => {
    if (error instanceof HttpError && error.status === 401) {
      content.replaceChildren(); actions.replaceChildren(); say(''); login.hidden = false; return;
    }
    say(error instanceof Error ? error.message : '글을 불러오지 못했습니다.', true);
  };
  say('글 정보를 불러오는 중입니다.');
  try {
    const posts = await request<ReviewPost[]>('/admin/posts/snapshot');
    const id = new URLSearchParams(location.search).get('post');
    if (id && /^[1-9][0-9]*$/.test(id)) await showPost(Number(id), posts, { say, fail, content, actions });
    else { showList(posts, content); say(''); }
  } catch (error) { fail(error); }
}

/**
 * 공개하지 않은 글을 단계별로 묶은 목록 표시
 */
function showList(posts: ReviewPost[], content: HTMLElement): void {
  document.title = '검수 | ken.blog';
  const hidden = posts.filter(post => post.status !== 'PUBLISHED').sort(readingOrder);
  const groups: Array<[string, ReviewPost[]]> = [
    ['미검수', hidden.filter(post => post.status === 'UNREVIEWED' && !post.reviewedAt)],
    ['검수 완료 · 공개 대기', hidden.filter(post => post.status === 'UNREVIEWED' && post.reviewedAt)],
    ['비공개', hidden.filter(post => post.status === 'PRIVATE')],
  ];
  const heading = el('h1', 'review-heading', '검수·비공개 글');
  content.replaceChildren(heading);
  for (const [title, rows] of groups) {
    const section = el('section', 'review-group');
    const label = el('h2', '', title); label.append(el('span', 'mono', String(rows.length)));
    section.append(label);
    if (!rows.length) section.append(el('p', 'review-empty', '해당하는 글이 없습니다.'));
    else {
      const list = el('ol', 'review-list');
      for (const post of rows) {
        const item = el('li', 'review-item card');
        // DB 본문이 없는 글은 저장소 원고를 읽어야 하므로 링크 없이 사유 표시
        if (post.bodyUpdatedAt) { const link = el('a', '', post.title); link.href = reviewPath(post.id); item.append(link); }
        else item.append(el('strong', '', post.title));
        item.append(el('small', '', [context(post), post.bodyUpdatedAt ? `본문 수정 ${day(post.bodyUpdatedAt)}` : 'DB 본문 없음'].join(' · ')));
        list.append(item);
      }
      section.append(list);
    }
    content.append(section);
  }
}

/**
 * 한 글의 DB 본문을 그리고 검수·상태 전환·이전/다음 이동 연결
 *
 * 1. 공개 글·없는 글·DB 본문이 없는 글은 사유만 표시
 * 2. 본문·연결 글·렌더러를 함께 받아 공개 글과 같은 구조로 조립
 * 3. 이미지·위키·글 링크는 관리자 주소로 해석하고, 모르는 글 링크는 글자로 낮춤
 * 4. 같은 단계의 글 사이를 문서 순서로 이동, 검수 완료 뒤에는 다음 미검수 글로 이동
 */
async function showPost(id: number, posts: ReviewPost[], view: {
  /**
   * 진행·실패 안내 표시
   */
  say: (text: string, error?: boolean) => void;

  /**
   * 요청 실패 처리
   */
  fail: (error: unknown) => void;

  /**
   * 본문 영역
   */
  content: HTMLElement;

  /**
   * 도구 모음의 동작 영역
   */
  actions: HTMLElement
}): Promise<void> {
  const { say, fail, content, actions } = view;
  const back = document.getElementById('review-back') as HTMLAnchorElement | null;
  if (back) { back.href = sitePath('manage/review/'); back.textContent = '← 검수 목록'; }
  const post = posts.find(item => item.id === id);
  if (!post) { say('글을 찾을 수 없습니다.', true); return; }
  document.title = `${post.title} · ${statusLabel(post)} | ken.blog`;
  if (post.status === 'PUBLISHED') {
    const link = el('a', '', '공개 화면에서 보기'); link.href = postPath(post);
    content.replaceChildren(el('h1', '', post.title), link); say('이미 공개된 글입니다.'); return;
  }
  if (!post.bodyUpdatedAt) { content.replaceChildren(el('h1', '', post.title)); say('DB에 본문이 없습니다. 원고가 저장소에만 있는 글입니다.'); return; }
  const [{ renderMarkdown }, body, links] = await Promise.all([
    import('../shared/markdown'), request<Body>(`/admin/posts/${id}/body`), request<Link[]>(`/admin/posts/${id}/links`),
  ]);
  // 같은 제목이 여럿이면 공개 글, 그다음 낮은 ID를 위키 링크의 대표로 선택
  const byTitle = new Map<string, ReviewPost>();
  for (const item of [...posts].sort((a, b) => Number(b.status === 'PUBLISHED') - Number(a.status === 'PUBLISHED') || a.id - b.id))
    if (!byTitle.has(wikiKey(item.title))) byTitle.set(wikiKey(item.title), item);
  const bySlug = new Map(posts.map(item => [item.slug, item]));
  const rendered = await renderMarkdown(body.body, {
    attachmentUrl: attachment => apiUrl(`/admin/posts/${id}/attachments/${attachment}/content`),
    wikiUrl: title => { const target = byTitle.get(wikiKey(title)); return target ? hrefOf(target) : null; },
    postLink: (slug, hash) => { const target = bySlug.get(slug); return target ? hrefOf(target) + hash : null; },
  });
  // 공개 글 상세와 같은 클래스 구조로 조립하여 같은 본문 스타일 적용
  const article = el('article');
  article.append(el('div', 'post-overline', `${statusLabel(post)} · ${context(post)}`), el('h1', '', post.title));
  article.append(el('div', 'detail-meta', [`본문 수정 ${day(body.updatedAt)}`, post.reviewedAt ? `검수 완료 ${day(post.reviewedAt)}` : ''].filter(Boolean).join(' · ')));
  const toc = rendered.headings.filter(heading => heading.depth === 2 || heading.depth === 3);
  const layout = el('div', `post-reading-layout${toc.length || links.length ? ' has-toc' : ''}`);
  const main = el('div', 'post-main-content');
  const markdown = el('div', 'markdown-body');
  // 렌더러가 허용 목록으로 정화한 HTML만 삽입
  markdown.innerHTML = rendered.html;
  main.append(markdown);
  // 같은 단계의 글 사이를 문서 순서로 이동
  const stage = (item: ReviewPost) => item.status === 'PRIVATE' ? 'private' : item.reviewedAt ? 'reviewed' : 'unreviewed';
  const queue = posts.filter(item => item.status !== 'PUBLISHED' && item.bodyUpdatedAt && stage(item) === stage(post)).sort(readingOrder);
  const index = queue.findIndex(item => item.id === id);
  const previous = queue[index - 1], next = queue[index + 1];
  if (previous || next) {
    const nav = el('nav', 'series-previous-next'); nav.setAttribute('aria-label', '이전·다음 글');
    if (previous) { const link = el('a', 'series-previous'); link.rel = 'prev'; link.href = reviewPath(previous.id); link.append(el('span', '', '← 이전 글'), el('strong', '', previous.title)); nav.append(link); }
    else { const start = el('div', 'series-start'); start.setAttribute('aria-hidden', 'true'); nav.append(start); }
    if (next) { const link = el('a', 'series-next'); link.rel = 'next'; link.href = reviewPath(next.id); link.append(el('span', '', '다음 글 →'), el('strong', '', next.title)); nav.append(link); }
    else nav.append(el('p', 'series-end', '이 단계의 마지막 글입니다'));
    main.append(nav);
  }
  layout.append(main);
  if (toc.length || links.length) {
    const rail = el('aside', 'post-side-rail can-stick');
    if (toc.length) {
      const nav = el('nav', 'post-toc'); nav.setAttribute('aria-label', '목차'); nav.append(el('h2', '', '목차'));
      const list = el('ol');
      for (const heading of toc) {
        const item = el('li', heading.depth === 3 ? 'toc-depth-three' : '');
        const link = el('a', '', heading.label); link.href = `#${encodeURIComponent(heading.id)}`; item.append(link); list.append(item);
      }
      nav.append(list); rail.append(nav);
    }
    if (links.length) {
      const nav = el('nav', 'series-nav related-posts-nav'); nav.setAttribute('aria-label', '연결된 글 목록'); nav.append(el('h2', '', '연결된 글'));
      const list = el('ol');
      for (const target of links) {
        const item = el('li'); const link = el('a'); link.href = hrefOf(target);
        link.append(el('span', '', `${target.title} · ${statusLabel(target)}`)); item.append(link); list.append(item);
      }
      nav.append(list); rail.append(nav);
    }
    layout.append(rail);
  }
  article.append(layout);
  content.replaceChildren(article);
  say('');

  /**
   * 현재 테마로 본문 상호작용과 도식 갱신
   */
  const enhance = () => { void enhanceMarkdown(markdown, { theme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light' }); };
  enhance(); connectTableOfContents();
  document.addEventListener('site-theme', enhance);

  /**
   * 도구 모음 동작 추가, 실패 사유는 안내 줄에 표시하고 성공하면 지정 주소로 이동
   */
  const action = (title: string, run: () => Promise<unknown>, done: () => string) => {
    const button = el('button', 'write-button', title); button.type = 'button';
    button.addEventListener('click', async () => {
      button.disabled = true;
      try { await run(); location.assign(done()); }
      catch (error) { button.disabled = false; fail(error); }
    });
    actions.append(button);
  };
  actions.replaceChildren();
  if (post.status === 'UNREVIEWED') {
    // 검수 완료는 화면이 읽은 본문 시각을 함께 보내 그사이 바뀐 본문의 검수를 막음
    if (post.reviewedAt) action('검수 취소', () => mutate(`/admin/posts/${id}/review`, 'PUT', { reviewed: false }), () => reviewPath(id));
    else action('검수 완료', () => mutate(`/admin/posts/${id}/review`, 'PUT', { reviewed: true, bodyUpdatedAt: body.updatedAt }),
      () => next ? reviewPath(next.id) : sitePath('manage/review/'));
    action('비공개로', () => mutate(`/admin/posts/${id}/publication`, 'PUT', { status: 'PRIVATE' }), () => reviewPath(id));
  } else action('미검수로', () => mutate(`/admin/posts/${id}/publication`, 'PUT', { status: 'UNREVIEWED' }), () => reviewPath(id));
  const edit = el('button', 'write-button', '글 정보 수정'); edit.type = 'button'; edit.dataset.postEdit = String(id);
  actions.append(edit);
}
