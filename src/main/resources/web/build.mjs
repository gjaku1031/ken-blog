import { build } from "esbuild";
import { mkdir, rm } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "../../../..");
const source = join(root, "src/main/resources/web");
const adminOutput = join(root, "build/admin-assets");
const publicOutput = join(root, "build/public-assets");

/** TS·CSS를 해시 이름 자산으로 컴파일한다. HTML은 모두 빌드 시 Thymeleaf가 생성한다. */
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

/** Pages의 관리자·공개 자산을 각각 분리해 컴파일한다. */
export async function buildWebAssets() {
  const entries = {};
  entries.admin = await compile("admin", join(source, "admin/main.ts"), adminOutput, "/ken-blog/assets");
  entries.public = await compile("public", join(source, "public/main.ts"), publicOutput, "/ken-blog/assets");
  return entries;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await buildWebAssets();
