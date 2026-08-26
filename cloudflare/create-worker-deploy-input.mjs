import { readFile, writeFile } from "node:fs/promises";

const script = await readFile(new URL("../dist/cloudflare-worker.js", import.meta.url), "utf8");
const metadata = {
  main_module: "worker.js",
  compatibility_date: "2026-08-26",
  bindings: [{ name: "DB", type: "d1", id: "e47ed68a-ea2d-45ed-af9b-413d920a8707" }],
};
const code = `async () => {
  const boundary = "----MarketRegimePulse${Date.now()}";
  const metadata = ${JSON.stringify(metadata)};
  const script = ${JSON.stringify(script)};
  const body = [
    \`--\${boundary}\`,
    'Content-Disposition: form-data; name="metadata"',
    'Content-Type: application/json',
    '',
    JSON.stringify(metadata),
    \`--\${boundary}\`,
    'Content-Disposition: form-data; name="worker.js"; filename="worker.js"',
    'Content-Type: application/javascript+module',
    '',
    script,
    \`--\${boundary}--\`,
    '',
  ].join("\\r\\n");
  return cloudflare.request({ method: "PUT", path: \`/accounts/\${accountId}/workers/scripts/market-regime-pulse\`, body, contentType: \`multipart/form-data; boundary=\${boundary}\`, rawBody: true });
}`;
await writeFile("/tmp/market-regime-pulse-worker-deploy.json", JSON.stringify({ account_id: "ddab371d3b7afb4c4e589df5d30f5d46", code }));
console.log("Wrote /tmp/market-regime-pulse-worker-deploy.json");
