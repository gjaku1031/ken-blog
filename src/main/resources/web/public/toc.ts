/** 현재 읽는 제목을 목차에 표시한다. 동적으로 커지는 수식·이미지·도식도 반영한다. */
export function connectTableOfContents(): void {
  const toc = document.querySelector<HTMLElement>('.post-toc');
  const article = document.querySelector<HTMLElement>('.markdown-body');
  if (!toc || !article) return;
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
  const update = () => {
    scheduled = false;
    const visible = entries.filter(entry => entry.heading.getClientRects().length);
    if (!visible.length) return;
    const threshold = Math.max(
      (header?.getBoundingClientRect().bottom ?? 0) + 24,
      parseFloat(getComputedStyle(visible[0].heading).scrollMarginTop) || 0,
    ) + 2;
    let current = visible[0];
    for (const entry of visible) {
      if (entry.heading.getBoundingClientRect().top <= threshold) current = entry;
      else break;
    }
    // 마지막 절이 짧아 화면 위까지 올라오지 못하는 문서도 끝에 도달하면 표시한다.
    if (window.scrollY > 0 && window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 4)
      current = visible[visible.length - 1];
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
  const schedule = () => {
    if (!scheduled) { scheduled = true; requestAnimationFrame(update); }
  };
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule);
  window.addEventListener('hashchange', schedule);
  window.addEventListener('pageshow', schedule);
  article.addEventListener('load', schedule, true);
  article.addEventListener('toggle', schedule, true);
  new ResizeObserver(schedule).observe(article);
  void document.fonts.ready.then(schedule);
  schedule();
}
