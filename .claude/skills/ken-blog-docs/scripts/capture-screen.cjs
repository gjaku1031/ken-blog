// 본문용 스크린샷을 밝은·어두운 테마로 한 장씩 저장함
// 사용: node capture-screen.cjs <URL> <저장 경로 접두어> [CSS 선택자] [폭=1440] [높이=900]
// 결과: <접두어>-light.png, <접두어>-dark.png. 선택자를 주면 그 요소만, 없으면 화면 크기만큼 캡처
const path = require("node:path");
const { chromium } = require(require.resolve("playwright", { paths: [process.cwd(), path.join(__dirname, "../../../..")] }));
const [url, prefix, selector, width = "1440", height = "900"] = process.argv.slice(2);
if (!url || !prefix) { console.error("사용: node capture-screen.cjs <URL> <저장 경로 접두어> [CSS 선택자] [폭] [높이]"); process.exit(64); }
(async () => {
  const browser = await chromium.launch();
  for (const theme of ["light", "dark"]) {
    const ctx = await browser.newContext({ viewport: { width: Number(width), height: Number(height) }, deviceScaleFactor: 2, colorScheme: theme });
    await ctx.addInitScript(t => localStorage.setItem("ken-blog-theme", t), theme);
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    const out = `${prefix}-${theme}.png`;
    if (selector) await page.locator(selector).first().screenshot({ path: out });
    else await page.screenshot({ path: out });
    console.log(out);
    await ctx.close();
  }
  await browser.close();
})();
