// 실험 그림 HTML을 밝은·어두운 테마 PNG로 구움
// 실행용: node render-figure.cjs <그림.html> <저장 경로 접두어> [데이터.json]
// 그림 HTML은 #figure 요소 안에 그리고, 데이터가 필요하면 window.FIGURE_DATA를 읽는다(파일 URL에서는 fetch가 막혀 주입함)
// 결과: <접두어>-light.png, <접두어>-dark.png(2배 해상도). 종료 코드: 64 인자 오류, 1 렌더링 실패
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require(require.resolve("playwright", { paths: [process.cwd(), path.join(__dirname, "../../../..")] }));

// 블로그 본문 폭(약 800px)에 줄여 보여도 글자가 흐려지지 않게 2배로 찍음
const DEVICE_SCALE = 2;

const [html, prefix, dataFile] = process.argv.slice(2);
if (!html || !prefix) {
  console.error("사용: node render-figure.cjs <그림.html> <저장 경로 접두어> [데이터.json]");
  process.exit(64);
}
const data = dataFile ? fs.readFileSync(dataFile, "utf8") : "null";

(async () => {
  const browser = await chromium.launch();
  try {
    for (const theme of ["light", "dark"]) {
      const page = await browser.newPage({ viewport: { width: 1300, height: 900 }, deviceScaleFactor: DEVICE_SCALE, colorScheme: theme });
      await page.addInitScript(`window.FIGURE_DATA = ${data};`);
      await page.goto("file://" + path.resolve(html));
      await page.evaluate(() => document.fonts.ready);
      await page.locator("#figure").screenshot({ path: `${prefix}-${theme}.png` });
      console.log(`${prefix}-${theme}.png`);
      await page.close();
    }
  } catch (error) {
    console.error(`렌더링 실패: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
