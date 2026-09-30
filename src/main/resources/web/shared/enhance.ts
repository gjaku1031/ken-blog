import { renderMermaid } from "./mermaid-render";

const pendingMermaid = new WeakMap<HTMLElement, { theme: string; source: string; controller: AbortController; task: Promise<void> }>();

/** 정적 HTML과 미리보기에 동일한 점진적 상호작용을 연결한다. */
export async function enhanceMarkdown(root: HTMLElement, options: { theme?: "light" | "dark"; signal?: AbortSignal } = {}): Promise<void> {
  const theme = options.theme ?? (document.documentElement.dataset.theme === "dark" ? "dark" : "light");
  if (options.signal?.aborted || !root.isConnected) return;
  for (const image of root.querySelectorAll<HTMLImageElement>("img.ken-attachment")) {
    if (!image.dataset.lightSrc) image.dataset.lightSrc = image.src;
    if (image.dataset.darkSrc) image.src = theme === "dark" ? image.dataset.darkSrc : image.dataset.lightSrc;
    if (image.dataset.enhanced) continue;
    image.dataset.enhanced = "1";
    image.tabIndex = 0;
    image.setAttribute("role", "button");
    image.setAttribute("aria-label", `${image.alt || "이미지"} 확대`);
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
    // 보존된 DOM 노드는 이전 preview revision의 AbortSignal 이후에도 같은 원문을 렌더해야 한다.
    const task = (async () => { try {
      const svg = await renderMermaid(source, theme, controller.signal);
      if (controller.signal.aborted || !block.isConnected || block.dataset.generation !== generation) return;
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
      globalThis.clearInterval(detachedCheck);
      if (pendingMermaid.get(block)?.controller === controller) pendingMermaid.delete(block);
    } })();
    pendingMermaid.set(block, { theme, source, controller, task });
    await task;
  });
  await Promise.all(work);
}
