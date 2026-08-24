import { useMemo, useState } from "react";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  BadgeInfo,
  BarChart3,
  ChevronDown,
  CircleHelp,
  Clock3,
  Crosshair,
  Database,
  Globe2,
  Layers3,
  LineChart as LineChartIcon,
  ShieldAlert,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  calculateCompositeScore,
  calculateConfidence,
  determineRegime,
  factorDefinitions,
  type FactorDefinition,
  type FactorKey,
} from "../../../shared/riskRegime";

type ScenarioKey = "current" | "neutral" | "stress";
type WindowKey = "1H" | "1D" | "1W";

type Scenario = {
  label: string;
  subtitle: string;
  scores: Record<FactorKey, number>;
  signals: Record<FactorKey, string>;
  deltas: Record<FactorKey, string>;
  scoreChange: string;
  momentum: string;
};

const scenarios: Record<ScenarioKey, Scenario> = {
  current: {
    label: "平衡偏正面",
    subtitle: "示範快照 · 以跨資產一致性作為主要確認",
    scores: { equity: 64, volatility: 48, credit: 36, safeHaven: 32, crossAsset: 54 },
    signals: {
      equity: "廣度改善，週期板塊領先",
      volatility: "VIX 15.91，仍處溫和區間",
      credit: "HY OAS 2.75%，信用壓力受控",
      safeHaven: "美元需求穩定，未見避險急升",
      crossAsset: "EM 與高 beta 資產同步確認",
    },
    deltas: { equity: "+9", volatility: "+5", credit: "+2", safeHaven: "+4", crossAsset: "+11" },
    scoreChange: "+7.4",
    momentum: "1 日",
  },
  neutral: {
    label: "訊號分歧",
    subtitle: "示範快照 · 股票與信用因素未形成一致方向",
    scores: { equity: 12, volatility: -4, credit: -22, safeHaven: -16, crossAsset: 8 },
    signals: {
      equity: "大盤守穩，但廣度偏窄",
      volatility: "VIX 維持中性區間",
      credit: "HY 利差輕微擴闊",
      safeHaven: "美元及黃金同步受支持",
      crossAsset: "高 beta 資產缺乏確認",
    },
    deltas: { equity: "+2", volatility: "−1", credit: "−6", safeHaven: "−5", crossAsset: "+1" },
    scoreChange: "−3.1",
    momentum: "1 日",
  },
  stress: {
    label: "壓力測試",
    subtitle: "示範快照 · 全因子同步轉弱的 Risk-off 情境",
    scores: { equity: -48, volatility: -65, credit: -79, safeHaven: -54, crossAsset: -61 },
    signals: {
      equity: "廣度顯著轉弱，防守板塊領先",
      volatility: "隱含波動率跳升並倒掛",
      credit: "高收益利差快速擴闊",
      safeHaven: "美元、日圓及美債需求上升",
      crossAsset: "EM、銅與高 beta 資產共同走弱",
    },
    deltas: { equity: "−31", volatility: "−42", credit: "−38", safeHaven: "−25", crossAsset: "−29" },
    scoreChange: "−28.6",
    momentum: "1 日",
  },
};

const trendByWindow: Record<WindowKey, { time: string; score: number }[]> = {
  "1H": [
    { time: "09:35", score: 31 }, { time: "09:45", score: 35 }, { time: "09:55", score: 34 },
    { time: "10:05", score: 39 }, { time: "10:15", score: 43 }, { time: "10:25", score: 46 }, { time: "10:33", score: 48 },
  ],
  "1D": [
    { time: "09:30", score: 12 }, { time: "11:00", score: 18 }, { time: "12:30", score: 15 },
    { time: "14:00", score: 24 }, { time: "15:30", score: 33 }, { time: "16:00", score: 40 }, { time: "Now", score: 48 },
  ],
  "1W": [
    { time: "Mon", score: -18 }, { time: "Tue", score: -9 }, { time: "Wed", score: 7 },
    { time: "Thu", score: 14 }, { time: "Fri", score: 29 }, { time: "Today", score: 48 },
  ],
};

const regimeHistory = [
  { date: "24 AUG · 10:05", regime: "Risk-on", detail: "分數跨越 +40，持續 3 個更新週期", tone: "positive" },
  { date: "23 AUG · 15:30", regime: "中性", detail: "波動率升溫，信用因素仍具支持", tone: "neutral" },
  { date: "22 AUG · 11:45", regime: "Risk-on", detail: "股票廣度及跨資產確認改善", tone: "positive" },
];

