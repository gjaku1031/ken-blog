// 스크린샷을 데스크톱 창(브라우저·앱)과 휴대폰 프레임에 넣은 목업 이미지를 만듦
// 실행용: node device-mockup.cjs <출력.png> --desktop <이미지> [--title <창 제목>] [--window browser|app]
//         [--phone <이미지> [--phone-offset <0~1>]] [--backdrop dark|light]
// --phone-offset: 휴대폰 화면에 보일 세로 시작 위치(이미지 높이 대비 비율). 긴 세로 캡처에서 원하는 부분을 보여 줄 때 씀
// 결과: 1600×1000 PNG(데스크톱만이면 같은 크기). 종료 코드: 64 인자 오류, 1 렌더링 실패
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require(require.resolve("playwright", { paths: [process.cwd(), path.join(__dirname, "../../../..")] }));

// 블로그 본문 폭(약 800px)의 2배라 글자가 흐려지지 않는 크기
const WIDTH = 1600, HEIGHT = 1000;

const args = process.argv.slice(2);
const out = args.shift();
const opt = {};
for (let i = 0; i < args.length; i += 2) opt[args[i].replace(/^--/, "")] = args[i + 1];
if (!out || !opt.desktop) {
  console.error("사용: node device-mockup.cjs <출력.png> --desktop <이미지> [--title 제목] [--window browser|app] [--phone 이미지 [--phone-offset 0~1]] [--backdrop dark|light]");
  process.exit(64);
}
const dataUri = (file) => `data:image/png;base64,${fs.readFileSync(file).toString("base64")}`;
const hasPhone = Boolean(opt.phone);
const isApp = opt.window === "app";
const light = opt.backdrop === "light";
const title = (opt.title || "").replace(/[<>&]/g, "");

// 휴대폰이 있으면 창을 왼쪽으로 줄이고 휴대폰을 오른쪽 아래에 겹침(npr 대문 목업과 같은 배치)
const win = hasPhone ? { x: 60, y: 70, w: 1250, h: 840 } : { x: 80, y: 60, w: 1440, h: 880 };
const phone = { x: 1150, y: 190, w: 370, h: 770 };

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
* { box-sizing: border-box; margin: 0; }
body { width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden; font-family: "Noto Sans KR", "Apple SD Gothic Neo", sans-serif;
  background: ${light ? "radial-gradient(circle at 40% 35%, #f4f5f2, #dfe2dc)" : "radial-gradient(circle at 40% 35%, #2a2d2b, #121413)"}; }
.win { position: absolute; left: ${win.x}px; top: ${win.y}px; width: ${win.w}px; height: ${win.h}px; border-radius: 16px; overflow: hidden;
  background: #fff; border: 1px solid ${light ? "#c9ccc7" : "#3d4143"}; box-shadow: 0 30px 70px rgba(0,0,0,${light ? 0.25 : 0.55}); }
.bar { height: 48px; background: ${isApp ? "#ecedee" : "#26292a"}; display: flex; align-items: center; padding: 0 18px; position: relative; }
.dot { width: 13px; height: 13px; border-radius: 50%; margin-right: 9px; }
.title { position: absolute; left: 50%; transform: translateX(-50%); font-size: 14px; color: ${isApp ? "#444" : "#c9cdcf"};
  ${isApp ? "" : "background: #3a3e3f; padding: 6px 140px; border-radius: 16px;"} white-space: nowrap; }
.win img { display: block; width: 100%; height: ${win.h - 48}px; object-fit: cover; object-position: top; }
.phone { position: absolute; left: ${phone.x}px; top: ${phone.y}px; width: ${phone.w}px; height: ${phone.h}px; border-radius: 58px;
  background: #0b0c0c; border: 3px solid #4a4f52; padding: 13px; box-shadow: 0 30px 70px rgba(0,0,0,0.6); }
.screen { width: 100%; height: 100%; border-radius: 45px; overflow: hidden; position: relative; background: #000; }
.status { position: absolute; top: 0; left: 0; right: 0; height: 52px; display: flex; align-items: center; justify-content: space-between;
  padding: 6px 30px 0 40px; font-weight: 700; font-size: 16px; z-index: 2; }
.island { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); width: 108px; height: 30px; border-radius: 15px; background: #000; z-index: 3; }
.phone img { position: absolute; top: 52px; left: 0; width: 100%; height: calc(100% - 52px); object-fit: cover; object-position: 50% ${Math.round(Number(opt["phone-offset"] || 0) * 100)}%; }
</style></head><body>
<div class="win"><div class="bar"><span class="dot" style="background:#ff5f57"></span><span class="dot" style="background:#febc2e"></span><span class="dot" style="background:#28c840"></span><span class="title">${title}</span></div><img src="${dataUri(opt.desktop)}"></div>
${hasPhone ? `<div class="phone"><div class="screen"><div class="status" id="status"><span>9:41</span><svg width="62" height="14" viewBox="0 0 62 14" fill="currentColor"><rect x="0" y="9" width="4" height="5" rx="1"/><rect x="6" y="6" width="4" height="8" rx="1"/><rect x="12" y="3" width="4" height="11" rx="1"/><rect x="18" y="0" width="4" height="14" rx="1"/><rect x="31" y="1" width="26" height="12" rx="3.5" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="33.5" y="3.5" width="21" height="7" rx="1.8"/><rect x="58.5" y="5" width="2" height="4" rx="1"/></svg></div><div class="island"></div><img id="pimg" src="${dataUri(opt.phone)}"></div></div>` : ""}
<script>
// 상태 표시줄 배경을 휴대폰 화면 맨 위 픽셀 색에 맞춰 화면과 이어 보이게 함
const p = document.getElementById("pimg");
if (p) p.decode().then(() => {
  const c = document.createElement("canvas"); c.width = 1; c.height = 1;
  const g = c.getContext("2d"); g.drawImage(p, 0, 0, 1, 1, 0, 0, 1, 1);
  const [r, gr, b] = g.getImageData(0, 0, 1, 1).data;
  const s = document.getElementById("status");
  s.style.background = "rgb(" + r + "," + gr + "," + b + ")";
  s.style.color = (r * 0.299 + gr * 0.587 + b * 0.114) > 140 ? "#111" : "#f5f5f5";
  document.body.dataset.ready = "1";
}); else document.body.dataset.ready = "1";
</script></body></html>`;

(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
    await page.setContent(html);
    await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 15000 });
    await page.screenshot({ path: out });
    console.log(out);
  } catch (error) {
    console.error(`렌더링 실패: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
