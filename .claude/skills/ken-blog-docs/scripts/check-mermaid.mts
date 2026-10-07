// 원고의 Mermaid 블록을 블로그 렌더러의 안전성 검사(mermaidSourceError)로 확인함
// 사용: node .claude/skills/ken-blog-docs/scripts/check-mermaid.mts <원고.md>...
import { readFileSync } from "node:fs";
import { mermaidSourceError } from "../../../../src/main/resources/web/shared/mermaid-render.ts";
for (const f of process.argv.slice(2)) {
  const md = readFileSync(f, "utf8");
  const re = /```mermaid[^\n]*\n([\s\S]*?)```/g; let m, i = 0;
  while ((m = re.exec(md))) { i++; console.log(f.split("/").pop(), i, mermaidSourceError(m[1]) ?? "ok"); }
}
