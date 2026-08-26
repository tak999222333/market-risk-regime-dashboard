import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { sdk } from "./sdk";
import { refreshAllMarketSnapshots } from "../marketData";
import { getMarketSnapshotsForRange } from "../db";
import { MARKET_SCOPES } from "../../shared/marketTypes";
import { parseHistoryRange } from "../../shared/marketHistory";
import { serveStatic, setupVite } from "./vite";

const CLOUDFLARE_MARKET_API = "https://market-regime-pulse.lumahub.workers.dev";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  registerStorageProxy(app);
  registerOAuthRoutes(app);
  app.post("/api/scheduled/refresh-market-regime", async (req, res) => {
    try {
      const user = await sdk.authenticateRequest(req);
      if (!user.isCron || !user.taskUid) return res.status(403).json({ error: "cron-only" });
      const snapshots = await refreshAllMarketSnapshots(true);
      return res.json({ ok: true, markets: Object.fromEntries(Object.entries(snapshots).map(([market, snapshot]) => [market, { calculatedAt: snapshot.calculatedAt, regime: snapshot.regime }])) });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown refresh failure";
      return res.status(500).json({ error: message, timestamp: new Date().toISOString() });
    }
  });
  const localSavedOverview = async (range: ReturnType<typeof parseHistoryRange>, refresh: boolean) => {
    const histories = Object.fromEntries(await Promise.all(MARKET_SCOPES.map(async (market) => [market, await getMarketSnapshotsForRange(market, range)] as const)));
    const savedSnapshots = Object.fromEntries(MARKET_SCOPES.flatMap((market) => {
      const latest = histories[market].at(-1);
      return latest ? [[market, latest] as const] : [];
    }));
    if (Object.keys(savedSnapshots).length === MARKET_SCOPES.length && !refresh) return { snapshots: savedSnapshots, histories, range };
    const snapshots = await refreshAllMarketSnapshots(refresh);
    return { snapshots, histories, range };
  };
  const proxyCloudflareMarketApi = async (req: express.Request, res: express.Response, action: "overview" | "refresh") => {
    const range = parseHistoryRange(typeof req.query.range === "string" ? req.query.range : null);
    try {
      const upstream = await fetch(`${CLOUDFLARE_MARKET_API}/api/${action}?range=${encodeURIComponent(range)}`, { method: action === "refresh" ? "POST" : "GET", headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8_000) });
      const body = await upstream.text();
      const contentType = upstream.headers.get("content-type") ?? "";
      if (!contentType.includes("application/json")) throw new Error("上游市場服務沒有回傳 JSON");
      res.status(upstream.status).set("Cache-Control", "no-store").type("application/json").send(body);
    } catch (error) {
      try {
        const fallback = await localSavedOverview(range, action === "refresh");
        res.set("Cache-Control", "no-store").json(fallback);
      } catch (fallbackError) {
        const message = fallbackError instanceof Error ? fallbackError.message : (error instanceof Error ? error.message : "市場服務轉接失敗");
        res.status(502).json({ error: message, timestamp: new Date().toISOString() });
      }
    }
  };
  app.get("/api/overview", (req, res) => proxyCloudflareMarketApi(req, res, "overview"));
  app.post("/api/refresh", (req, res) => proxyCloudflareMarketApi(req, res, "refresh"));
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
