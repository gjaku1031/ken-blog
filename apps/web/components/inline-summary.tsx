import { MathExpression } from "./math-expression";

/** {@link MathExpression}으로 피드 요약의 인라인 수식만 해석하고 나머지는 텍스트로 표시한다. */
export function InlineSummary({ text }: { text: string }) {
  const parts: Array<{ value: string; math: boolean }> = [];
  const pattern = /\$([^$\n]+)\$|\\\(([^\n]+?)\\\)/g;
  let start = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > start) parts.push({ value: text.slice(start, index), math: false });
    parts.push({ value: match[1] ?? match[2], math: true });
    start = index + match[0].length;
  }
  if (start < text.length) parts.push({ value: text.slice(start), math: false });
  return <>{parts.map((part, index) => part.math ? <MathExpression key={index} source={part.value} display={false} /> :
    <span key={index}>{part.value}</span>)}</>;
}
