import { ApiFailure } from "./api";

/** 공개 뱃지와 관리자 사용 건수의 공통 표시값. */
export type StackBadge = { id: number; name: string; imageUrl: string; projectCount: number | null };

/** 권한에 따라 사용 건수가 null일 수 있는 뱃지 응답을 검사한다. */
export function parseStackBadges(value: unknown): StackBadge[] {
  if (!Array.isArray(value)) throw new ApiFailure("response");
  return value.map((entry) => {
    if (!entry || typeof entry !== "object") throw new ApiFailure("response");
    const item = entry as Record<string, unknown>;
    if (!Number.isSafeInteger(item.id) || (item.id as number) < 1 || typeof item.name !== "string" ||
      typeof item.imageUrl !== "string" ||
      (item.projectCount != null && (!Number.isSafeInteger(item.projectCount) || (item.projectCount as number) < 0)))
      throw new ApiFailure("response");
    return { id: item.id as number, name: item.name, imageUrl: item.imageUrl,
      projectCount: item.projectCount as number | null ?? null };
  });
}

/** 원본 이미지를 정사각 캔버스에 맞춰 64×64 PNG 파일로 만든다. */
export async function normalizeBadge(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.size === 0 || file.size > 10 * 1024 * 1024) throw new ApiFailure("response");
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 64; canvas.height = 64;
    const context = canvas.getContext("2d");
    if (!context) throw new ApiFailure("response");
    const scale = Math.min(64 / bitmap.width, 64 / bitmap.height);
    const width = bitmap.width * scale; const height = bitmap.height * scale;
    context.clearRect(0, 0, 64, 64);
    context.drawImage(bitmap, (64 - width) / 2, (64 - height) / 2, width, height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new ApiFailure("response")), "image/png"));
    return new File([blob], "stack-badge.png", { type: "image/png" });
  } finally { bitmap.close(); }
}
