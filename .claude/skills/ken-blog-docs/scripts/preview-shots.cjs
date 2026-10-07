// 글 하나를 라이트·다크로 열어 전체 화면과 도식별 화면을 저장하고 도식 표시 크기를 출력함
// 사용: node preview-shots.cjs <slug> <저장 디렉터리> [기준 URL=http://127.0.0.1:8765/ken-blog]
// 공개 사이트 확인은 기준 URL에 https://gjaku1031.github.io/ken-blog 를 줌
const path = require("node:path");
const { chromium } = require(require.resolve("playwright", { paths: [process.cwd(), path.join(__dirname, "../../../..")] }));
const [slug, outDir, base = "http://127.0.0.1:8765/ken-blog"] = process.argv.slice(2);
if (!slug || !outDir) { console.error("사용: node preview-shots.cjs <slug> <저장 디렉터리> [기준 URL]"); process.exit(64); }
(async () => {
  const browser = await chromium.launch({ ignoreDefaultArgs: ["--hide-scrollbars"] });
  for (const theme of ["light", "dark"]) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addInitScript(t => localStorage.setItem("ken-blog-theme", t), theme);
    const page = await ctx.newPage();
    const errors = []; page.on("pageerror", e => errors.push(e.message));
    await page.goto(`${base}/post/${slug}/`, { waitUntil: "networkidle" });
    // 도식은 화면에 들어올 때 그려지므로 끝까지 스크롤함
    for (let y = 0; y < 40000; y += 600) { await page.evaluate(v => window.scrollTo(0, v), y); await page.waitForTimeout(200); }
    await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(800);
    const sizes = await page.evaluate(() => [...document.querySelectorAll(".mermaid-diagram")].map(d => {
      const img = d.querySelector("img"); if (!img) return "미렌더링";
      const r = img.getBoundingClientRect(); return `${Math.round(r.width)}x${Math.round(r.height)} (원래 폭 ${img.naturalWidth})`;
    }));
    const body = await page.evaluate(() => Math.round(document.querySelector(".markdown-body")?.getBoundingClientRect().width ?? 0));
    console.log(`[${theme}] 본문 폭 ${body}px, 도식 ${JSON.stringify(sizes)}${errors.length ? " 오류: " + errors.join(" | ") : ""}`);
    await page.screenshot({ path: path.join(outDir, `${slug.slice(0, 12)}-${theme}.png`), fullPage: true });
    const diagrams = await page.$$(".ken-mermaid");
    for (const [i, el] of diagrams.entries()) {
      await el.scrollIntoViewIfNeeded(); await page.waitForTimeout(200);
      await el.screenshot({ path: path.join(outDir, `${slug.slice(0, 12)}-${theme}-d${i}.png`) });
    }
    await ctx.close();
  }
  await browser.close();
})();
