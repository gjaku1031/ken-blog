import { ApiFailure, apiUrl } from "./api";

/** 홈과 관리자 미리보기에 같은 공개 소개를 제공한다. */
export type HomeProfile = { name: string; tagline: string; intro: string; github: string;
  email: string; photoUrl: string | null };

/** 서버 응답의 이메일·사진 URL을 확인해 {@link HomeProfile}로 반환한다. */
export function parseProfile(value: unknown): HomeProfile {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ApiFailure("response");
  const item = value as Record<string, unknown>;
  for (const name of ["name", "tagline", "intro", "github", "email"]) {
    if (typeof item[name] !== "string") throw new ApiFailure("response");
  }
  if (item.photoUrl != null && typeof item.photoUrl !== "string") throw new ApiFailure("response");
  return { name: item.name as string, tagline: item.tagline as string, intro: item.intro as string,
    github: item.github as string, email: item.email as string,
    photoUrl: item.photoUrl as string | null ?? null };
}

/** {@link apiUrl}의 공개 기반 주소로 상대 사진·뱃지 경로를 해석한다. */
export function publicImageUrl(path: string | null): string | null {
  if (!path || !path.startsWith("/api/v1/") || path.includes("..")) return null;
  try { return apiUrl(path).href; } catch { return null; }
}
