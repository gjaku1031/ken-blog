import { renderMermaid } from "./mermaid-render";

/**
 * 노드별 진행 중인 도식 렌더 작업
 */
const pendingMermaid = new WeakMap<HTMLElement, {
  /**
   * 렌더 테마
   */
  theme: string;
  /**
   * 원문
   */
  source: string;
  /**
   * 작업 취소 제어기
   */
  controller: AbortController;
  /**
   * 진행 중인 비동기 작업
   */
  task: Promise<void>
}>();

/**
 * 정적 본문 HTML에 이미지 확대·복사·주석·Mermaid 상호작용을 연결함
 *
 * 1. 테마별 이미지 전환·키보드 확대 연결
 * 2. 코드 복사 동작을 중복 없이 연결
 * 3. 주석 팝업과 마지막 참조 위치로의 복귀 연결
 * 4. Mermaid 블록별 작업 공유·취소·세대 관리
 * 5. 현재 화면의 결과만 Blob 이미지로 표시하고 로드 후 URL 해제
 * 6. 성공·실패·취소 모두 분리 감시와 대기 작업 정리
 */
export async function enhanceMarkdown(root: HTMLElement, options: {
  /**
   * 렌더 테마
   */
  theme?: "light" | "dark"
} = {}): Promise<void> {
  const theme = options.theme ?? (document.documentElement.dataset.theme === "dark" ? "dark" : "light");
  if (!root.isConnected) return;
  // 테마별 이미지 전환·키보드 확대 연결
  for (const image of root.querySelectorAll<HTMLImageElement>("img.ken-attachment")) {
    if (!image.dataset.lightSrc) image.dataset.lightSrc = image.src;
    if (image.dataset.darkSrc) image.src = theme === "dark" ? image.dataset.darkSrc : image.dataset.lightSrc;
    if (image.dataset.enhanced) continue;
    image.dataset.enhanced = "1";
    image.tabIndex = 0;
    image.setAttribute("role", "button");
    image.setAttribute("aria-label", `${image.alt || "이미지"} 확대`);
    /**
     * 이미지 확대 표시와 닫기 동작 연결
     */
    const zoom = () => {
      const dialog = document.createElement("dialog");
      dialog.className = "ken-image-zoom";
      const large = document.createElement("img");
      large.src = image.src; large.alt = image.alt;
      const close = document.createElement("button");
      close.type = "button"; close.textContent = "닫기"; close.addEventListener("click", () => dialog.close());
      dialog.append(close, large); document.body.append(dialog);
      dialog.addEventListener("close", () => dialog.remove(), { once: true });
      if (image.isConnected) dialog.showModal(); else dialog.remove();
    };
    image.addEventListener("click", zoom);
    image.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); zoom(); } });
  }
  // 코드 복사 동작을 중복 없이 연결
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
  // 주석 팝업과 마지막 참조 위치로의 복귀 연결
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
    popup.hidden = true; ref.append(popup);
    ref.addEventListener("mouseenter", () => { popup.hidden = false; });
    ref.addEventListener("mouseleave", () => { popup.hidden = true; });
    ref.addEventListener("focusin", () => { popup.hidden = false; });
    ref.addEventListener("focusout", (event) => {
      if (!ref.contains(event.relatedTarget as Node | null)) popup.hidden = true;
    });
    ref.querySelector(":scope > a")?.addEventListener("click", () => {
      if (!ref.isConnected || !note.isConnected) return;
      const back = note.querySelector<HTMLAnchorElement>("[data-annotation-return]");
      if (back) back.href = `#${ref.id}`;
    });
  }
  // Mermaid 블록별 작업 공유·취소·세대 관리
  const work = Array.from(root.querySelectorAll<HTMLElement>(".ken-mermaid")).map(async (block) => {
    const source = block.dataset.mermaidSource;
    if (!source || !block.isConnected || (block.dataset.enhanced === theme && block.dataset.enhancedSource === source)) return;
    const pending = pendingMermaid.get(block);
    if (pending?.theme === theme && pending.source === source && !pending.controller.signal.aborted) {
      await pending.task;
      return;
    }
    pending?.controller.abort();
    const generation = String(Number(block.dataset.generation ?? "0") + 1);
    block.dataset.generation = generation;
    const panel = block.querySelector<HTMLElement>(".mermaid-source");
    const button = block.querySelector<HTMLButtonElement>(".mermaid-source-toggle");
    const diagram = block.querySelector<HTMLElement>(".mermaid-diagram");
    if (!panel || !button || !diagram) return;
    panel.textContent = source;
    panel.hidden = true;
    if (!block.dataset.toggleBound) {
      block.dataset.toggleBound = "1";
      button.addEventListener("click", () => { panel.hidden = !panel.hidden; button.textContent = panel.hidden ? "원문 보기" : "원문 숨기기"; });
    }
    diagram.replaceChildren();
    const controller = new AbortController();
    const detachedCheck = globalThis.setInterval(() => { if (!block.isConnected) controller.abort(); }, 50);
    // 테마 전환으로 취소된 노드도 현재 테마의 원문을 다시 렌더해야 함
    const task = (async () => { try {
      const svg = await renderMermaid(source, theme, controller.signal);
      if (controller.signal.aborted || !block.isConnected || block.dataset.generation !== generation) return;
      // 현재 화면의 결과만 Blob 이미지로 표시하고 로드 후 URL 해제
      const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
      const image = document.createElement("img");
      image.alt = "Mermaid 도식"; image.src = url;
      image.addEventListener("load", () => URL.revokeObjectURL(url), { once: true });
      image.addEventListener("error", () => URL.revokeObjectURL(url), { once: true });
      diagram.append(image);
      block.dataset.enhanced = theme;
      block.dataset.enhancedSource = source;
    } catch {
      if (!controller.signal.aborted && block.isConnected && block.dataset.generation === generation) {
        diagram.textContent = "도식을 표시할 수 없습니다. 아래 원문을 확인하세요.";
        panel.hidden = false;
        block.dataset.enhanced = theme;
        block.dataset.enhancedSource = source;
      }
    } finally {
      // 성공·실패·취소 모두 분리 감시와 대기 작업 정리
      globalThis.clearInterval(detachedCheck);
      if (pendingMermaid.get(block)?.controller === controller) pendingMermaid.delete(block);
    } })();
    pendingMermaid.set(block, { theme, source, controller, task });
    await task;
  });
  await Promise.all(work);
}
