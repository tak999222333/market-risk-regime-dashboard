import { readdir, readFile, writeFile } from "node:fs/promises";

const inputDir = "/tmp/market-regime-d1-import";
const files = (await readdir(inputDir)).filter((name) => name.endsWith(".json")).sort();
const batches = await Promise.all(files.map(async (file) => JSON.parse(await readFile(`${inputDir}/${file}`, "utf8"))));
const [first] = batches;
const parts = [batches.slice(0, Math.ceil(batches.length / 2)), batches.slice(Math.ceil(batches.length / 2))];
const sizes = [];
for (const [index, part] of parts.entries()) {
  const output = `/tmp/market-regime-d1-import-part-${index + 1}.json`;
  await writeFile(output, JSON.stringify({ database_id: first.database_id, sql: part.map((batch) => batch.sql).join("\n") }));
  sizes.push((await readFile(output)).byteLength);
}
console.log(JSON.stringify({ batches: batches.length, parts: parts.length, sqlBytes: sizes }));
