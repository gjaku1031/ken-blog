import { build } from "esbuild";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");
const source = join(root, "src/main/frontend");
const adminOutput = join(root, "target/generated-resources/static");
const publicOutput = join(root, "target/public-assets");
const admin = join(source, "admin/main.ts");
const publicEntry = join(source, "public/main.ts");

/** 두 진입점을 독립 그래프로 컴파일해 공개 산출물에서 관리자 청크를 배제한다. */
async function compile(name, entry, output, publicPath) {
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  await build({ entryPoints: { [name]: entry }, outdir: output,
    bundle: true, splitting: true, format: "esm", platform: "browser", target: "es2022", minify: true,
    entryNames: "[name]", chunkNames: "chunk-[hash]", assetNames: "asset-[hash]", publicPath,
    loader: { ".woff": "file", ".woff2": "file", ".ttf": "file", ".svg": "file" }, logLevel: "warning" });
}

/** Maven은 관리자+공개 자산을, Pages 생성기는 공개 자산만 요청한다. */
export async function buildFrontend({ adminAssets = true } = {}) {
  if (!existsSync(publicEntry) || (adminAssets && !existsSync(admin))) throw new Error("프런트엔드 진입점이 필요합니다.");
  if (adminAssets) {
    await compile("admin", admin, join(adminOutput, "assets"), "/assets");
    await mkdir(join(adminOutput, "manage"), { recursive: true });
    await writeFile(join(adminOutput, "manage/index.html"), `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ken Blog 관리</title><link rel="stylesheet" href="/assets/admin.css"></head><body><div id="app"></div><script type="module" src="/assets/admin.js"></script></body></html>`);
  }
  await compile("public", publicEntry, publicOutput, "/ken-blog/assets");
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await buildFrontend();
