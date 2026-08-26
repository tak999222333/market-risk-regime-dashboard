import type { MarketSnapshot } from "./marketTypes";

export const HISTORY_RANGES = ["1h", "1d"] as const;
export type HistoryRange = (typeof HISTORY_RANGES)[number];

export function parseHistoryRange(value: string | null | undefined): HistoryRange {
  return (HISTORY_RANGES as readonly string[]).includes(value ?? "") ? value as HistoryRange : "1h";
}

export const HISTORY_RANGE_META: Record<HistoryRange, { label: string; description: string; bucketMs: number; limit: number }> = {
  "1h": { label: "1 小時", description: "保留短線的分鐘級節奏", bucketMs: 60_000, limit: 90 },
  "1d": { label: "1 日", description: "每 15 分鐘保留一個實際觀察", bucketMs: 15 * 60_000, limit: 1_600 },
};

export type HistoryChartPoint = {
  calculatedAt: string;
  compositeScore: number;
  confidence: number;
  samples: number;
};

export function historyRangeStart(range: HistoryRange, now = new Date()): Date {
  const windows: Record<HistoryRange, number> = {
    "1h": 60 * 60_000,
    "1d": 24 * 60 * 60_000,
  };
  return new Date(now.getTime() - windows[range]);
}

export function aggregateHistoryForChart(snapshots: MarketSnapshot[], range: HistoryRange): HistoryChartPoint[] {
  const bucketMs = HISTORY_RANGE_META[range].bucketMs;
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
