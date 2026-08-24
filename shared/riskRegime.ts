export type Regime = "Risk-on" | "中性" | "Risk-off";

export type FactorKey = "equity" | "volatility" | "credit" | "safeHaven" | "crossAsset";

export type FactorDefinition = {
  key: FactorKey;
  name: string;
  shortName: string;
  weight: number;
  score: number;
  description: string;
  signal: string;
  source: string;
  sourceUrl: string;
  frequency: "分鐘級" | "日終";
  updatedAt: string;
  delta: string;
};

export const factorDefinitions: Omit<FactorDefinition, "score" | "signal" | "delta">[] = [
  {
    key: "equity",
    name: "股票風險偏好",
    shortName: "Equity",
    weight: 0.25,
    description: "大型股廣度、週期／防守相對強弱與高 beta 領先情況。",
    source: "示範股票籃子",
    sourceUrl: "https://www.spglobal.com/spdji/en/indices/equity/sp-500/",
    frequency: "分鐘級",
    updatedAt: "10:32 ET",
  },
  {
    key: "volatility",
    name: "波動率",
    shortName: "Volatility",
    weight: 0.2,
    description: "隱含波動率水準、日內變化及期限結構。",
    source: "Cboe VIX",
    sourceUrl: "https://www.cboe.com/tradable-products/vix/",
    frequency: "分鐘級",
    updatedAt: "10:33 ET",
  },
  {
    key: "credit",
    name: "信貸壓力",
    shortName: "Credit",
    weight: 0.25,
    description: "高收益債利差與投資級／高收益債的信用壓力變化。",
    source: "FRED · ICE BofA HY OAS",
    sourceUrl: "https://fred.stlouisfed.org/series/BAMLH0A0HYM2",
    frequency: "日終",
    updatedAt: "20 Aug · close",
  },
  {
    key: "safeHaven",
    name: "美元／避險資產",
    shortName: "USD & havens",
    weight: 0.15,
    description: "美元、日圓、美債與黃金的避險資產需求。",
    source: "示範 FX／避險籃子",
    sourceUrl: "https://www.financialresearch.gov/financial-stress-index/files/indicators/",
    frequency: "分鐘級",
    updatedAt: "10:31 ET",
  },
  {
    key: "crossAsset",
    name: "跨資產確認",
    shortName: "Cross-asset",
    weight: 0.15,
    description: "EM 相對表現、銅／金比率與高 beta 資產的共同確認。",
    source: "示範跨資產籃子",
    sourceUrl: "https://www.financialresearch.gov/financial-stress-index/files/indicators/",
    frequency: "分鐘級",
    updatedAt: "10:31 ET",
  },
];

export function calculateCompositeScore(factors: Pick<FactorDefinition, "score" | "weight">[]) {
  return Math.round(factors.reduce((total, factor) => total + factor.score * factor.weight, 0));
}

export function determineRegime(score: number): Regime {
  if (score >= 40) return "Risk-on";
  if (score <= -40) return "Risk-off";
  return "中性";
}

export function calculateConfidence(factors: Pick<FactorDefinition, "score" | "weight">[]) {
  const compositeScore = factors.reduce((total, factor) => total + factor.score * factor.weight, 0);
  const grossSignal = factors.reduce((total, factor) => total + Math.abs(factor.score * factor.weight), 0);
  const coherence = grossSignal === 0 ? 0 : Math.abs(compositeScore) / grossSignal;
  return Math.max(48, Math.min(94, Math.round(48 + grossSignal * 0.25 + coherence * 30)));
}
