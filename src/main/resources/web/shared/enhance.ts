import { renderMermaid } from "./mermaid-render";
import { connectImageZoom } from "./image-zoom";

/**
 * 문서별 렌더 예약 해제 함수
 */
const mermaidCleanup = new WeakMap<HTMLElement, () => void>();

/**
 * 검증된 SVG의 테마·원문 캐시, 최대 16개로 메모리 제한
 */
const mermaidCache = new Map<string, string>();

/**
 * 정적 본문 HTML에 이미지 확대·복사·주석·Mermaid 상호작용을 연결함
 *
 * 1. 테마별 이미지 선택과 공통 확대 창 연결
 * 2. 중복 연결 없이 코드 복사 동작 구성
 * 3. 본문 주석 팝업과 복귀 위치 연결
 * 4. 화면 접근 시 도식 렌더, 테마 변경 시 이전 예약 취소
 * 5. 문서 분리 시 작업 해제, 검증된 SVG를 제한된 캐시에 보관
 */
export async function enhanceMarkdown(root: HTMLElement, options: {
  /**
   * 렌더 테마
   */
  theme?: "light" | "dark"
} = {}): Promise<void> {
  const theme = options.theme ?? (document.documentElement.dataset.theme === "dark" ? "dark" : "light");
  if (!root.isConnected) return;
  // 테마별 이미지 선택과 공통 확대 창 연결
  for (const image of root.querySelectorAll<HTMLImageElement>("img.ken-attachment")) {
    if (!image.dataset.lightSrc) image.dataset.lightSrc = image.src;
    if (image.dataset.darkSrc) image.src = theme === "dark" ? image.dataset.darkSrc : image.dataset.lightSrc;
    const width = theme === 'dark' ? image.dataset.darkWidth ?? image.dataset.lightWidth : image.dataset.lightWidth;
    const height = theme === 'dark' ? image.dataset.darkHeight ?? image.dataset.lightHeight : image.dataset.lightHeight;
    if (width && height) { image.width = Number(width); image.height = Number(height); }
    if (!image.closest("a[href]")) connectImageZoom(image);
  }
  // 중복 연결 없이 코드 복사 동작 구성
  for (const button of root.querySelectorAll<HTMLButtonElement>(".code-copy")) {
    if (button.dataset.enhanced) continue;
    button.dataset.enhanced = "1";
    button.addEventListener("click", async () => {
      const source = button.closest("pre")?.querySelector("code")?.textContent;
      if (source == null) return;
      try { await navigator.clipboard.writeText(source); button.textContent = "복사됨"; }
      catch { button.textContent = "복사 실패"; }
    });
  }
  // 본문 주석 팝업과 복귀 위치 연결
  for (const ref of root.querySelectorAll<HTMLElement>(".ken-annotation-ref")) {
    if (ref.dataset.enhanced) continue;
    ref.dataset.enhanced = "1";
    const index = Number(ref.dataset.annotationIndex);
    const note = root.querySelector<HTMLElement>(`#annotation-${index}`);
    if (!note) continue;
    const popup = document.createElement("span");
    popup.className = "ken-annotation-popup";
    const content = note.querySelector(".ken-annotation-content");
    if (content) popup.append(...Array.from(content.childNodes, (child) => child.cloneNode(true)));
    popup.hidden = true;
    popup.setAttribute("role", "region");
    popup.setAttribute("aria-label", "주석 미리보기");
    ref.append(popup);
    let hovered = false;
    let dismissed = false;
    let frame = 0;

    /**
     * 스크롤·크기 변경에도 팝업을 화면 안에 배치하고 분리 시 예약 해제
     */
    const position = () => {
      if (popup.hidden || !ref.isConnected) { frame = 0; return; }
      const anchor = ref.getBoundingClientRect();
      const bounds = popup.getBoundingClientRect();
      popup.style.left = `${Math.max(8, Math.min(anchor.left, innerWidth - bounds.width - 8))}px`;
      const above = anchor.top - bounds.height;
      popup.style.top = `${Math.max(8, Math.min(above >= 8 ? above : anchor.bottom, innerHeight - bounds.height - 8))}px`;
      frame = requestAnimationFrame(position);
    };

    /**
     * 포인터와 키보드 포커스를 함께 고려하고 Escape 해제 상태 유지
     */
    const update = () => {
      const active = hovered || ref.contains(document.activeElement);
      if (!active) dismissed = false;
      popup.hidden = !active || dismissed;
      if (popup.hidden) { cancelAnimationFrame(frame); frame = 0; }
      else if (!frame) position();
    };
    ref.addEventListener("mouseenter", () => { hovered = true; update(); });
    ref.addEventListener("mouseleave", () => { hovered = false; update(); });
    ref.addEventListener("focusin", update);
    ref.addEventListener("focusout", () => { queueMicrotask(update); });
    ref.addEventListener("keydown", event => {
      if (event.key !== "Escape" || popup.hidden) return;
      event.preventDefault(); event.stopPropagation(); dismissed = true;
      if (popup.contains(document.activeElement)) ref.querySelector<HTMLAnchorElement>(":scope > a")?.focus();
      update();
    });
    ref.querySelector(":scope > a")?.addEventListener("click", () => {
      if (!ref.isConnected || !note.isConnected) return;
      const back = note.querySelector<HTMLAnchorElement>("[data-annotation-return]");
      if (back) back.href = `#${ref.id}`;
    });
  }
  // 이전 테마의 관측·작업을 해제하고 화면에 접근한 도식만 예약
  mermaidCleanup.get(root)?.();
  const blocks = Array.from(root.querySelectorAll<HTMLElement>(".ken-mermaid"));
  if (!blocks.length) return;
  const controller = new AbortController();
  const pending = new Map<HTMLElement, AbortController>();

  /**
   * 현재 테마의 가시 도식을 렌더하고 검증된 SVG만 이미지로 표시
   */
  const render = async (block: HTMLElement) => {
    const source = block.dataset.mermaidSource;
    if (!source || !block.isConnected || controller.signal.aborted ||
      (block.dataset.enhanced === theme && block.dataset.enhancedSource === source)) return;
    const panel = block.querySelector<HTMLElement>(".mermaid-source");
    const button = block.querySelector<HTMLButtonElement>(".mermaid-source-toggle");
    const diagram = block.querySelector<HTMLElement>(".mermaid-diagram");
    if (!panel || !button || !diagram) return;
    if (!block.dataset.toggleBound) {
      block.dataset.toggleBound = "1";
      panel.hidden = true;
      button.addEventListener("click", () => { panel.hidden = !panel.hidden; button.textContent = panel.hidden ? "원문 보기" : "원문 숨기기"; });
    }
    const task = new AbortController();
    pending.set(block, task);
    const signal = AbortSignal.any([controller.signal, task.signal]);
    const key = `${theme}\n${source}`;
    try {
      const svg = mermaidCache.get(key) ?? await renderMermaid(source, theme, signal);
      if (signal.aborted || !block.isConnected) return;
      // 재방문 항목을 마지막으로 이동하여 오래된 항목부터 제거
      mermaidCache.delete(key); mermaidCache.set(key, svg);
      if (mermaidCache.size > 16) mermaidCache.delete(mermaidCache.keys().next().value!);
      const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
      const image = document.createElement("img");
      image.alt = "Mermaid 도식"; image.src = url;
      image.addEventListener("load", () => URL.revokeObjectURL(url), { once: true });
      image.addEventListener("error", () => URL.revokeObjectURL(url), { once: true });
      connectImageZoom(image, { source: () => new Blob([svg], { type: "image/svg+xml" }) });
      diagram.replaceChildren(image);
      block.dataset.enhanced = theme; block.dataset.enhancedSource = source;
    } catch {
      if (!signal.aborted && block.isConnected) {
        diagram.textContent = "도식을 표시할 수 없습니다. 원문을 확인하세요.";
        panel.hidden = false; button.textContent = "원문 숨기기";
      }
    } finally { pending.delete(block); }
  };
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) {
      observer.unobserve(entry.target); void render(entry.target as HTMLElement);
    }
  }, { rootMargin: '240px' });
  const detached = new MutationObserver(() => {
    if (!root.isConnected) { cleanup(); return; }
    for (const [block, task] of pending) if (!block.isConnected) task.abort();
  });

  /**
   * 문서 교체·테마 전환 시 관측과 대기 렌더 해제
   */
  function cleanup() { controller.abort(); observer.disconnect(); detached.disconnect(); mermaidCleanup.delete(root); }
  mermaidCleanup.set(root, cleanup);
  detached.observe(document.body, { childList: true, subtree: true });
  blocks.forEach(block => observer.observe(block));
}
