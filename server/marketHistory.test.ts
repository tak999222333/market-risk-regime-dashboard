import { describe, expect, it } from "vitest";
import { aggregateHistoryForChart, parseHistoryInterval } from "../shared/marketHistory";
import type { MarketSnapshot } from "../shared/marketTypes";

function snapshot(at: string, score: number): MarketSnapshot {
  return { market: "global", calculatedAt: at, compositeScore: score, regime: "中性", confidence: 80, dataStatus: "fresh", updateIntervalSeconds: 60, factors: [] };
}

describe("market history aggregation", () => {
  it("keeps the final actual observation in every chart bucket", () => {
    const points = aggregateHistoryForChart([
      snapshot("2024-06-24T10:01:00Z", 10),
      snapshot("2024-06-24T10:08:00Z", 14),
      snapshot("2024-06-24T11:21:00Z", 8),
    ], "hour");
    expect(points).toHaveLength(2);
    expect(points[0]).toMatchObject({ compositeScore: 14, samples: 2 });
    expect(points[1]).toMatchObject({ compositeScore: 8, samples: 1 });
  });

  it("keeps the last actual observation in every daily bucket", () => {
    const points = aggregateHistoryForChart([
      snapshot("2024-06-23T23:58:00Z", 4),
      snapshot("2024-06-24T10:01:00Z", 10),
      snapshot("2024-06-24T15:30:00Z", 18),
    ], "day");
    expect(points).toHaveLength(2);
    expect(points[0]).toMatchObject({ compositeScore: 4, samples: 1 });
    expect(points[1]).toMatchObject({ compositeScore: 18, samples: 2 });
  });

  it("accepts hourly and daily intervals and keeps legacy links safe", () => {
    expect(parseHistoryInterval("hour")).toBe("hour");
    expect(parseHistoryInterval("day")).toBe("day");
    expect(parseHistoryInterval("1h")).toBe("hour");
    expect(parseHistoryInterval("1d")).toBe("day");
    expect(parseHistoryInterval("week")).toBe("hour");
  });
});
