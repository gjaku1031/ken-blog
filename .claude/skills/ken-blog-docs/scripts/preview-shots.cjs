// 글 하나를 라이트·다크로 열어 전체 화면과 도식별 화면을 저장하고 도식 표시 크기를 출력함
// 실행용: node preview-shots.cjs <slug> <저장 디렉터리> [기준 URL=http://127.0.0.1:8765/ken-blog]
// 공개 사이트 확인은 기준 URL에 https://gjaku1031.github.io/ken-blog 를 줌. 저장 디렉터리는 없으면 만듦
// 종료 코드: 64 인자 오류, 1 페이지 열기 실패(preview.sh를 먼저 실행했는지, slug가 맞는지 확인)
const path = require("node:path");
const { mkdirSync } = require("node:fs");
// 저장소의 Playwright를 쓴다. 작업 디렉터리가 저장소가 아니어도 스킬 위치(저장소 루트의 4단계 아래)에서 찾음
const { chromium } = require(require.resolve("playwright", { paths: [process.cwd(), path.join(__dirname, "../../../..")] }));

// 1440×900: 본문 폭(약 800px)이 데스크톱 기준으로 계산되는 크기. 캡처는 전체 페이지
const VIEWPORT = { width: 1440, height: 900 };
// 도식은 화면에 들어올 때 그려지므로 한 화면 조금 넘는 간격으로 내려가며 잠시 기다림
const SCROLL_STEP = 600, SCROLL_WAIT_MS = 200;
// 긴 글도 끝까지 내려가되 무한 루프를 막는 상한(px)
const SCROLL_LIMIT = 40000;
// 맨 위로 돌아온 뒤 마지막 도식까지 그려지길 기다리는 시간
const SETTLE_MS = 800;
// preview.sh가 띄우는 로컬 서버 주소(포트 8765는 preview.sh와 맞춤)
const DEFAULT_BASE = "http://127.0.0.1:8765/ken-blog";

const [slug, outDir, base = DEFAULT_BASE] = process.argv.slice(2);
if (!slug || !outDir) { console.error("사용: node preview-shots.cjs <slug> <저장 디렉터리> [기준 URL]"); process.exit(64); }
mkdirSync(outDir, { recursive: true });

(async () => {
  // 실제 화면처럼 스크롤바를 포함해 본문 폭을 잼
  const browser = await chromium.launch({ ignoreDefaultArgs: ["--hide-scrollbars"] });
  try {
    for (const theme of ["light", "dark"]) {
      const ctx = await browser.newContext({ viewport: VIEWPORT });
      await ctx.addInitScript(t => localStorage.setItem("ken-blog-theme", t), theme);
      const page = await ctx.newPage();
      const errors = []; page.on("pageerror", e => errors.push(e.message));
      const url = `${base}/post/${slug}/`;
      let response;
      try { response = await page.goto(url, { waitUntil: "networkidle" }); }
      catch (e) { console.error(`페이지를 열 수 없음: ${url} (${e.message})`); process.exit(1); }
      if (!response || !response.ok()) { console.error(`페이지 응답 오류: ${url} (${response ? response.status() : "응답 없음"})`); process.exit(1); }
      // 문서 끝까지만 내려가고, 끝을 알 수 없을 때를 대비해 상한을 둠
      for (let y = 0; y < SCROLL_LIMIT; y += SCROLL_STEP) {
        await page.evaluate(v => window.scrollTo(0, v), y);
        await page.waitForTimeout(SCROLL_WAIT_MS);
        if (y >= await page.evaluate(() => document.documentElement.scrollHeight)) break;
      }
      await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(SETTLE_MS);
      const sizes = await page.evaluate(() => [...document.querySelectorAll(".mermaid-diagram")].map(d => {
        const img = d.querySelector("img"); if (!img) return "미렌더링";
        const r = img.getBoundingClientRect(); return `${Math.round(r.width)}x${Math.round(r.height)} (원래 폭 ${img.naturalWidth})`;
      }));
      const body = await page.evaluate(() => Math.round(document.querySelector(".markdown-body")?.getBoundingClientRect().width ?? 0));
      console.log(`[${theme}] 본문 폭 ${body}px, 도식 ${JSON.stringify(sizes)}${errors.length ? " 오류: " + errors.join(" | ") : ""}`);
      await page.screenshot({ path: path.join(outDir, `${slug.slice(0, 12)}-${theme}.png`), fullPage: true });
      const diagrams = await page.$$(".ken-mermaid");
      for (const [i, el] of diagrams.entries()) {
        await el.scrollIntoViewIfNeeded(); await page.waitForTimeout(SCROLL_WAIT_MS);
        await el.screenshot({ path: path.join(outDir, `${slug.slice(0, 12)}-${theme}-d${i}.png`) });
      }
      await ctx.close();
    }
  } finally { await browser.close(); }
})();
