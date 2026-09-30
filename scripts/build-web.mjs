import { build } from "esbuild";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");
const source = join(root, "src/main/resources/web");
const generated = join(root, "target/generated-resources");
const adminOutput = join(generated, "static/assets");
const publicOutput = join(root, "target/public-assets");

/** TS·CSS를 해시 이름 자산으로 컴파일하며 HTML은 Thymeleaf가 담당. */
async function compile(name, entry, output, publicPath) {
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  const result = await build({ entryPoints: { [name]: entry }, outdir: output,
    bundle: true, splitting: true, format: "esm", platform: "browser", target: "es2022", minify: true,
    entryNames: "[name]-[hash]", chunkNames: "chunk-[hash]", assetNames: "asset-[hash]", publicPath,
    loader: { ".woff": "file", ".woff2": "file", ".ttf": "file", ".svg": "file" }, metafile: true, logLevel: "warning" });
  const entryOutput = Object.entries(result.metafile.outputs).find(([, value]) =>
    value.entryPoint && resolve(value.entryPoint) === entry);
  if (!entryOutput?.[1].cssBundle) throw new Error(`${name} JS/CSS 자산이 필요합니다.`);
  return { js: basename(entryOutput[0]), css: basename(entryOutput[1].cssBundle) };
}

/** 관리자와 공개 자산을 분리하고 서버 템플릿용 manifest를 기록. */
export async function buildWebAssets({ adminAssets = true } = {}) {
  const entries = {};
  if (adminAssets) {
    const entry = join(source, "admin/main.ts");
    if (!existsSync(entry)) throw new Error("관리자 TS 진입점이 없습니다.");
    entries.admin = await compile("admin", entry, adminOutput, "/assets");
  }
  entries.public = await compile("public", join(source, "public/main.ts"), publicOutput, "/ken-blog/assets");
  if (adminAssets) {
    await mkdir(generated, { recursive: true });
    await writeFile(join(generated, "assets-manifest.json"), JSON.stringify(entries));
  }
  return entries;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await buildWebAssets();
