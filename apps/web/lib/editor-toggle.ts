/** 안전하게 편집할 수 있는 한 단계 접기의 정확한 원문 경계. */
export type ToggleSource = {
  beforeTitle: string; titleRaw: string; title: string; afterTitle: string;
  innerSource: string; suffix: string;
};

/** 원문 제목의 기본 HTML 문자 참조만 입력용 문자로 되돌린다. */
function decodeTitle(source: string): string {
  return source.replace(/&(amp|lt|gt|quot|apos|#(?:x[0-9a-f]+|[0-9]+));/gi, (entity, name: string) => {
    const known: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
    if (name[0] !== "#") return known[name.toLowerCase()] ?? entity;
    const hex = name[1]?.toLowerCase() === "x";
    const number = Number.parseInt(name.slice(hex ? 2 : 1), hex ? 16 : 10);
    return number > 0 && number <= 0x10ffff && !(number >= 0xd800 && number <= 0xdfff) ? String.fromCodePoint(number) : entity;
  });
}

/** 중첩·속성·모호한 HTML을 거부하고 wrapper/내부/닫힘을 소스 위치대로 분리한다. */
export function splitEditableToggle(raw: string): ToggleSource | null {
  if (raw.length > 1024 * 1024) return null;
  const opening = /^<details>(?:[ \t]*\r?\n[ \t]*)?[ \t]*<summary>([^\r\n<>]*)<\/summary>/i.exec(raw);
  if (!opening) return null;
  const titleRaw = opening[1];
  if (/&[a-z][a-z0-9]+;/i.test(titleRaw.replace(/&(amp|lt|gt|quot|apos);/gi, ""))) return null;
  const summary = /<summary>/i.exec(opening[0]);
  if (!summary) return null;
  const titleStart = summary.index + summary[0].length;
  const titleEnd = titleStart + titleRaw.length;
  const rest = raw.slice(opening[0].length);
  const closing = /(^|\r?\n)[ \t]*<\/details>[ \t]*(?:\r?\n)?$/i.exec(rest);
  if (!closing) return null;
  const suffixStart = closing.index + closing[1].length;
  const innerSource = rest.slice(0, suffixStart);
  // 코드 예제도 이 단계에서는 보수적으로 전체 원문으로 남긴다.
  if (/<\s*\/?\s*[a-z!][^>]*>/i.test(innerSource)) return null;
  return {
    beforeTitle: raw.slice(0, titleStart), titleRaw, title: decodeTitle(titleRaw),
    afterTitle: raw.slice(titleEnd, opening[0].length), innerSource,
    suffix: rest.slice(suffixStart),
  };
}

/** 제목 입력이 summary/details 경계나 다른 HTML 태그를 만들지 못하게 이스케이프한다. */
export function escapeToggleTitle(title: string): string {
  return title.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;").replace(/[\r\n]+/g, " ");
}
