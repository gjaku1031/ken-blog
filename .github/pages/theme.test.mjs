import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const site = new URL("../../build/site/", import.meta.url);
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

const html = await readFile(new URL("posts/index.html", site), "utf8");
const script = html.match(/<script id="theme-init">([\s\S]*?)<\/script>/)?.[1];
assert.ok(script, "the built Posts page includes the inline theme initializer");
for (const system of ["light", "dark"]) {
  for (const saved of ["light", "dark", null, "invalid", ""]) {
    test(`first document theme: saved=${JSON.stringify(saved)}, system=${system}`, () => {
      const root = { dataset: {}, style: {} };
      runInNewContext(script, {
        document: { documentElement: root },
        localStorage: { getItem(key) { assert.equal(key, "ken-blog-theme"); return saved; } },
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
        get localStorage() {
          if (failure === "getter") throw new Error("SecurityError");
          return { getItem() { throw new Error("SecurityError"); } };
        },
      };
      runInNewContext(script, context);
      assert.equal(root.dataset.theme, system);
      assert.equal(root.style.colorScheme, system);
    });
  }
}
