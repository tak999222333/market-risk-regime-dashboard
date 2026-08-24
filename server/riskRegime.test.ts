import { describe, expect, it } from "vitest";
import { calculateCompositeScore, calculateConfidence, determineRegime } from "../shared/riskRegime";

describe("risk regime scoring", () => {
  it("aggregates weighted factor scores into the composite score", () => {
    const score = calculateCompositeScore([
      { score: 64, weight: 0.25 },
      { score: 48, weight: 0.2 },
      { score: 36, weight: 0.25 },
      { score: 32, weight: 0.15 },
      { score: 54, weight: 0.15 },
    ]);

    expect(score).toBe(48);
  });

  it("classifies regime bands without a gap at the neutral thresholds", () => {
    expect(determineRegime(40)).toBe("Risk-on");
    expect(determineRegime(-40)).toBe("Risk-off");
    expect(determineRegime(39)).toBe("中性");
  });

  it("assigns higher confidence to mutually reinforcing factor directions", () => {
    const aligned = calculateConfidence([
      { score: 70, weight: 0.5 },
      { score: 60, weight: 0.5 },
    ]);
    const conflicted = calculateConfidence([
      { score: 70, weight: 0.5 },
      { score: -60, weight: 0.5 },
    ]);

    expect(aligned).toBeGreaterThan(conflicted);
    expect(conflicted).toBeGreaterThanOrEqual(48);
  });
});
