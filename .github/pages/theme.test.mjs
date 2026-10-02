import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

/**
 * 생성된 정적 사이트 경로
 */
const site = new URL("../../build/site/", import.meta.url);

/**
 * 하위 디렉터리의 HTML 파일 목록 수집
 */
async function htmlFiles(folder) {
  const files = [];
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) files.push(...await htmlFiles(path));
    else if (entry.name.endsWith(".html")) files.push(path);
  }
  return files;
}

test("every generated document initializes its theme before styles, modules and redirects", async () => {
  const files = await htmlFiles(site.pathname);
  assert.ok(files.length > 0);
  for (const file of files) {
    const html = await readFile(file, "utf8");
    const init = html.indexOf('<script id="theme-init">');
    assert.ok(init > html.indexOf("<head>"), file);
    assert.ok(init < html.indexOf("</head>"), file);
    for (const marker of ['rel="stylesheet"', 'type="module"', 'http-equiv="refresh"', "<body"]) {
      const position = html.indexOf(marker);
      if (position !== -1) assert.ok(init < position, `${file}: ${marker}`);
    }
    assert.match(html, /<style id="theme-canvas">/, file);
  }
});

/**
 * 생성된 글 목록 HTML
 */
const html = await readFile(new URL("posts/index.html", site), "utf8");

/**
 * 첫 페인트 전 테마 초기화 스크립트
 */
const script = html.match(/<script id="theme-init">([\s\S]*?)<\/script>/)?.[1];
assert.ok(script, "the built Posts page includes the inline theme initializer");
for (const system of ["light", "dark"]) {
  for (const saved of ["light", "dark", null, "invalid", ""]) {
    test(`first document theme: saved=${JSON.stringify(saved)}, system=${system}`, () => {
      const root = { dataset: {}, style: {} };
      runInNewContext(script, {
        document: { documentElement: root },
        localStorage: {
/**
 * 저장된 테마 조회 또는 저장소 접근 오류 재현
 */
getItem(key) { assert.equal(key, "ken-blog-theme"); return saved; } },

        /**
         * 시스템 테마 조회 조건과 결과 재현
         */
        matchMedia(query) { assert.equal(query, "(prefers-color-scheme: dark)"); return { matches: system === "dark" }; },
      });
      const expected = saved === "light" || saved === "dark" ? saved : system;
      assert.equal(root.dataset.theme, expected);
      assert.equal(root.style.colorScheme, expected);
    });
  }
  for (const failure of ["getter", "getItem"]) {
    test(`blocked storage ${failure} falls back to ${system}`, () => {
      const root = { dataset: {}, style: {} };
      const context = {
        document: { documentElement: root },
        matchMedia: () => ({ matches: system === "dark" }),

        /**
         * 테마 저장소 접근 거부 재현
         */
        get localStorage() {
          if (failure === "getter") throw new Error("SecurityError");
          return {
          /**
           * 저장된 테마 조회 또는 저장소 접근 오류 재현
           */
          getItem() { throw new Error("SecurityError"); } };
        },
      };
      runInNewContext(script, context);
      assert.equal(root.dataset.theme, system);
      assert.equal(root.style.colorScheme, system);
    });
  }
}
