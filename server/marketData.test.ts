import { describe, expect, it } from "vitest";
import { determineMarketRegime, getMarketScopeMeta, scoreCreditSpread, scoreMarketCredit, scoreMarketVix, scorePercentChange, scoreVix, stabilizeSnapshotWithPrevious } from "./marketData";
import type { MarketSnapshot } from "../shared/marketTypes";

describe("market data factor transforms", () => {
  it("maps positive market returns to positive equity scores", () => {
    expect(scorePercentChange(0.8)).toBeGreaterThan(0);
    expect(scorePercentChange(-0.8)).toBeLessThan(0);
  });

  it("treats lower VIX and tighter credit spreads as more risk-on", () => {
    expect(scoreVix(16)).toBeGreaterThan(scoreVix(28));
    expect(scoreCreditSpread(3)).toBeGreaterThan(scoreCreditSpread(6));
  });

  it("caps extreme observations at the score range", () => {
    expect(scorePercentChange(10)).toBe(100);
    expect(scorePercentChange(-10)).toBe(-100);
  });

  it("keeps the last successful factor value when a refresh source times out", () => {
    const previous = {
      confidence: 80,
      factors: [{ key: "equity", score: 42, freshness: "delayed", signal: "prior source result" }],
    } as unknown as MarketSnapshot;
    const incoming = {
      confidence: 80,
      dataStatus: "partial",
      factors: [{ key: "equity", score: 0, freshness: "unavailable", signal: "unavailable", explanation: "timeout" }],
    } as unknown as MarketSnapshot;

    const stabilized = stabilizeSnapshotWithPrevious(incoming, previous);

    expect(stabilized.factors[0]?.score).toBe(42);
    expect(stabilized.factors[0]?.freshness).toBe("stale");
    expect(stabilized.confidence).toBe(72);
  });

  it("exposes distinct labels for Hong Kong and China regimes", () => {
    expect(getMarketScopeMeta("hongKong").shortLabel).toBe("香港");
    expect(getMarketScopeMeta("china").shortLabel).toBe("中國");
  });

  it("uses independently calibrated thresholds for Hong Kong and China", () => {
    expect(determineMarketRegime("global", 35)).toBe("中性");
    expect(determineMarketRegime("hongKong", 35)).toBe("Risk-on");
    expect(determineMarketRegime("china", 32)).toBe("Risk-on");
    expect(scoreMarketVix("hongKong", 21)).toBe(0);
    expect(scoreMarketCredit("china", 4.2)).toBe(0);
  });
});
