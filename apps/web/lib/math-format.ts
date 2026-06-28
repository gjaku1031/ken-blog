const MAX_FORMULA_LENGTH = 4096;
const MAX_FORMULA_LINES = 100;

const greek: Record<string, string> = {
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", theta: "θ", lambda: "λ", mu: "μ", pi: "π",
  rho: "ρ", sigma: "σ", tau: "τ", phi: "φ", omega: "ω", Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ",
  Pi: "Π", Sigma: "Σ", Phi: "Φ", Omega: "Ω", infty: "∞", times: "×", cdot: "·", pm: "±", leq: "≤", geq: "≥",
};

const superscript: Record<string, string> = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "+": "⁺", "-": "⁻" };
const subscript: Record<string, string> = { "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉", "+": "₊", "-": "₋" };

/** 수식 렌더 비용 상한을 글자와 실제 줄 수로 검사한다. */
export function isOversizeMath(source: string): boolean {
  const lines = source.split(/\r\n|\r|\n/);
  return source.length > MAX_FORMULA_LENGTH || lines.length - (lines.at(-1) === "" ? 1 : 0) > MAX_FORMULA_LINES;
}

/** 단순 숫자 상하 첨자만 Unicode 문자로 치환하고 다른 표현은 명시적으로 남긴다. */
function script(value: string, characters: Record<string, string>, marker: string): string {
  return [...value].every((character) => character in characters) ? [...value].map((character) => characters[character]).join("") : `${marker}(${value})`;
}

/** KaTeX를 읽는 동안 대표적인 기호·분수·루트·행렬만 텍스트로 풀고 미지원 원문은 보존한다. */
export function readableMathFallback(source: string): string {
  if (isOversizeMath(source)) return source;
  let text = source.replace(/(^|[^\\])\\begin\{(matrix|pmatrix|bmatrix)\}([\s\S]*?)\\end\{\2\}/g, (_whole, prefix: string, _kind: string, content: string) => {
    const rows = content.split(/\\\\/).map((row) => row.split("&").map((cell) => cell.trim()).join(", "));
    return `${prefix}[${rows.join("; ")}]`;
  });
  for (let depth = 0; depth < 6; depth++) {
    const next = text.replace(/(^|[^\\])\\frac\{([^{}]*)\}\{([^{}]*)\}/g, (_whole, prefix: string, numerator: string, denominator: string) =>
      `${prefix}(${numerator})/(${denominator})`).replace(/(^|[^\\])\\sqrt\{([^{}]*)\}/g, (_whole, prefix: string, inside: string) => `${prefix}√(${inside})`);
    if (next === text) break;
    text = next;
  }
  text = text.replace(/(^|[^\\])\\([A-Za-z]+)/g, (whole, prefix: string, name: string) =>
    Object.hasOwn(greek, name) ? `${prefix}${greek[name]}` : whole);
  text = text.replace(/\^\{([0-9+-]+)\}|\^([0-9+-])/g, (_whole, grouped: string | undefined, single: string | undefined) =>
    script(grouped ?? single ?? "", superscript, "^") );
  text = text.replace(/_\{([0-9+-]+)\}|_([0-9+-])/g, (_whole, grouped: string | undefined, single: string | undefined) =>
    script(grouped ?? single ?? "", subscript, "_") );
  return text;
}
