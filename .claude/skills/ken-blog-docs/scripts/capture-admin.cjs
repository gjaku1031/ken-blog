// 배포된 관리 화면의 글 정보 편집 창을 밝은·어두운 테마로 한 장씩 저장함
// 로그인 없이 찍도록 API 응답만 공개 스냅샷에서 만든 관리자 응답으로 바꿈. 쓰기 요청은 보내지 않음
// 실행용: node capture-admin.cjs <저장 경로 접두어> <편집할 글 제목> [관리 화면 주소]
// 결과: <접두어>-light.png, <접두어>-dark.png (1920×1100, 2배 해상도)
// 종료 코드: 64 인자 오류, 66 제목에 맞는 글이 목록에 없음, 1 페이지·스냅샷 불러오기 실패
const path = require("node:path");
// 저장소의 Playwright를 쓴다. 작업 디렉터리가 저장소가 아니어도 스킬 위치(저장소 루트의 4단계 아래)에서 찾음
const { chromium } = require(require.resolve("playwright", { paths: [process.cwd(), path.join(__dirname, "../../../..")] }));

// 1920×1100: 글 목록 위에 뜨는 편집 창이 잘리지 않고 한 화면에 들어오는 크기
const VIEWPORT = { width: 1920, height: 1100 };
// 2배 해상도: 캡처를 본문 폭으로 줄여 보여도 글자가 흐려지지 않게 함
const DEVICE_SCALE = 2;
// 편집 창이 열린 뒤 입력값·기술 배지가 채워질 때까지 기다리는 시간
const SETTLE_MS = 800;
// 제목을 찾기 위해 넘겨 볼 목록 페이지 수. 현재 글 수에 넉넉하며, 넘으면 오류로 끝냄
const MAX_LIST_PAGES = 5;
const DEFAULT_SITE = "https://gjaku1031.github.io/ken-blog/manage/";

const [prefix, title, site = DEFAULT_SITE] = process.argv.slice(2);
if (!prefix || !title) { console.error("사용: node capture-admin.cjs <저장 경로 접두어> <편집할 글 제목> [관리 화면 주소]"); process.exit(64); }

/**
 * 공개 스냅샷을 관리 화면이 읽는 응답 모양으로 바꿈
 */
function adminData(snapshot) {
  const posts = snapshot.posts.map(post => ({
    ...post, status: "PUBLISHED", editVersion: 1, updatedAt: post.publishedAt, attachmentIds: [],
    series: post.series ? { id: post.series.id, slug: post.series.slug, name: post.series.name, kind: post.series.kind } : null,
    seriesOrder: post.series ? post.series.position : null, relatedSeriesId: post.relatedSeries?.id ?? null,
  }));
  const categories = snapshot.categories.filter(c => c.depth === 1).map(c => ({ ...c, directCount: 0,
    children: snapshot.categories.filter(k => k.path.startsWith(c.path + "/")).map(k => ({ ...k, directCount: 1, children: [] })) }));
  const series = snapshot.series.map(s => ({ ...s, updatedAt: s.updatedAt ?? "2026-01-01T00:00:00" }));
  return { posts, categories, series };
}

(async () => {
  const browser = await chromium.launch();
  try {
    let data;
    for (const theme of ["light", "dark"]) {
      const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: DEVICE_SCALE, colorScheme: theme });
      await ctx.addInitScript(t => localStorage.setItem("ken-blog-theme", t), theme);
      const page = await ctx.newPage();
      await page.route("**/api/v1/**", async route => {
        const url = new URL(route.request().url());
        const p = url.pathname.replace("/api/v1", "");
        // 공개 경로는 실제 API로 보냄
        if (p === "/pages/snapshot" || p.startsWith("/stack-badges/")) return route.continue();
        if (!data) {
          const res = await page.request.get(new URL("/api/v1/pages/snapshot", url).toString());
          if (!res.ok()) { console.error(`공개 스냅샷을 받지 못함: ${res.status()}`); process.exit(1); }
          data = adminData(await res.json());
        }
        let json;
        if (p === "/auth/me") json = { username: "admin", role: "ADMIN" };
        else if (p === "/auth/csrf") json = { headerName: "X-CSRF-TOKEN", token: "capture" };
        else if (p === "/admin/posts/snapshot") json = data.posts;
        else if (/^\/admin\/posts\/\d+$/.test(p)) json = data.posts.find(post => post.id === Number(p.split("/").at(-1)));
        else if (p === "/admin/categories") json = data.categories;
        else if (p === "/admin/tags") json = [...new Set(data.posts.flatMap(post => post.tags))].map(name => ({ name, count: 1 }));
        else if (p === "/admin/series") json = data.series;
        else if (p === "/admin/stack-badges") json = [];
        else if (p === "/admin/pages/deployments/latest") return route.fulfill({ status: 204 });
        else return route.fulfill({ status: 404, json: { detail: `capture: ${p}` } });
        return route.fulfill({ json });
      });
      let response;
      try { response = await page.goto(site, { waitUntil: "networkidle" }); }
      catch (e) { console.error(`관리 화면을 열 수 없음: ${site} (${e.message})`); process.exit(1); }
      if (!response || !response.ok()) { console.error(`관리 화면 응답 오류: ${site} (${response ? response.status() : "응답 없음"})`); process.exit(1); }
      // 목록 페이지를 넘기며 제목이 있는 행을 찾음
      const row = page.locator("tr", { hasText: title });
      for (let i = 0; i < MAX_LIST_PAGES && !(await row.count()); i++)
        await page.getByRole("button", { name: /다음/ }).first().click().catch(() => {});
      if (!(await row.count())) { console.error(`목록 ${MAX_LIST_PAGES}쪽 안에 제목이 없음: ${title}`); process.exit(66); }
      await row.first().getByRole("button", { name: "수정", exact: true }).click();
      await page.locator("#edit-dialog").waitFor({ state: "visible" });
      await page.waitForTimeout(SETTLE_MS);
      const out = `${prefix}-${theme}.png`;
      await page.screenshot({ path: out });
      console.log(out);
      await ctx.close();
    }
  } finally { await browser.close(); }
})();
