export const MARKET_SCOPES = ["global", "hongKong", "china"] as const;
export type MarketScope = (typeof MARKET_SCOPES)[number];

export const MARKET_SCOPE_META: Record<MarketScope, { label: string; shortLabel: string; description: string }> = {
  global: { label: "全球／美國主導", shortLabel: "全球", description: "以美國股票、波動率、信貸、美元與跨資產風險偏好為核心。" },
  hongKong: { label: "香港市場", shortLabel: "香港", description: "以香港股票代理、中國科技、人民幣及全球壓力訊號判讀。" },
  china: { label: "中國市場", shortLabel: "中國", description: "以 A 股代理、中國科技、人民幣及全球壓力訊號判讀。" },
};

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
  market: MarketScope;
  calculatedAt: string;
  compositeScore: number;
  regime: "Risk-on" | "中性" | "Risk-off";
  confidence: number;
  dataStatus: "fresh" | "partial";
  updateIntervalSeconds: number;
  factors: LiveMarketFactor[];
};
