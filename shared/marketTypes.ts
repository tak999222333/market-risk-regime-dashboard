export type MarketFactorKey = "equity" | "volatility" | "credit" | "safeHaven" | "crossAsset";

export type DataFrequency = "15 分鐘延遲" | "日終" | "分鐘級";

export type DataFreshness = "fresh" | "delayed" | "stale" | "unavailable";

export type LiveMarketFactor = {
  key: MarketFactorKey;
  name: string;
  shortName: string;
  weight: number;
  score: number;
  signal: string;
  explanation: string;
  latestValue: string;
  change: string;
  source: string;
  sourceUrl: string;
  frequency: DataFrequency;
  updatedAt: string;
  freshness: DataFreshness;
};

export type MarketSnapshot = {
  calculatedAt: string;
  compositeScore: number;
  regime: "Risk-on" | "中性" | "Risk-off";
  confidence: number;
  dataStatus: "fresh" | "partial";
  updateIntervalSeconds: number;
  factors: LiveMarketFactor[];
};
