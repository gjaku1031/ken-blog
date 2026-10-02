/**
 * 확대 동작을 이미 연결한 요소
 */
const connected = new WeakSet<HTMLElement>();

/**
 * 이미지와 도식을 같은 확대 창으로 엶
 * Blob은 열 때 만들고 닫을 때 해제함
 */
export function connectImageZoom(image: HTMLImageElement, options: {
  /**
   * 이미지 대신 확대 창을 열 버튼
   */
  trigger?: HTMLButtonElement;
  /**
   * 확대 시 사용할 이미지 주소 또는 Blob 공급자
   */
  source?: () => string | Blob;
} = {}): void {
  const trigger: HTMLElement = options.trigger ?? image;
  if (connected.has(trigger)) return;
  connected.add(trigger);
  trigger.setAttribute("aria-haspopup", "dialog");
  if (!options.trigger) {
    trigger.tabIndex = 0;
    trigger.setAttribute("role", "button");
    trigger.setAttribute("aria-label", `${image.alt || "이미지"} 확대`);
    trigger.classList.add("image-zoom-trigger");
  }
  /**
   * 화면에 연결된 이미지의 확대 창 열기, 중복 창은 생략
   */
  const open = () => {
    if (!trigger.isConnected || document.querySelector(".ken-image-zoom[open]")) return;
    openImageZoom(options.source?.() ?? (image.currentSrc || image.src), image.alt || "이미지", trigger);
  };
  trigger.addEventListener("click", open);
  if (!options.trigger) trigger.addEventListener("keydown", event => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(); }
  });
}

/**
 * 확대·축소·화면 맞춤을 지원하는 이미지 대화상자 열기
 *
 * 1. Blob 입력일 때만 임시 URL 생성
 * 2. 확대·축소·화면 맞춤 조작 구성
 * 3. 배율 변경 전 스크롤 중심을 보존해 이미지 치수 갱신
 * 4. 맞춤 상태에서 표시 영역 크기 변화 반영
 * 5. 닫힐 때 관찰·DOM·Blob URL 해제와 원래 요소 포커스 복원
 */
function openImageZoom(source: string | Blob, title: string, trigger: HTMLElement): void {
  // Blob 입력일 때만 임시 URL 생성
  const objectUrl = source instanceof Blob ? URL.createObjectURL(source) : null;
  const dialog = document.createElement("dialog");
  dialog.className = "ken-image-zoom";
  dialog.setAttribute("aria-label", `${title} 확대 보기`);
  const header = document.createElement("div"); header.className = "image-zoom-header";
  const heading = document.createElement("h2"); heading.textContent = title;
  const controls = document.createElement("div"); controls.className = "image-zoom-controls";
  const viewport = document.createElement("div"); viewport.className = "image-zoom-viewport";
  viewport.tabIndex = 0; viewport.setAttribute("aria-label", "확대한 이미지 스크롤 영역");
  const canvas = document.createElement("div"); canvas.className = "image-zoom-canvas";
  const large = document.createElement("img"); large.alt = title; large.draggable = false;
  const status = document.createElement("p"); status.className = "image-zoom-status";
  status.setAttribute("role", "status"); status.textContent = "이미지를 불러오는 중입니다.";
  // 확대·축소·화면 맞춤 조작 구성
  /**
   * 확대 창의 조작 버튼 생성
   */
  const button = (text: string, label: string, action: () => void) => {
    const item = document.createElement("button"); item.type = "button"; item.textContent = text;
    item.setAttribute("aria-label", label); item.addEventListener("click", action); return item;
  };
  const close = button("닫기", "확대 창 닫기", () => dialog.close());
  const minus = button("−", "축소", () => changeScale(scale - 0.25));
  const plus = button("+", "확대", () => changeScale(scale + 0.25));
  const fit = button("화면 맞춤", "화면에 맞추기", () => { fitted = true; fitImage(); });
  const range = document.createElement("input"); range.type = "range"; range.min = "1"; range.max = "400"; range.step = "1";
  range.setAttribute("aria-label", "확대 배율");
  const output = document.createElement("output"); output.className = "mono";
  let scale = 1;
  let fitted = true;
  let ready = false;
  // 배율 변경 전 스크롤 중심을 보존해 이미지 치수 갱신
  /**
   * 확대 배율·조작 상태를 반영하고 스크롤 중심 유지
   */
  function paint(center = false) {
    const oldWidth = canvas.offsetWidth, oldHeight = canvas.offsetHeight;
    const x = (viewport.scrollLeft + viewport.clientWidth / 2) / Math.max(1, oldWidth);
    const y = (viewport.scrollTop + viewport.clientHeight / 2) / Math.max(1, oldHeight);
    const width = large.naturalWidth * scale, height = large.naturalHeight * scale;
    large.style.width = `${width}px`; large.style.height = `${height}px`;
    canvas.style.width = `${width + 32}px`; canvas.style.height = `${height + 32}px`;
    range.value = String(Math.round(scale * 100));
    output.value = `${range.value}%`; range.setAttribute("aria-valuetext", output.value);
    minus.disabled = !ready || scale <= 0.01; plus.disabled = !ready || scale >= 4;
    range.disabled = fit.disabled = !ready;
    viewport.scrollLeft = (center ? 0.5 : x) * canvas.offsetWidth - viewport.clientWidth / 2;
    viewport.scrollTop = (center ? 0.5 : y) * canvas.offsetHeight - viewport.clientHeight / 2;
  }
  /**
   * 입력 배율을 허용 범위로 제한해 적용
   */
  function changeScale(value: number) {
    if (!ready) return;
    fitted = false; scale = Math.max(0.01, Math.min(4, Math.round(value * 100) / 100)); paint();
  }
  /**
   * 이미지가 표시 영역에 맞도록 배율 계산
   */
  function fitImage() {
    if (!ready) return;
    scale = Math.max(0.01, Math.floor(Math.min(4, (viewport.clientWidth - 32) / large.naturalWidth,
      (viewport.clientHeight - 32) / large.naturalHeight) * 100) / 100);
    paint(true);
  }
  range.addEventListener("input", () => changeScale(Number(range.value) / 100));
  large.addEventListener("load", () => { ready = true; status.hidden = true; fitImage(); }, { once: true });
  large.addEventListener("error", () => { status.textContent = "이미지를 불러오지 못했습니다."; large.hidden = true; }, { once: true });
  header.append(heading, close); controls.append(minus, range, plus, output, fit);
  canvas.append(large); viewport.append(canvas, status); dialog.append(header, controls, viewport);
  // 맞춤 상태에서 표시 영역 크기 변화 반영
  const observer = new ResizeObserver(() => { if (fitted) fitImage(); });
  // 닫힐 때 관찰·DOM·Blob URL 해제와 원래 요소 포커스 복원
  dialog.addEventListener("close", () => {
    observer.disconnect(); dialog.remove(); document.documentElement.classList.remove("image-zoom-open");
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    if (trigger.isConnected) trigger.focus({ preventScroll: true });
  }, { once: true });
  dialog.addEventListener("click", event => {
    const bounds = dialog.getBoundingClientRect();
    if (event.target === dialog && (event.clientX < bounds.left || event.clientX > bounds.right ||
      event.clientY < bounds.top || event.clientY > bounds.bottom)) dialog.close();
  });
  document.body.append(dialog); document.documentElement.classList.add("image-zoom-open");
  dialog.showModal(); close.focus(); paint(); observer.observe(viewport);
  large.src = objectUrl ?? (source as string);
}
