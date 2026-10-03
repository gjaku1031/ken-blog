/**
 * 현재 읽는 제목을 목차에 표시함
 * 동적으로 커지는 수식·이미지·도식도 반영함
 *
 * 1. 실제 본문 제목으로 연결되는 목차만 수집
 * 2. 헤더 높이·제목 위치·문서 끝을 반영해 현재 절 계산
 * 3. 스크롤·크기·이미지·글꼴 변경을 프레임당 한 번 반영
 */
export function connectTableOfContents(): void {
  const toc = document.querySelector<HTMLElement>('.post-toc');
  const article = document.querySelector<HTMLElement>('.markdown-body');
  if (!toc || !article) return;
  // 실제 본문 제목으로 연결되는 목차만 수집
  const entries = Array.from(toc.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')).flatMap(link => {
    let id: string;
    try { id = decodeURIComponent(link.hash.slice(1)); } catch { return []; }
    const heading = document.getElementById(id);
    return heading && article.contains(heading) ? [{ link, heading }] : [];
  });
  if (!entries.length) return;
  const header = document.querySelector<HTMLElement>('.site-header');
  const rail = toc.closest<HTMLElement>('.post-side-rail');
  let scheduled = false;
  let active: HTMLAnchorElement | null = null;
  // 레이아웃이 바뀔 때만 제목 위치를 읽고 스크롤 중에는 캐시를 이분 탐색
  let dirty = true;
  let threshold = 0;
  let positions: { entry: typeof entries[number]; top: number }[] = [];

  /**
   * 최신 레이아웃과 스크롤 위치로 현재 목차 항목 갱신
   */
  const update = () => {
    scheduled = false;
    if (dirty) {
      positions = entries.filter(entry => entry.heading.getClientRects().length)
        .map(entry => ({ entry, top: entry.heading.getBoundingClientRect().top + window.scrollY }));
      threshold = Math.max((header?.getBoundingClientRect().height ?? 0) + 24,
        parseFloat(getComputedStyle(article).scrollMarginTop) || 90) + 2;
      dirty = false;
    }
    if (!positions.length) return;
    let left = 0, right = positions.length;
    while (left < right) {
      const middle = (left + right) >>> 1;
      if (positions[middle].top <= window.scrollY + threshold) left = middle + 1;
      else right = middle;
    }
    let current = positions[Math.max(0, left - 1)].entry;
    // 마지막 절이 짧아 화면 위까지 올라오지 못하는 문서도 끝에 도달하면 표시함
    if (window.scrollY > 0 && window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 4)
      current = positions[positions.length - 1].entry;
    if (active === current.link) return;
    active?.removeAttribute('aria-current');
    active = current.link;
    active.setAttribute('aria-current', 'location');
    if (rail && getComputedStyle(rail).position === 'sticky' && rail.scrollHeight > rail.clientHeight) {
      const bounds = rail.getBoundingClientRect(), linkBounds = active.getBoundingClientRect();
      if (linkBounds.top < bounds.top) rail.scrollTop += linkBounds.top - bounds.top - 8;
      else if (linkBounds.bottom > bounds.bottom) rail.scrollTop += linkBounds.bottom - bounds.bottom + 8;
    }
  };

  /**
   * 프레임당 한 번만 목차 갱신 예약
   */
  const schedule = () => {
    if (!scheduled) { scheduled = true; requestAnimationFrame(update); }
  };
  /**
   * 크기·이미지·접기·글꼴 변경 시 위치 캐시 무효화
   */
  const invalidate = () => { dirty = true; schedule(); };
  // 스크롤은 좌표 계산 없이 예약, 레이아웃 사건만 캐시 갱신
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', invalidate);
  window.addEventListener('hashchange', schedule);
  window.addEventListener('pageshow', invalidate);
  article.addEventListener('load', invalidate, true);
  article.addEventListener('toggle', invalidate, true);
  const observer = new ResizeObserver(invalidate);
  observer.observe(article); if (header) observer.observe(header);
  void document.fonts.ready.then(invalidate);
  schedule();
}
