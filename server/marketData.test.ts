import { describe, expect, it } from "vitest";
import { scoreCreditSpread, scorePercentChange, scoreVix } from "./marketData";

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
});
