/** GitHub Pages의 공개 읽기 화면에서 사용할 HTTPS 인증 미러 출처를 반환한다. */
export function publicPagesMirrorOrigin(): string | null {
  if (typeof window === "undefined" || window.location.hostname !== "gjaku1031.github.io") return null;
  try {
    const mirror = new URL(process.env.NEXT_PUBLIC_API_BASE_URL ?? "");
    if (mirror.protocol !== "https:" || mirror.username || mirror.password || mirror.pathname !== "/" ||
      mirror.search || mirror.hash) return null;
    return mirror.origin;
  } catch { return null; }
}

/** {@link publicPagesMirrorOrigin}으로 이동해야 하는 세션·편집 정적 경로만 구별한다. */
export function isProtectedMirrorRoute(pathname: string): boolean {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";
  const route = basePath && pathname.startsWith(`${basePath}/`) ? pathname.slice(basePath.length) : pathname;
  return /^\/(?:login|admin|write|editor|invite)(?:\/|$)/.test(route);
}
