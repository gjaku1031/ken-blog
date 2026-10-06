import Panzoom, { type PanzoomObject } from "@panzoom/panzoom";

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
 * 드래그·휠·핀치·키보드 이동을 지원하는 이미지 대화상자 열기
 *
 * 1. 이미지 로드 후 원본 치수와 화면 맞춤 배율로 Panzoom 초기화
 * 2. 버튼·슬라이더와 포인터 입력의 배율을 같은 상태로 표시
 * 3. 화면 크기 변경 시 중심 배치 갱신, 맞춤 상태에서만 배율 재계산
 * 4. 닫힐 때 문서 포인터 이벤트·관찰·Blob URL 해제와 포커스 복원
 */
function openImageZoom(source: string | Blob, title: string, trigger: HTMLElement): void {
  /**
   * 이번 창에서 소유하는 Blob 주소와 이벤트 수명
   */
  const objectUrl = source instanceof Blob ? URL.createObjectURL(source) : null;

  /**
   * 닫힌 창에 지연 로드·입력 이벤트가 남지 않도록 묶는 취소 신호
   */
  const lifetime = new AbortController();

  /**
   * 확대 창과 제목·조작 영역
   */
  const dialog = document.createElement("dialog");
  dialog.className = "ken-image-zoom";
  dialog.setAttribute("aria-label", `${title} 확대 보기`);

  /**
   * 제목과 닫기 버튼 영역
   */
  const header = document.createElement("div"); header.className = "image-zoom-header";

  /**
   * 확대 대상 제목
   */
  const heading = document.createElement("h2"); heading.textContent = title;

  /**
   * 배율·화면 맞춤 버튼 영역
   */
  const controls = document.createElement("div"); controls.className = "image-zoom-controls";

  /**
   * 키보드 입력과 크기 관찰 대상
   */
  const viewport = document.createElement("div"); viewport.className = "image-zoom-viewport";
  viewport.tabIndex = 0; viewport.setAttribute("aria-label", "확대한 이미지 이동 영역");

  /**
   * 이미지 밖의 빈 공간에서도 포인터 이동을 받는 고정 크기 캔버스
   */
  const canvas = document.createElement("div"); canvas.className = "image-zoom-canvas";

  /**
   * 원본 치수를 유지하고 CSS transform으로 이동·확대하는 이미지
   */
  const large = document.createElement("img"); large.alt = title; large.draggable = false;

  /**
   * 로드·오류 상태 안내
   */
  const status = document.createElement("p"); status.className = "image-zoom-status";
  status.setAttribute("role", "status"); status.textContent = "이미지를 불러오는 중입니다.";

  /**
   * 마우스·터치·키보드 조작 안내
   */
  const hint = document.createElement("p"); hint.className = "image-zoom-hint";
  hint.textContent = "드래그·방향키로 이동 · 휠·두 손가락으로 확대";

  /**
   * 이미지 로드가 끝난 뒤 생성하는 이동·확대 컨트롤러
   */
  let panzoom: PanzoomObject | undefined;

  /**
   * 창 크기 변경 시 화면 맞춤을 유지할지 여부
   */
  let fitted = true;

  /**
   * 확대 창의 조작 버튼 생성
   */
  const button = (text: string, label: string, action: () => void) => {
    /**
     * 조작 버튼
     */
    const item = document.createElement("button"); item.type = "button"; item.textContent = text;
    item.setAttribute("aria-label", label);
    item.addEventListener("click", action, { signal: lifetime.signal });
    return item;
  };

  /**
   * 창 닫기
   */
  const close = button("닫기", "확대 창 닫기", () => dialog.close());

  /**
   * 현재 배율에서 25%p 축소
   */
  const minus = button("−", "축소", () => changeScale((panzoom?.getScale() ?? 1) - 0.25));

  /**
   * 현재 배율에서 25%p 확대
   */
  const plus = button("+", "확대", () => changeScale((panzoom?.getScale() ?? 1) + 0.25));

  /**
   * 배율과 이동 위치를 화면 중앙에 맞춤
   */
  const fit = button("화면 맞춤", "화면에 맞추기", () => { fitted = true; fitImage(); });

  /**
   * 1~400% 배율 입력
   */
  const range = document.createElement("input"); range.type = "range"; range.min = "1"; range.max = "400"; range.step = "1";
  range.setAttribute("aria-label", "확대 배율");

  /**
   * 포인터·버튼·슬라이더가 공유하는 현재 배율 표시
   */
  const output = document.createElement("output"); output.className = "mono";

  /**
   * Panzoom의 현재 배율과 로드 상태를 조작 UI에 반영
   */
  function syncControls() {
    /**
     * 컨트롤러의 현재 배율
     */
    const scale = panzoom?.getScale() ?? 1;
    range.value = String(Math.round(scale * 100));
    output.value = `${range.value}%`; range.setAttribute("aria-valuetext", output.value);
    minus.disabled = !panzoom || scale <= 0.01; plus.disabled = !panzoom || scale >= 4;
    range.disabled = fit.disabled = !panzoom;
  }

  /**
   * 포인터 좌표 계산에도 사용되는 실제 여백으로 이미지를 중앙 배치
   */
  function centerImage() {
    large.style.width = `${large.naturalWidth}px`; large.style.height = `${large.naturalHeight}px`;
    large.style.marginLeft = `${(viewport.clientWidth - large.naturalWidth) / 2}px`;
    large.style.marginTop = `${(viewport.clientHeight - large.naturalHeight) / 2}px`;
  }

  /**
   * 여백을 제외한 화면 맞춤 배율, 기존 1~400% 범위 유지
   */
  function fitScale() {
    return Math.max(0.01, Math.min(4, (viewport.clientWidth - 32) / large.naturalWidth,
      (viewport.clientHeight - 32) / large.naturalHeight));
  }

  /**
   * 화면 중앙의 내용을 기준으로 버튼·슬라이더 배율 변경
   */
  function changeScale(value: number) {
    if (!panzoom) return;
    fitted = false;
    /**
     * 포인터 확대 기준이 되는 표시 영역
     */
    const bounds = viewport.getBoundingClientRect();
    panzoom.zoomToPoint(value, { clientX: bounds.left + bounds.width / 2, clientY: bounds.top + bounds.height / 2 });
    syncControls();
  }

  /**
   * 확대·이동 상태를 화면 맞춤 배율과 중앙 위치로 복원
   */
  function fitImage() {
    if (!panzoom) return;
    centerImage();
    panzoom.reset({ startScale: fitScale(), startX: 0, startY: 0, animate: false });
    syncControls();
  }

  // 포인터·휠·슬라이더 입력이 같은 배율 상태를 사용하도록 연결
  range.addEventListener("input", () => changeScale(Number(range.value) / 100), { signal: lifetime.signal });
  large.addEventListener("panzoomchange", syncControls, { signal: lifetime.signal });
  large.addEventListener("panzoomstart", () => {
    fitted = false; canvas.style.cursor = "grabbing"; viewport.focus({ preventScroll: true });
  }, { signal: lifetime.signal });
  large.addEventListener("panzoomend", () => { canvas.style.cursor = "grab"; }, { signal: lifetime.signal });
  canvas.addEventListener("wheel", event => {
    if (!panzoom) return;
    fitted = false; panzoom.zoomWithWheel(event); syncControls();
  }, { passive: false, signal: lifetime.signal });
  viewport.addEventListener("keydown", event => {
    if (!panzoom) return;
    /**
     * 방향키별 화면 픽셀 이동량
     */
    const delta = { ArrowLeft: [40, 0], ArrowRight: [-40, 0], ArrowUp: [0, 40], ArrowDown: [0, -40] }[event.key];
    if (!delta) return;
    event.preventDefault(); fitted = false;
    panzoom.pan(delta[0] / panzoom.getScale(), delta[1] / panzoom.getScale(), { relative: true });
  }, { signal: lifetime.signal });

  // 원본 치수가 확보된 뒤에만 컨트롤러 생성, 로드 전 닫힌 창은 취소 신호로 제외
  large.addEventListener("load", () => {
    centerImage();
    panzoom = Panzoom(large, { canvas: true, cursor: "grab", minScale: 0.01, maxScale: 4, startScale: fitScale() });
    status.hidden = true; syncControls();
  }, { once: true, signal: lifetime.signal });
  large.addEventListener("error", () => {
    status.textContent = "이미지를 불러오지 못했습니다."; large.hidden = true;
  }, { once: true, signal: lifetime.signal });
  header.append(heading, close); controls.append(minus, range, plus, output, fit);
  canvas.append(large); viewport.append(canvas, status); dialog.append(header, controls, hint, viewport);

  /**
   * 크기 변경 시 중앙 배치를 갱신하며 수동 배율은 보존
   */
  const observer = new ResizeObserver(() => {
    if (!panzoom) return;
    if (fitted) fitImage(); else centerImage();
  });
  /**
   * 드래그가 창 밖에서 끝난 경우와 배경 자체를 누른 경우 구분
   */
  let backdropPressed = false;
  dialog.addEventListener("pointerdown", event => { backdropPressed = event.target === dialog; }, { signal: lifetime.signal });
  // 라이브러리의 문서 포인터 이벤트까지 제거하고 원래 읽기 위치로 포커스 복원
  dialog.addEventListener("close", () => {
    lifetime.abort(); observer.disconnect(); panzoom?.destroy(); dialog.remove();
    document.documentElement.classList.remove("image-zoom-open");
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    if (trigger.isConnected) trigger.focus({ preventScroll: true });
  }, { once: true });
  dialog.addEventListener("click", event => {
    /**
     * 배경 클릭 판정에 사용하는 창 경계
     */
    const bounds = dialog.getBoundingClientRect();
    if (backdropPressed && event.target === dialog && (event.clientX < bounds.left || event.clientX > bounds.right ||
      event.clientY < bounds.top || event.clientY > bounds.bottom)) dialog.close();
    backdropPressed = false;
  }, { signal: lifetime.signal });
  document.body.append(dialog); document.documentElement.classList.add("image-zoom-open");
  dialog.showModal(); close.focus(); syncControls(); observer.observe(viewport);
  large.src = objectUrl ?? (source as string);
}
