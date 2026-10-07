// SVG 로고를 기술 뱃지 규격(64×64 RGBA PNG, 투명 배경, 비율 유지)으로 변환함
// 사용: node make-badge.cjs <입력.svg> <출력.png> [여백px=4] [색=#RRGGBB]
// 단색 SVG(예: simple-icons)는 색을 지정해야 다크 테마에서도 보임
// 저장소의 Playwright Chromium으로 렌더링하므로 별도 이미지 도구가 필요 없음
const { readFileSync, writeFileSync } = require("node:fs");
const { chromium } = require(require.resolve("playwright", { paths: [process.cwd(), __dirname + "/../../../.."] }));

const [input, output, paddingArg, fillArg] = process.argv.slice(2);
if (!input || !output) { console.error("사용: node make-badge.cjs <입력.svg> <출력.png> [여백px]"); process.exit(64); }
const SIZE = 64;
const padding = Number(paddingArg ?? 4);
let svg = readFileSync(input, "utf8");
if (fillArg) {
  if (!/^#[0-9a-fA-F]{6}$/.test(fillArg)) { console.error("색은 #RRGGBB 형식"); process.exit(64); }
  svg = svg.replace(/<svg\b/i, `<svg fill="${fillArg}"`);
}
if (!/<svg[\s>]/i.test(svg) || /<script|<foreignObject|xlink:href\s*=\s*["']https?:/i.test(svg)) {
  console.error("SVG가 아니거나 스크립트·외부 참조가 있음"); process.exit(65);
}
const html = `<!doctype html><html><body style="margin:0;background:transparent">
<div id="box" style="width:${SIZE}px;height:${SIZE}px;display:flex;align-items:center;justify-content:center">
<img id="logo" style="max-width:${SIZE - padding * 2}px;max-height:${SIZE - padding * 2}px;width:100%;height:100%;object-fit:contain"
 src="data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}"></div></body></html>`;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE }, deviceScaleFactor: 1 });
  await page.setContent(html);
  await page.waitForFunction(() => document.getElementById("logo").complete);
  const png = await page.locator("#box").screenshot({ omitBackground: true });
  await browser.close();
  // IHDR 확인: 64×64, 8bit RGBA(색 형식 6)
  const width = png.readUInt32BE(16), height = png.readUInt32BE(20), depth = png[24], color = png[25];
  if (width !== SIZE || height !== SIZE || depth !== 8 || color !== 6) {
    console.error(`규격 불일치: ${width}x${height} depth=${depth} color=${color}`); process.exit(70);
  }
  writeFileSync(output, png);
  console.log(`${output}: ${width}x${height} RGBA, ${png.length} bytes`);
})();
