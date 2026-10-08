// 원고의 Mermaid 블록을 블로그 렌더러의 안전성 검사(mermaidSourceError)로 확인함
// 실행용: node .claude/skills/ken-blog-diagrams/scripts/check-mermaid.mts <원고.md>...
// 출력: "<파일> <블록 번호> ok|<오류>" 한 줄씩. 종료 코드: 0 전부 ok, 1 오류 블록 있음, 64 인자 없음, 66 파일을 읽을 수 없음
import { readFileSync } from "node:fs";
import { mermaidSourceError } from "../../../../src/main/resources/web/shared/mermaid-render.ts";

const files = process.argv.slice(2);
if (!files.length) { console.error("사용: node check-mermaid.mts <원고.md>..."); process.exit(64); }
let failed = 0;
for (const f of files) {
  let md: string;
  try { md = readFileSync(f, "utf8"); }
  catch (e) { console.error(`읽을 수 없음: ${f} (${(e as Error).message})`); process.exit(66); }
  // 펜스 첫 줄의 caption= 같은 정보 문자열은 건너뛰고 블록 본문만 검사
  const re = /```mermaid[^\n]*\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null, i = 0;
  while ((m = re.exec(md))) {
    i++;
    const error = mermaidSourceError(m[1]);
    if (error) failed++;
    console.log(f.split("/").pop(), i, error ?? "ok");
  }
  if (i === 0) console.log(f.split("/").pop(), "mermaid 블록 없음");
}
process.exit(failed ? 1 : 0);
