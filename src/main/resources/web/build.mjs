import { build } from "esbuild";
import { mkdir, rm, readFile, writeFile, readdir } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

const root = resolve(import.meta.dirname, "../../../..");
const source = join(root, "src/main/resources/web");
const adminOutput = join(root, "build/admin-assets");
const publicOutput = join(root, "build/public-assets");

/** TS·CSS를 해시 이름 자산으로 컴파일한다. HTML은 Node의 페이지 생성 단계에서 조립한다. */
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

const manifestFile = join(root, "build/web-assets.json");

/** 경로와 실제 내용을 함께 해시하여 빌드 입력·캐시 파일의 일치를 확인. */
async function fileHashes(folder, prefix = "") {
  const files = {};
  for (const entry of (await readdir(folder, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = prefix + entry.name;
    if (entry.isDirectory()) Object.assign(files, await fileHashes(join(folder, entry.name), path + "/"));
    else if (entry.isFile()) files[path] = createHash("sha256").update(await readFile(join(folder, entry.name))).digest("hex");
    else throw new Error("웹 자산 링크/특수 파일 오류");
  }
  return files;
}

/** 글·템플릿과 독립적인 브라우저 번들 입력 버전. 캐시가 없어도 소스에서 복구 가능. */
export async function webAssetsKey() {
  const hash = createHash("sha256").update(`${process.version}:${process.platform}:${process.arch}`);
  for (const path of ["package.json", "package-lock.json", "tsconfig.json", "src/main/resources/web/build.mjs"])
    hash.update(path).update(await readFile(join(root, path)));
  for (const name of ["admin", "public", "shared"]) hash.update(name).update(JSON.stringify(await fileHashes(join(source, name))));
  return hash.digest("hex");
}

/** 입력과 모든 출력이 일치하는 번들만 재사용하고, 누락·손상 시 두 번들을 다시 생성. */
export async function buildWebAssets() {
  const key = await webAssetsKey();
  try {
    const saved = JSON.parse(await readFile(manifestFile, "utf8"));
    if (saved.key === key) {
      const files = { admin: await fileHashes(adminOutput), public: await fileHashes(publicOutput) };
      if (JSON.stringify(files) === JSON.stringify(saved.files) && ["admin", "public"].every(name =>
        ["js", "css"].every(type => files[name][saved.entries?.[name]?.[type]]))) {
        console.log(`프론트 번들 재사용: ${key}`);
        return saved.entries;
      }
    }
  } catch { /* 캐시 없이도 같은 빌드가 가능하도록 재생성. */ }
  const entries = {};
  entries.admin = await compile("admin", join(source, "admin/main.ts"), adminOutput, "/ken-blog/assets");
  entries.public = await compile("public", join(source, "public/main.ts"), publicOutput, "/ken-blog/assets");
  const files = { admin: await fileHashes(adminOutput), public: await fileHashes(publicOutput) };
  await writeFile(manifestFile, JSON.stringify({ key, entries, files }));
  console.log(`프론트 번들 생성: ${key}`);
  return entries;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.includes("--cache-key")) console.log(await webAssetsKey());
  else await buildWebAssets();
}