const factorIcons: Record<FactorKey, typeof TrendingUp> = {
  equity: TrendingUp,
  volatility: Activity,
  credit: ShieldAlert,
  safeHaven: Globe2,
  crossAsset: Crosshair,
};

function scoreColor(score: number) {
  if (score >= 0) return "#6CE2C2";
  return "#FF8F82";
}

function scoreTone(score: number) {
  if (score >= 40) return "text-[#6CE2C2]";
  if (score <= -40) return "text-[#FF8F82]";
  return "text-[#F1BE71]";
}

export default function Home() {
  const [scenarioKey, setScenarioKey] = useState<ScenarioKey>("current");
  const [windowKey, setWindowKey] = useState<WindowKey>("1D");
  const [selectedFactor, setSelectedFactor] = useState<FactorKey>("equity");
  const scenario = scenarios[scenarioKey];

  const factors = useMemo<FactorDefinition[]>(() => factorDefinitions.map((definition) => ({
    ...definition,
    score: scenario.scores[definition.key],
    signal: scenario.signals[definition.key],
    delta: scenario.deltas[definition.key],
  })), [scenario]);

  const score = calculateCompositeScore(factors);
  const regime = determineRegime(score);
  const confidence = calculateConfidence(factors);
  const selected = factors.find((factor) => factor.key === selectedFactor) ?? factors[0];
  const supporting = factors.filter((factor) => factor.score > 0).sort((a, b) => b.score - a.score).slice(0, 2);
  const opposing = factors.filter((factor) => factor.score < 0).sort((a, b) => a.score - b.score).slice(0, 1);

  return (
    <div className="min-h-screen overflow-x-hidden bg-[#11131A] text-[#F3F0E9] selection:bg-[#D9F37A] selection:text-[#10120E]">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_12%_0%,rgba(217,243,122,0.12),transparent_24rem),radial-gradient(circle_at_88%_24%,rgba(122,153,243,0.12),transparent_28rem)]" />
      <main className="relative mx-auto max-w-[1480px] px-4 pb-10 pt-5 sm:px-7 lg:px-10 lg:pt-7">
        <header className="mb-8 flex flex-col gap-5 border-b border-white/10 pb-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4">
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-[#D9F37A] text-[#15180E] shadow-[0_0_32px_rgba(217,243,122,0.16)]">
              <Layers3 className="h-5 w-5" strokeWidth={2.5} />
            </div>
            <div>
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-[#A5A8B0]">
                Market Regime <span className="h-1.5 w-1.5 rounded-full bg-[#6CE2C2]" /> Live logic preview
              </div>
              <h1 className="mt-1 font-[var(--font-display)] text-xl tracking-[-0.03em] text-white sm:text-2xl">市場風險狀態</h1>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.035] px-3 py-2 text-[#C5C7CD]">
              <Clock3 className="h-3.5 w-3.5 text-[#D9F37A]" /> 更新於 24 AUG 2026 · 10:33 ET
            </div>
            <div className="flex items-center gap-2 rounded-full bg-[#D9F37A] px-3 py-2 font-semibold text-[#17190F]">
              <Sparkles className="h-3.5 w-3.5" /> 示範快照
            </div>
          </div>
        </header>

        <section className="mb-6 grid gap-4 xl:grid-cols-[1.18fr_0.82fr]">
          <div className="relative overflow-hidden rounded-[28px] border border-white/10 bg-[#1A1D27] p-5 sm:p-7">
            <div className="absolute -right-14 -top-20 h-56 w-56 rounded-full bg-[#D9F37A]/10 blur-3xl" />
            <div className="relative flex flex-col justify-between gap-7 sm:flex-row sm:items-end">
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.16em] text-[#A5A8B0]">Composite regime score</p>
                <div className="mt-2 flex items-end gap-4">
                  <span className={`font-[var(--font-display)] text-[82px] font-medium leading-[0.82] tracking-[-0.08em] sm:text-[108px] ${scoreTone(score)}`}>
                    {score > 0 ? "+" : ""}{score}
                  </span>
                  <div className="mb-2.5">
                    <span className={`inline-flex rounded-full px-3 py-1 text-xs font-bold uppercase tracking-[0.14em] ${regime === "Risk-on" ? "bg-[#6CE2C2]/15 text-[#6CE2C2]" : regime === "Risk-off" ? "bg-[#FF8F82]/15 text-[#FF8F82]" : "bg-[#F1BE71]/15 text-[#F1BE71]"}`}>
                      {regime}
                    </span>
                    <p className="mt-2 text-xs text-[#A5A8B0]">由 −100 至 +100</p>
                  </div>
                </div>
              </div>
              <div className="min-w-[205px] rounded-2xl border border-white/10 bg-black/15 p-4 backdrop-blur-sm">
                <div className="flex items-center justify-between text-xs text-[#B9BBC2]"><span>置信度</span><span className="font-semibold text-[#F3F0E9]">{confidence}%</span></div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-[#D9F37A]" style={{ width: `${confidence}%` }} /></div>
                <p className="mt-3 text-xs leading-5 text-[#A5A8B0]">{scenario.subtitle}</p>
              </div>
            </div>
            <div className="relative mt-7 flex flex-wrap gap-x-7 gap-y-3 border-t border-white/10 pt-4 text-xs">
              <span className="flex items-center gap-2 text-[#B6B8BF]"><ArrowUpRight className="h-3.5 w-3.5 text-[#6CE2C2]" /> {scenario.scoreChange} pts <span className="text-[#747782]">vs. previous {scenario.momentum}</span></span>
              <span className="flex items-center gap-2 text-[#B6B8BF]"><Activity className="h-3.5 w-3.5 text-[#D9F37A]" /> 3 / 5 因子確認 Risk-on</span>
            </div>
          </div>

          <div className="rounded-[28px] border border-white/10 bg-[#161922] p-5 sm:p-7">
            <div className="flex items-center justify-between"><div><p className="text-xs font-medium uppercase tracking-[0.16em] text-[#A5A8B0]">Quick read</p><h2 className="mt-1 font-[var(--font-display)] text-2xl tracking-[-0.035em] text-white">此刻由甚麼驅動？</h2></div><BadgeInfo className="h-5 w-5 text-[#D9F37A]" /></div>
            <div className="mt-5 space-y-3">
              {supporting.map((factor, index) => <div className="flex items-center justify-between rounded-2xl bg-white/[0.035] px-4 py-3" key={factor.key}><div className="flex items-center gap-3"><span className="grid h-6 w-6 place-items-center rounded-full bg-[#6CE2C2]/10 text-xs font-bold text-[#6CE2C2]">{index + 1}</span><span className="text-sm text-[#E1DFD8]">{factor.name}</span></div><span className="font-[var(--font-display)] text-lg text-[#6CE2C2]">+{factor.score}</span></div>)}
              {opposing.length ? opposing.map((factor) => <div className="flex items-center justify-between rounded-2xl bg-white/[0.035] px-4 py-3" key={factor.key}><div className="flex items-center gap-3"><span className="grid h-6 w-6 place-items-center rounded-full bg-[#FF8F82]/10 text-xs font-bold text-[#FF8F82]"><TrendingDown className="h-3.5 w-3.5" /></span><span className="text-sm text-[#E1DFD8]">需要留意：{factor.name}</span></div><span className="font-[var(--font-display)] text-lg text-[#FF8F82]">{factor.score}</span></div>) : <div className="rounded-2xl bg-[#6CE2C2]/[0.07] px-4 py-3 text-sm text-[#A9D9CD]">尚未見到明確的負面因子拖累。</div>}
            </div>
          </div>
        </section>

        <section className="mb-6 grid gap-4 xl:grid-cols-[1.42fr_0.58fr]">
          <div className="rounded-[28px] border border-white/10 bg-[#161922] p-5 sm:p-7">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div><p className="text-xs font-medium uppercase tracking-[0.16em] text-[#A5A8B0]">Regime trajectory</p><h2 className="mt-1 font-[var(--font-display)] text-2xl tracking-[-0.035em] text-white">風險分數走勢</h2></div>
              <div className="inline-flex self-start rounded-xl border border-white/10 bg-black/20 p-1">{(["1H", "1D", "1W"] as WindowKey[]).map((window) => <button type="button" key={window} onClick={() => setWindowKey(window)} className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${windowKey === window ? "bg-[#D9F37A] text-[#14160D]" : "text-[#9FA2AB] hover:text-white"}`}>{window}</button>)}</div>
            </div>
            <div className="mt-5 h-[230px] sm:h-[270px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trendByWindow[windowKey]} margin={{ top: 10, right: 4, left: -26, bottom: 0 }}>
                  <defs><linearGradient id="scoreFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#D9F37A" stopOpacity={0.32} /><stop offset="100%" stopColor="#D9F37A" stopOpacity={0} /></linearGradient></defs>
                  <CartesianGrid stroke="#FFFFFF" strokeOpacity={0.07} vertical={false} />
                  <XAxis type="category" dataKey="time" axisLine={false} tickLine={false} tick={{ fill: "#777B85", fontSize: 11 }} dy={12} />
                  <YAxis domain={[-100, 100]} ticks={[-50, 0, 50]} axisLine={false} tickLine={false} tick={{ fill: "#777B85", fontSize: 11 }} />
                  <Tooltip cursor={{ stroke: "#D9F37A", strokeOpacity: 0.28 }} contentStyle={{ background: "#202430", border: "1px solid rgba(255,255,255,.12)", borderRadius: 12, color: "#F3F0E9", fontSize: 12 }} formatter={(value: number) => [`${value > 0 ? "+" : ""}${value}`, "Composite score"]} />
                  <Area type="monotone" dataKey="score" stroke="#D9F37A" strokeWidth={2.5} fill="url(#scoreFill)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-4 flex flex-wrap gap-3 text-xs text-[#9FA2AB]"><span className="inline-flex items-center gap-2"><i className="h-2 w-2 rounded-full bg-[#D9F37A]" /> Composite score</span><span className="inline-flex items-center gap-2"><i className="h-px w-5 bg-[#858991]" /> 0 = 中性</span></div>
          </div>

          <div className="rounded-[28px] border border-white/10 bg-[#1A1D27] p-5 sm:p-7">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-[#A5A8B0]">Preview controls</p><h2 className="mt-1 font-[var(--font-display)] text-2xl tracking-[-0.035em] text-white">體驗評分邏輯</h2>
            <label className="mt-6 block text-xs font-medium text-[#B7B9C0]">示範情境</label>
            <div className="relative mt-2"><select value={scenarioKey} onChange={(event) => setScenarioKey(event.target.value as ScenarioKey)} className="w-full appearance-none rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-[#F3F0E9] outline-none transition focus:border-[#D9F37A]/60"><option value="current">平衡偏正面</option><option value="neutral">訊號分歧</option><option value="stress">壓力測試</option></select><ChevronDown className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9FA2AB]" /></div>
            <div className="mt-5 rounded-2xl border border-[#D9F37A]/20 bg-[#D9F37A]/[0.06] p-4"><div className="flex gap-3"><CircleHelp className="mt-0.5 h-4 w-4 shrink-0 text-[#D9F37A]" /><p className="text-xs leading-5 text-[#C7D2A1]">切換情境會重新加權五項因子，並同步更新總分、regime 與因子解釋。此控制項僅用於示範計分邏輯。</p></div></div>
            <div className="mt-5 flex items-center justify-between border-t border-white/10 pt-5"><span className="text-xs text-[#9FA2AB]">轉換確認規則</span><span className="rounded-full bg-white/[0.07] px-2.5 py-1 text-xs font-medium text-[#D9F37A]">連續 3 次更新</span></div>
          </div>
        </section>

        <section className="mb-6 rounded-[28px] border border-white/10 bg-[#161922] p-5 sm:p-7">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="text-xs font-medium uppercase tracking-[0.16em] text-[#A5A8B0]">Factor decomposition</p><h2 className="mt-1 font-[var(--font-display)] text-2xl tracking-[-0.035em] text-white">五項因子分解</h2></div><p className="text-xs text-[#838791]">按任何因子查看訊號、頻率與來源</p></div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {factors.map((factor) => {
              const Icon = factorIcons[factor.key];
              const active = selectedFactor === factor.key;
              return <button type="button" key={factor.key} onClick={() => setSelectedFactor(factor.key)} className={`min-h-[202px] rounded-2xl border p-4 text-left transition duration-200 ${active ? "border-[#D9F37A]/55 bg-[#20251B] shadow-[0_0_26px_rgba(217,243,122,.06)]" : "border-white/10 bg-white/[0.025] hover:border-white/25 hover:bg-white/[0.045]"}`}><div className="flex items-center justify-between"><span className="grid h-8 w-8 place-items-center rounded-lg bg-white/[0.07] text-[#D1D4DA]"><Icon className="h-4 w-4" /></span><span className="text-[11px] font-semibold text-[#8E929C]">{Math.round(factor.weight * 100)}%</span></div><p className="mt-4 text-sm text-[#C8CAD0]">{factor.name}</p><div className="mt-1 flex items-baseline gap-2"><span className={`font-[var(--font-display)] text-3xl tracking-[-0.04em] ${scoreTone(factor.score)}`}>{factor.score > 0 ? "+" : ""}{factor.score}</span><span className={`text-xs ${factor.score >= 0 ? "text-[#6CE2C2]" : "text-[#FF8F82]"}`}>{factor.delta} pts</span></div><div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full" style={{ width: `${Math.abs(factor.score)}%`, backgroundColor: scoreColor(factor.score) }} /></div><p className="mt-3 text-[11px] leading-4 text-[#848893]">{factor.frequency} · {factor.updatedAt}</p></button>;
            })}
          </div>
          <div className="mt-4 grid gap-4 rounded-2xl border border-white/10 bg-black/15 p-4 lg:grid-cols-[1.2fr_0.8fr] lg:items-center">
            <div><div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: scoreColor(selected.score) }} /><p className="text-sm font-semibold text-[#E4E1DA]">{selected.name} · <span className={scoreTone(selected.score)}>{selected.score > 0 ? "+" : ""}{selected.score}</span></p></div><p className="mt-2 text-sm leading-6 text-[#B0B3BB]">{selected.signal} {selected.description}</p></div>
            <a href={selected.sourceUrl} target="_blank" rel="noreferrer" className="group rounded-xl bg-white/[0.06] px-4 py-3 transition hover:bg-white/[0.1]"><div className="flex items-center gap-2 text-xs text-[#8D919B]"><Database className="h-3.5 w-3.5" /> 資料來源</div><div className="mt-1 flex items-center justify-between text-sm text-[#D9F37A]"><span>{selected.source}</span><ArrowUpRight className="h-4 w-4 transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5" /></div></a>
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-[0.92fr_1.08fr]">
          <div className="rounded-[28px] border border-white/10 bg-[#161922] p-5 sm:p-7"><div className="flex items-center justify-between"><div><p className="text-xs font-medium uppercase tracking-[0.16em] text-[#A5A8B0]">State changes</p><h2 className="mt-1 font-[var(--font-display)] text-2xl tracking-[-0.035em] text-white">Regime 切換紀錄</h2></div><LineChartIcon className="h-5 w-5 text-[#D9F37A]" /></div><div className="mt-6 space-y-5">{regimeHistory.map((entry, index) => <div className="relative flex gap-4" key={entry.date}>{index !== regimeHistory.length - 1 && <span className="absolute left-[7px] top-5 h-[calc(100%+12px)] w-px bg-white/10" />}<span className={`relative mt-1.5 h-3.5 w-3.5 shrink-0 rounded-full border-2 border-[#161922] ${entry.tone === "positive" ? "bg-[#6CE2C2]" : "bg-[#F1BE71]"}`} /><div><div className="flex flex-wrap items-center gap-2"><span className="text-sm font-semibold text-[#E5E3DD]">{entry.regime}</span><span className="text-[11px] text-[#7E828C]">{entry.date}</span></div><p className="mt-1 text-xs leading-5 text-[#A6A9B1]">{entry.detail}</p></div></div>)}</div></div>
          <div className="rounded-[28px] border border-white/10 bg-[#1A1D27] p-5 sm:p-7"><div className="flex items-center justify-between"><div><p className="text-xs font-medium uppercase tracking-[0.16em] text-[#A5A8B0]">Data integrity</p><h2 className="mt-1 font-[var(--font-display)] text-2xl tracking-[-0.035em] text-white">資料新鮮度與披露</h2></div><BarChart3 className="h-5 w-5 text-[#D9F37A]" /></div><div className="mt-5 space-y-3">{factors.map((factor) => <div className="flex items-center justify-between gap-4 rounded-xl bg-black/15 px-4 py-3" key={factor.key}><div className="min-w-0"><p className="truncate text-sm text-[#DEDDD7]">{factor.shortName}</p><p className="mt-0.5 text-[11px] text-[#858994]">{factor.source}</p></div><div className="shrink-0 text-right"><p className={`text-xs font-semibold ${factor.frequency === "分鐘級" ? "text-[#6CE2C2]" : "text-[#F1BE71]"}`}>{factor.frequency}</p><p className="mt-0.5 text-[11px] text-[#858994]">{factor.updatedAt}</p></div></div>)}</div><div className="mt-4 flex gap-3 rounded-xl border border-white/10 bg-white/[0.025] p-3"><BadgeInfo className="mt-0.5 h-4 w-4 shrink-0 text-[#D9F37A]" /><p className="text-[11px] leading-5 text-[#979BA5]">本頁為功能與計算邏輯原型。Cboe VIX 與 FRED／ICE BofA HY OAS 的來源連結已列出；其餘指標以清楚標示的示範籃子呈現，並非即時交易或投資建議。</p></div></div>
        </section>
      </main>
    </div>
  );
}
