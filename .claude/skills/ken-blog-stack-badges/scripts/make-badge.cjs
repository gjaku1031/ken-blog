// SVG 로고를 기술 배지 규격(64×64 RGBA PNG, 투명 배경, 비율 유지)으로 변환함
// 실행용: node make-badge.cjs <입력.svg> <출력.png> [여백px=4] [색=#RRGGBB]
// 단색 SVG(예: simple-icons)는 색을 지정해야 다크 테마에서도 보임
// 저장소의 Playwright Chromium으로 렌더링하므로 별도 이미지 도구가 필요 없음
// 종료 코드: 64 인자 오류, 65 입력이 SVG가 아니거나 스크립트·외부 참조 포함, 70 결과 PNG가 규격과 다름
const { readFileSync, writeFileSync } = require("node:fs");
// 저장소의 Playwright를 쓴다. 작업 디렉터리가 저장소가 아니어도 스킬 위치(저장소 루트의 4단계 아래)에서 찾음
const { chromium } = require(require.resolve("playwright", { paths: [process.cwd(), __dirname + "/../../../.."] }));

// 64: 프로젝트 헤더·관리 화면이 쓰는 배지 규격(docs/ADR/ADR_infra.md '기술 이름·아이콘의 직접 관리')
const SIZE = 64;
// 4: 기존 배지와 같은 사방 여백. 로고가 타일 가장자리에 붙지 않게 함
const DEFAULT_PADDING = 4;

const [input, output, paddingArg, fillArg] = process.argv.slice(2);
if (!input || !output) { console.error("사용: node make-badge.cjs <입력.svg> <출력.png> [여백px] [색=#RRGGBB]"); process.exit(64); }
const padding = Number(paddingArg ?? DEFAULT_PADDING);
if (!(padding >= 0 && padding < SIZE / 2)) { console.error(`여백은 0 이상 ${SIZE / 2} 미만의 px`); process.exit(64); }
let svg;
try { svg = readFileSync(input, "utf8"); }
catch (e) { console.error(`입력을 읽을 수 없음: ${input} (${e.message})`); process.exit(65); }
if (fillArg) {
  if (!/^#[0-9a-fA-F]{6}$/.test(fillArg)) { console.error("색은 #RRGGBB 형식"); process.exit(64); }
  svg = svg.replace(/<svg\b/i, `<svg fill="${fillArg}"`);
}
// 내려받은 SVG는 신뢰하지 않는 자료이므로 스크립트·외부 참조가 있으면 렌더링하지 않음
if (!/<svg[\s>]/i.test(svg) || /<script|<foreignObject|xlink:href\s*=\s*["']https?:/i.test(svg)) {
  console.error("SVG가 아니거나 스크립트·외부 참조가 있음"); process.exit(65);
}
const html = `<!doctype html><html><body style="margin:0;background:transparent">
<div id="box" style="width:${SIZE}px;height:${SIZE}px;display:flex;align-items:center;justify-content:center">
<img id="logo" style="max-width:${SIZE - padding * 2}px;max-height:${SIZE - padding * 2}px;width:100%;height:100%;object-fit:contain"
 src="data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}"></div></body></html>`;

(async () => {
  const browser = await chromium.launch();
  let png;
  try {
    const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE }, deviceScaleFactor: 1 });
    await page.setContent(html);
    await page.waitForFunction(() => document.getElementById("logo").complete);
    png = await page.locator("#box").screenshot({ omitBackground: true });
  } finally { await browser.close(); }
  // PNG IHDR 확인: 64×64, 8bit RGBA(색 형식 6). 다른 값이면 투명 배경이나 크기가 깨진 것
  const width = png.readUInt32BE(16), height = png.readUInt32BE(20), depth = png[24], color = png[25];
  if (width !== SIZE || height !== SIZE || depth !== 8 || color !== 6) {
    console.error(`규격 불일치: ${width}x${height} depth=${depth} color=${color}`); process.exit(70);
  }
  writeFileSync(output, png);
  console.log(`${output}: ${width}x${height} RGBA, ${png.length} bytes`);
})();
