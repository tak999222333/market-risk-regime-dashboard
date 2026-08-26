import { build } from "esbuild";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const publicDir = join(root, "dist", "public");
const generatedPath = join(root, "cloudflare", "generated-assets.ts");
const outputPath = join(root, "dist", "cloudflare-worker.js");
const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
};

async function filesAt(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.filter((entry) => entry.isDirectory()).map((entry) => filesAt(join(directory, entry.name))));
  return [...entries.filter((entry) => entry.isFile()).map((entry) => join(directory, entry.name)), ...nested.flat()];
}

const assets = {};
for (const file of await filesAt(publicDir)) {
  if (file.endsWith(".gitkeep") || file.includes("/__manus__/")) continue;
  const requestPath = `/${relative(publicDir, file).replaceAll("\\", "/")}`;
  const ext = requestPath.slice(requestPath.lastIndexOf("."));
  assets[requestPath] = { body: await readFile(file, "utf8"), contentType: contentTypes[ext] ?? "application/octet-stream" };
}
await writeFile(generatedPath, `export const STATIC_ASSETS: Record<string, { body: string; contentType: string }> = ${JSON.stringify(assets)};\n`);
await build({ entryPoints: [join(root, "cloudflare", "worker.ts")], outfile: outputPath, bundle: true, format: "esm", platform: "browser", target: "es2022", minify: true, sourcemap: false });
console.log(`Built ${outputPath} with ${Object.keys(assets).length} embedded frontend files.`);
