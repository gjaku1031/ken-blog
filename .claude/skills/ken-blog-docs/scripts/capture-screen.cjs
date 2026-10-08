// 본문용 스크린샷을 밝은·어두운 테마로 한 장씩 저장함
// 실행용: node capture-screen.cjs <URL> <저장 경로 접두어> [CSS 선택자] [폭=1440] [높이=900]
// 결과: <접두어>-light.png, <접두어>-dark.png. 선택자를 주면 그 요소만, 비우면("") 화면 크기만큼 캡처
// 종료 코드: 64 인자 오류, 65 선택자에 맞는 요소가 제한 시간 안에 없음, 1 페이지 열기 실패
const path = require("node:path");
// 저장소의 Playwright를 쓴다. 작업 디렉터리가 저장소가 아니어도 스킬 위치(저장소 루트의 4단계 아래)에서 찾음
const { chromium } = require(require.resolve("playwright", { paths: [process.cwd(), path.join(__dirname, "../../../..")] }));

// 1440×900: 블로그 본문(약 800px)과 좌우 여백이 모두 들어오는 데스크톱 크기
const DEFAULT_WIDTH = 1440, DEFAULT_HEIGHT = 900;
// 2배 해상도: 블로그가 캡처를 본문 폭으로 줄여 보여 주므로 글자가 흐려지지 않게 함
const DEVICE_SCALE = 2;
// 도식은 화면에 들어올 때 그려지므로 한 화면 조금 넘는 간격으로 끝까지 내려가며 잠시 기다림(상한은 무한 루프 방지)
const SCROLL_STEP = 600, SCROLL_WAIT_MS = 200, SCROLL_LIMIT = 40000;
// 맨 위로 돌아온 뒤 글꼴과 마지막 도식까지 그려지길 기다리는 시간
const SETTLE_MS = 800;
// 첫 로드에서 Mermaid 초기화가 느려도 선택자 요소가 나타나길 기다리는 상한. 잘못된 선택자는 이 시간 뒤 65로 끝냄
const SELECTOR_WAIT_MS = 15000;

const [url, prefix, selector, width = String(DEFAULT_WIDTH), height = String(DEFAULT_HEIGHT)] = process.argv.slice(2);
if (!url || !prefix || !(Number(width) > 0) || !(Number(height) > 0)) {
  console.error("사용: node capture-screen.cjs <URL> <저장 경로 접두어> [CSS 선택자] [폭] [높이]");
  process.exit(64);
}

(async () => {
  const browser = await chromium.launch();
  try {
    for (const theme of ["light", "dark"]) {
      const ctx = await browser.newContext({ viewport: { width: Number(width), height: Number(height) }, deviceScaleFactor: DEVICE_SCALE, colorScheme: theme });
      // 블로그는 localStorage의 테마 값을 우선하므로 OS 설정(colorScheme)과 함께 맞춤
      await ctx.addInitScript(t => localStorage.setItem("ken-blog-theme", t), theme);
      const page = await ctx.newPage();
      let response;
      try { response = await page.goto(url, { waitUntil: "networkidle" }); }
      catch (e) { console.error(`페이지를 열 수 없음: ${url} (${e.message})`); process.exit(1); }
      if (!response || !response.ok()) { console.error(`페이지 응답 오류: ${url} (${response ? response.status() : "응답 없음"})`); process.exit(1); }
      // 아래쪽 도식도 그려지도록 끝까지 한 번 내려갔다가 맨 위로 돌아옴
      for (let y = 0; y < SCROLL_LIMIT; y += SCROLL_STEP) {
        await page.evaluate(v => window.scrollTo(0, v), y);
        await page.waitForTimeout(SCROLL_WAIT_MS);
        if (y >= await page.evaluate(() => document.documentElement.scrollHeight)) break;
      }
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(SETTLE_MS);
      const out = `${prefix}-${theme}.png`;
      if (selector) {
        const target = page.locator(selector).first();
        try { await target.waitFor({ state: "visible", timeout: SELECTOR_WAIT_MS }); }
        catch { console.error(`선택자에 맞는 요소가 ${SELECTOR_WAIT_MS / 1000}초 안에 보이지 않음: ${selector}`); process.exit(65); }
        await target.screenshot({ path: out });
      } else await page.screenshot({ path: out });
      console.log(out);
      await ctx.close();
    }
  } finally { await browser.close(); }
})();
