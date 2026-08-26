import mysql from "mysql2/promise";
import { mkdir, writeFile } from "node:fs/promises";

const databaseId = "e47ed68a-ea2d-45ed-af9b-413d920a8707";
const outputDir = "/tmp/market-regime-d1-import";
const connection = await mysql.createConnection(process.env.DATABASE_URL);
const [rows] = await connection.execute(
  `SELECT market, compositeScore, regime, confidence, dataStatus, payload, calculatedAt
   FROM marketSnapshots
   WHERE calculatedAt >= UTC_TIMESTAMP() - INTERVAL 1 DAY
   ORDER BY calculatedAt ASC`,
);
await connection.end();

const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
const values = rows.map((row) => `(${quote(row.market)}, ${Number(row.compositeScore)}, ${quote(row.regime)}, ${Number(row.confidence)}, ${quote(row.dataStatus)}, ${quote(row.payload)}, ${quote(new Date(row.calculatedAt).toISOString())})`);
const chunks = [];
for (let start = 0; start < values.length; start += 20) chunks.push(values.slice(start, start + 20));
await mkdir(outputDir, { recursive: true });
for (const [index, chunk] of chunks.entries()) {
  const sql = `INSERT INTO market_snapshots (market, composite_score, regime, confidence, data_status, payload, calculated_at) VALUES ${chunk.join(",")};`;
  await writeFile(`${outputDir}/${String(index).padStart(3, "0")}.json`, JSON.stringify({ database_id: databaseId, sql }));
}
console.log(JSON.stringify({ rows: rows.length, batches: chunks.length, outputDir }));
