/**
 * 태그·클래스·텍스트로 DOM 요소 생성, 문자열을 HTML로 해석하지 않음
 */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (text) item.textContent = text;
  return item;
}
