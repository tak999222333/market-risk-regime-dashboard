import { describe, expect, it } from "vitest";
import { aggregateHistoryForChart, historyRangeStart, parseHistoryRange } from "../shared/marketHistory";
import type { MarketSnapshot } from "../shared/marketTypes";

function snapshot(at: string, score: number): MarketSnapshot {
  return { market: "global", calculatedAt: at, compositeScore: score, regime: "中性", confidence: 80, dataStatus: "fresh", updateIntervalSeconds: 60, factors: [] };
}

describe("market history aggregation", () => {
  it("keeps the final actual observation in every chart bucket", () => {
    const points = aggregateHistoryForChart([
      snapshot("2024-06-24T10:01:00Z", 10),
      snapshot("2024-06-24T10:08:00Z", 14),
      snapshot("2024-06-24T10:21:00Z", 8),
    ], "1d");
    expect(points).toHaveLength(2);
    expect(points[0]).toMatchObject({ compositeScore: 14, samples: 2 });
    expect(points[1]).toMatchObject({ compositeScore: 8, samples: 1 });
  });

  it("calculates requested history starts from the selected window", () => {
    const now = new Date("2024-06-24T12:00:00Z");
    expect(historyRangeStart("1h", now).toISOString()).toBe("2024-06-24T11:00:00.000Z");
    expect(historyRangeStart("1d", now).toISOString()).toBe("2024-06-23T12:00:00.000Z");
  });

  it("accepts only 1H and 1D from the URL and falls back safely for removed or invalid values", () => {
    expect(parseHistoryRange("1h")).toBe("1h");
    expect(parseHistoryRange("1d")).toBe("1d");
    expect(parseHistoryRange("1w")).toBe("1h");
    expect(parseHistoryRange("all")).toBe("1h");
    expect(parseHistoryRange("year")).toBe("1h");
  });
});
