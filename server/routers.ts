import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { getRecentMarketSnapshots } from "./db";
import { refreshAndStoreMarketSnapshot } from "./marketData";

export const appRouter = router({
    // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),

  marketRegime: router({
    current: publicProcedure.query(async () => {
      const snapshot = await refreshAndStoreMarketSnapshot();
      const history = await getRecentMarketSnapshots();
      return { snapshot, history };
    }),
    refresh: publicProcedure.mutation(async () => {
      const snapshot = await refreshAndStoreMarketSnapshot(true);
      const history = await getRecentMarketSnapshots();
      return { snapshot, history };
    }),
  }),

  // TODO: add feature routers here, e.g.
  // todo: router({
  //   list: protectedProcedure.query(({ ctx }) =>
  //     db.getUserTodos(ctx.user.id)
  //   ),
  // }),
});

export type AppRouter = typeof appRouter;
