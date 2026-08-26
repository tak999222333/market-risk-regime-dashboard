import { COOKIE_NAME } from "@shared/const";
import { z } from "zod";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { getMarketSnapshotsForInterval, getRecentMarketSnapshots } from "./db";
import { refreshAllMarketSnapshots, refreshAndStoreMarketSnapshot } from "./marketData";
import { MARKET_SCOPES } from "../shared/marketTypes";
import { HISTORY_INTERVALS } from "../shared/marketHistory";

const marketInput = z.object({ market: z.enum(MARKET_SCOPES) });
const historyInput = z.object({ interval: z.enum(HISTORY_INTERVALS).default("hour") });

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  marketRegime: router({
    overview: publicProcedure.input(historyInput.optional()).query(async ({ input }) => {
      const interval = input?.interval ?? "hour";
      const snapshots = await refreshAllMarketSnapshots();
      const histories = Object.fromEntries(await Promise.all(MARKET_SCOPES.map(async (market) => [market, await getMarketSnapshotsForInterval(market, interval)] as const)));
      return { snapshots, histories, interval };
    }),
    current: publicProcedure.input(marketInput).query(async ({ input }) => {
      const snapshot = await refreshAndStoreMarketSnapshot(input.market);
      const history = await getRecentMarketSnapshots(input.market);
      return { snapshot, history };
    }),
    refresh: publicProcedure.input(historyInput.optional()).mutation(async ({ input }) => {
      const interval = input?.interval ?? "hour";
      const snapshots = await refreshAllMarketSnapshots(true);
      const histories = Object.fromEntries(await Promise.all(MARKET_SCOPES.map(async (market) => [market, await getMarketSnapshotsForInterval(market, interval)] as const)));
      return { snapshots, histories, interval };
    }),
  }),
});

export type AppRouter = typeof appRouter;
