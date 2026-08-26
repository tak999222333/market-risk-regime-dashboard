import type { MarketSnapshot } from "./marketTypes";

export const HISTORY_INTERVALS = ["hour", "day"] as const;
export type HistoryInterval = (typeof HISTORY_INTERVALS)[number];

export function parseHistoryInterval(value: string | null | undefined): HistoryInterval {
  if (value === "day" || value === "1d") return "day";
  return "hour";
}

export const HISTORY_INTERVAL_META: Record<HistoryInterval, { label: string; description: string; bucketMs: number; maxRawRows: number }> = {
  hour: { label: "每小時", description: "每個小時保留最後一個實際分數", bucketMs: 60 * 60_000, maxRawRows: 50_000 },
  day: { label: "每日", description: "每天保留最後一個實際分數", bucketMs: 24 * 60 * 60_000, maxRawRows: 50_000 },
};

export type HistoryChartPoint = {
  calculatedAt: string;
  compositeScore: number;
  confidence: number;
  samples: number;
};

export function aggregateHistoryForChart(snapshots: MarketSnapshot[], interval: HistoryInterval): HistoryChartPoint[] {
  const bucketMs = HISTORY_INTERVAL_META[interval].bucketMs;
  const buckets = new Map<number, { snapshot: MarketSnapshot; samples: number }>();

  for (const snapshot of snapshots) {
    const timestamp = new Date(snapshot.calculatedAt).getTime();
    if (!Number.isFinite(timestamp)) continue;
    const key = Math.floor(timestamp / bucketMs) * bucketMs;
    const current = buckets.get(key);
    if (!current || new Date(current.snapshot.calculatedAt).getTime() <= timestamp) {
      buckets.set(key, { snapshot, samples: (current?.samples ?? 0) + 1 });
    } else {
      current.samples += 1;
    }
  }

  return Array.from(buckets.values())
    .sort((a, b) => new Date(a.snapshot.calculatedAt).getTime() - new Date(b.snapshot.calculatedAt).getTime())
    .map(({ snapshot, samples }) => ({ calculatedAt: snapshot.calculatedAt, compositeScore: snapshot.compositeScore, confidence: snapshot.confidence, samples }));
}
