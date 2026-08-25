import { useMemo, useState } from "react";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  BadgeInfo,
  BarChart3,
  CheckCircle2,
  Clock3,
  Database,
  Globe2,
  Layers3,
  LineChart as LineChartIcon,
  RefreshCw,
  ShieldAlert,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { trpc } from "@/lib/trpc";
import type { LiveMarketFactor, MarketFactorKey } from "../../../shared/marketTypes";

const factorIcons: Record<MarketFactorKey, typeof TrendingUp> = {
  equity: TrendingUp,
  volatility: Activity,
  credit: ShieldAlert,
  safeHaven: Globe2,
  crossAsset: BarChart3,
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

function freshnessLabel(freshness: LiveMarketFactor["freshness"]) {
  if (freshness === "fresh") return "最新";
  if (freshness === "delayed") return "延遲";
  if (freshness === "stale") return "最近成功值";
  return "不可用";
}

function formatTimestamp(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("zh-HK", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
    timeZone: "America/New_York",
  }).format(parsed) + " ET";
}

function factorSummary(factors: LiveMarketFactor[]) {
  const strongest = factors.filter((factor) => factor.freshness !== "unavailable").sort((a, b) => b.score - a.score).slice(0, 2);
  const weakest = factors.filter((factor) => factor.freshness !== "unavailable").sort((a, b) => a.score - b.score).slice(0, 1);
  return { strongest, weakest };
}

function LoadingState() {
  return <div className="min-h-screen bg-[#11131A] text-[#F3F0E9]"><main className="mx-auto max-w-[1480px] px-4 py-6 sm:px-7 lg:px-10"><div className="animate-pulse"><div className="h-14 w-64 rounded-2xl bg-white/[0.07]" /><div className="mt-8 h-64 rounded-[28px] bg-white/[0.05]" /><div className="mt-5 grid gap-4 lg:grid-cols-2"><div className="h-72 rounded-[28px] bg-white/[0.05]" /><div className="h-72 rounded-[28px] bg-white/[0.05]" /></div></div></main></div>;
}

export default function Home() {
  const [selectedFactor, setSelectedFactor] = useState<MarketFactorKey>("equity");
  const marketQuery = trpc.marketRegime.current.useQuery(undefined, {
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    retry: 1,
  });
  const refreshMutation = trpc.marketRegime.refresh.useMutation({
    onSuccess: () => marketQuery.refetch(),
  });

  const snapshot = marketQuery.data?.snapshot;
  const history = marketQuery.data?.history ?? [];
  const trend = useMemo(() => history.slice(-48).map((point) => ({
    time: formatTimestamp(point.calculatedAt).replace(" ET", ""),
    score: point.compositeScore,
  })), [history]);

  if (marketQuery.isLoading && !snapshot) return <LoadingState />;
  if (!snapshot) {
    return <div className="grid min-h-screen place-items-center bg-[#11131A] p-6 text-[#F3F0E9]"><div className="max-w-md rounded-[28px] border border-[#FF8F82]/30 bg-[#1A1D27] p-7"><TriangleAlert className="h-7 w-7 text-[#FF8F82]" /><h1 className="mt-4 font-[var(--font-display)] text-3xl">暫未能取得市場資料</h1><p className="mt-3 text-sm leading-6 text-[#AAADB6]">{marketQuery.error?.message ?? "資料服務正在重試。請稍後重新整理。"}</p><button type="button" onClick={() => marketQuery.refetch()} className="mt-6 rounded-xl bg-[#D9F37A] px-4 py-2.5 text-sm font-semibold text-[#15180E]">重新連線</button></div></div>;
  }

  const selected = snapshot.factors.find((factor) => factor.key === selectedFactor) ?? snapshot.factors[0];
  const { strongest, weakest } = factorSummary(snapshot.factors);
  const previousScore = history.length >= 2 ? history.at(-2)?.compositeScore : null;
  const shortChange = previousScore === null || previousScore === undefined ? null : snapshot.compositeScore - previousScore;
  const staleCount = snapshot.factors.filter((factor) => factor.freshness === "stale" || factor.freshness === "unavailable").length;

  return (
    <div className="min-h-screen overflow-x-hidden bg-[#11131A] text-[#F3F0E9] selection:bg-[#D9F37A] selection:text-[#10120E]">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_12%_0%,rgba(217,243,122,0.12),transparent_24rem),radial-gradient(circle_at_88%_24%,rgba(122,153,243,0.12),transparent_28rem)]" />
      <main className="relative mx-auto max-w-[1480px] px-4 pb-10 pt-5 sm:px-7 lg:px-10 lg:pt-7">
        <header className="mb-8 flex flex-col gap-5 border-b border-white/10 pb-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4">
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-[#D9F37A] text-[#15180E] shadow-[0_0_32px_rgba(217,243,122,0.16)]"><Layers3 className="h-5 w-5" strokeWidth={2.5} /></div>
            <div><div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-[#A5A8B0]">Market Regime <span className="h-1.5 w-1.5 rounded-full bg-[#6CE2C2]" /> Live data engine</div><h1 className="mt-1 font-[var(--font-display)] text-xl tracking-[-0.03em] text-white sm:text-2xl">市場風險狀態</h1></div>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <div className={`flex items-center gap-2 rounded-full border px-3 py-2 ${snapshot.dataStatus === "fresh" ? "border-[#6CE2C2]/25 bg-[#6CE2C2]/[0.06] text-[#A8DAD0]" : "border-[#F1BE71]/25 bg-[#F1BE71]/[0.06] text-[#E7C993]"}`}><Database className="h-3.5 w-3.5" /> {snapshot.dataStatus === "fresh" ? "所有資料來源可用" : "已採用最近成功值備援"}</div>
            <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.035] px-3 py-2 text-[#C5C7CD]"><Clock3 className="h-3.5 w-3.5 text-[#D9F37A]" /> 計算於 {formatTimestamp(snapshot.calculatedAt)}</div>
            <button type="button" onClick={() => refreshMutation.mutate()} disabled={refreshMutation.isPending} className="inline-flex items-center gap-2 rounded-full bg-[#D9F37A] px-3 py-2 font-semibold text-[#17190F] transition hover:bg-[#e7fa9b] disabled:cursor-wait disabled:opacity-60"><RefreshCw className={`h-3.5 w-3.5 ${refreshMutation.isPending ? "animate-spin" : ""}`} /> {refreshMutation.isPending ? "更新中" : "立即刷新"}</button>
          </div>
        </header>

        {snapshot.dataStatus === "partial" && <div className="mb-5 flex gap-3 rounded-2xl border border-[#F1BE71]/20 bg-[#F1BE71]/[0.07] p-4"><TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-[#F1BE71]" /><p className="text-xs leading-5 text-[#E7C993]">目前有 {staleCount} 個來源延遲或逾時；程式正保留最近成功值，避免以空值覆蓋結論，置信度已相應下調。</p></div>}

        <section className="mb-6 grid gap-4 xl:grid-cols-[1.18fr_0.82fr]">
          <div className="relative overflow-hidden rounded-[28px] border border-white/10 bg-[#1A1D27] p-5 sm:p-7"><div className="absolute -right-14 -top-20 h-56 w-56 rounded-full bg-[#D9F37A]/10 blur-3xl" /><div className="relative flex flex-col justify-between gap-7 sm:flex-row sm:items-end"><div><p className="text-xs font-medium uppercase tracking-[0.16em] text-[#A5A8B0]">Composite regime score</p><div className="mt-2 flex items-end gap-4"><span className={`font-[var(--font-display)] text-[82px] font-medium leading-[0.82] tracking-[-0.08em] sm:text-[108px] ${scoreTone(snapshot.compositeScore)}`}>{snapshot.compositeScore > 0 ? "+" : ""}{snapshot.compositeScore}</span><div className="mb-2.5"><span className={`inline-flex rounded-full px-3 py-1 text-xs font-bold uppercase tracking-[0.14em] ${snapshot.regime === "Risk-on" ? "bg-[#6CE2C2]/15 text-[#6CE2C2]" : snapshot.regime === "Risk-off" ? "bg-[#FF8F82]/15 text-[#FF8F82]" : "bg-[#F1BE71]/15 text-[#F1BE71]"}`}>{snapshot.regime}</span><p className="mt-2 text-xs text-[#A5A8B0]">由 −100 至 +100</p></div></div></div><div className="min-w-[215px] rounded-2xl border border-white/10 bg-black/15 p-4 backdrop-blur-sm"><div className="flex items-center justify-between text-xs text-[#B9BBC2]"><span>置信度</span><span className="font-semibold text-[#F3F0E9]">{snapshot.confidence}%</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-[#D9F37A]" style={{ width: `${snapshot.confidence}%` }} /></div><p className="mt-3 text-xs leading-5 text-[#A5A8B0]">以可用因子的一致性及覆蓋率計算。</p></div></div><div className="relative mt-7 flex flex-wrap gap-x-7 gap-y-3 border-t border-white/10 pt-4 text-xs"><span className="flex items-center gap-2 text-[#B6B8BF]">{shortChange === null ? <Clock3 className="h-3.5 w-3.5 text-[#D9F37A]" /> : shortChange >= 0 ? <ArrowUpRight className="h-3.5 w-3.5 text-[#6CE2C2]" /> : <ArrowDownRight className="h-3.5 w-3.5 text-[#FF8F82]" />}{shortChange === null ? "首次保存市場快照" : `${shortChange > 0 ? "+" : ""}${shortChange} pts vs. 上次刷新`}</span><span className="flex items-center gap-2 text-[#B6B8BF]"><Activity className="h-3.5 w-3.5 text-[#D9F37A]" /> 網頁開啟時每 60 秒自動讀取最新結論</span></div></div>
          <div className="rounded-[28px] border border-white/10 bg-[#161922] p-5 sm:p-7"><div className="flex items-center justify-between"><div><p className="text-xs font-medium uppercase tracking-[0.16em] text-[#A5A8B0]">Quick read</p><h2 className="mt-1 font-[var(--font-display)] text-2xl tracking-[-0.035em] text-white">此刻由甚麼驅動？</h2></div><BadgeInfo className="h-5 w-5 text-[#D9F37A]" /></div><div className="mt-5 space-y-3">{strongest.map((factor, index) => <button type="button" onClick={() => setSelectedFactor(factor.key)} className="flex w-full items-center justify-between rounded-2xl bg-white/[0.035] px-4 py-3 text-left transition hover:bg-white/[0.07]" key={factor.key}><span className="flex items-center gap-3"><span className="grid h-6 w-6 place-items-center rounded-full bg-[#6CE2C2]/10 text-xs font-bold text-[#6CE2C2]">{index + 1}</span><span className="text-sm text-[#E1DFD8]">{factor.name}</span></span><span className="font-[var(--font-display)] text-lg text-[#6CE2C2]">+{factor.score}</span></button>)}{weakest.map((factor) => <button type="button" onClick={() => setSelectedFactor(factor.key)} className="flex w-full items-center justify-between rounded-2xl bg-white/[0.035] px-4 py-3 text-left transition hover:bg-white/[0.07]" key={factor.key}><span className="flex items-center gap-3"><span className="grid h-6 w-6 place-items-center rounded-full bg-[#FF8F82]/10 text-xs font-bold text-[#FF8F82]"><TrendingDown className="h-3.5 w-3.5" /></span><span className="text-sm text-[#E1DFD8]">需要留意：{factor.name}</span></span><span className="font-[var(--font-display)] text-lg text-[#FF8F82]">{factor.score}</span></button>)}</div><p className="mt-4 text-xs leading-5 text-[#969AA4]">點按因子可在下方查看更新時間、資料來源及計分說明。</p></div>
        </section>

        <section className="mb-6 grid gap-4 xl:grid-cols-[1.42fr_0.58fr]">
          <div className="rounded-[28px] border border-white/10 bg-[#161922] p-5 sm:p-7"><div className="flex items-start justify-between"><div><p className="text-xs font-medium uppercase tracking-[0.16em] text-[#A5A8B0]">Persisted history</p><h2 className="mt-1 font-[var(--font-display)] text-2xl tracking-[-0.035em] text-white">實際分數走勢</h2></div><span className="rounded-full bg-white/[0.06] px-3 py-1.5 text-xs text-[#B4B7BF]">{history.length} 個快照</span></div><div className="mt-5 h-[230px] sm:h-[270px]">{trend.length > 1 ? <ResponsiveContainer width="100%" height="100%"><AreaChart data={trend} margin={{ top: 10, right: 4, left: -26, bottom: 0 }}><defs><linearGradient id="scoreFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#D9F37A" stopOpacity={0.32} /><stop offset="100%" stopColor="#D9F37A" stopOpacity={0} /></linearGradient></defs><CartesianGrid stroke="#FFFFFF" strokeOpacity={0.07} vertical={false} /><XAxis type="category" dataKey="time" axisLine={false} tickLine={false} minTickGap={32} tick={{ fill: "#777B85", fontSize: 11 }} dy={12} /><YAxis domain={[-100, 100]} ticks={[-50, 0, 50]} axisLine={false} tickLine={false} tick={{ fill: "#777B85", fontSize: 11 }} /><Tooltip cursor={{ stroke: "#D9F37A", strokeOpacity: 0.28 }} contentStyle={{ background: "#202430", border: "1px solid rgba(255,255,255,.12)", borderRadius: 12, color: "#F3F0E9", fontSize: 12 }} formatter={(value: number) => [`${value > 0 ? "+" : ""}${value}`, "Composite score"]} /><Area type="monotone" dataKey="score" stroke="#D9F37A" strokeWidth={2.5} fill="url(#scoreFill)" /></AreaChart></ResponsiveContainer> : <div className="grid h-full place-items-center rounded-2xl border border-dashed border-white/10 text-center"><div><LineChartIcon className="mx-auto h-6 w-6 text-[#D9F37A]" /><p className="mt-3 text-sm text-[#C8CAD0]">正在累積實際市場快照</p><p className="mt-1 text-xs text-[#858994]">下一次刷新後會開始形成走勢。</p></div></div>}</div><div className="mt-4 flex flex-wrap gap-3 text-xs text-[#9FA2AB]"><span className="inline-flex items-center gap-2"><i className="h-2 w-2 rounded-full bg-[#D9F37A]" /> 儲存後的 composite score</span><span className="inline-flex items-center gap-2"><i className="h-px w-5 bg-[#858991]" /> 0 = 中性</span></div></div>
          <div className="rounded-[28px] border border-white/10 bg-[#1A1D27] p-5 sm:p-7"><p className="text-xs font-medium uppercase tracking-[0.16em] text-[#A5A8B0]">Update policy</p><h2 className="mt-1 font-[var(--font-display)] text-2xl tracking-[-0.035em] text-white">資料如何更新</h2><div className="mt-6 space-y-4"><div className="rounded-2xl border border-white/10 bg-black/15 p-4"><div className="flex items-center justify-between"><span className="text-sm text-[#E4E1DA]">網頁資料刷新</span><span className="rounded-full bg-[#6CE2C2]/10 px-2.5 py-1 text-xs font-semibold text-[#6CE2C2]">每 60 秒</span></div><p className="mt-2 text-xs leading-5 text-[#969AA4]">頁面開啟時會自動重新讀取當前結論；你也可使用右上方立即刷新。</p></div><div className="rounded-2xl border border-white/10 bg-black/15 p-4"><div className="flex items-center justify-between"><span className="text-sm text-[#E4E1DA]">市場來源頻率</span><span className="text-xs text-[#F1BE71]">因來源而異</span></div><p className="mt-2 text-xs leading-5 text-[#969AA4]">NDX 為延遲報價、比特幣為分鐘級資料；VIX、信貸利差及美元指數屬日終資料。每個因子均保留自身時間戳。</p></div><div className="flex gap-3 rounded-2xl border border-[#D9F37A]/20 bg-[#D9F37A]/[0.06] p-4"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#D9F37A]" /><p className="text-xs leading-5 text-[#C7D2A1]">若任何來源無回應，程式會將該因子標示為不可用並降低置信度，不會沿用示範數字。</p></div></div></div>
        </section>

        <section className="mb-6 rounded-[28px] border border-white/10 bg-[#161922] p-5 sm:p-7"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="text-xs font-medium uppercase tracking-[0.16em] text-[#A5A8B0]">Live factor decomposition</p><h2 className="mt-1 font-[var(--font-display)] text-2xl tracking-[-0.035em] text-white">五項實際因子分解</h2></div><p className="text-xs text-[#838791]">點按因子查看即時狀態、來源及計分基礎</p></div><div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{snapshot.factors.map((factor) => { const Icon = factorIcons[factor.key]; const active = selectedFactor === factor.key; return <button type="button" key={factor.key} onClick={() => setSelectedFactor(factor.key)} className={`min-h-[218px] rounded-2xl border p-4 text-left transition duration-200 ${active ? "border-[#D9F37A]/55 bg-[#20251B] shadow-[0_0_26px_rgba(217,243,122,.06)]" : "border-white/10 bg-white/[0.025] hover:border-white/25 hover:bg-white/[0.045]"}`}><div className="flex items-center justify-between"><span className="grid h-8 w-8 place-items-center rounded-lg bg-white/[0.07] text-[#D1D4DA]"><Icon className="h-4 w-4" /></span><span className="text-[11px] font-semibold text-[#8E929C]">{Math.round(factor.weight * 100)}%</span></div><p className="mt-4 text-sm text-[#C8CAD0]">{factor.name}</p><div className="mt-1 flex items-baseline gap-2"><span className={`font-[var(--font-display)] text-3xl tracking-[-0.04em] ${scoreTone(factor.score)}`}>{factor.score > 0 ? "+" : ""}{factor.score}</span><span className={`text-[11px] font-semibold ${factor.freshness === "fresh" ? "text-[#6CE2C2]" : factor.freshness === "unavailable" ? "text-[#FF8F82]" : "text-[#F1BE71]"}`}>{freshnessLabel(factor.freshness)}</span></div><div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full" style={{ width: `${Math.abs(factor.score)}%`, backgroundColor: scoreColor(factor.score) }} /></div><p className="mt-3 truncate text-[11px] text-[#848893]">{factor.frequency} · {formatTimestamp(factor.updatedAt)}</p></button>})}</div><div className="mt-4 grid gap-4 rounded-2xl border border-white/10 bg-black/15 p-4 lg:grid-cols-[1.2fr_0.8fr] lg:items-center"><div><div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: scoreColor(selected.score) }} /><p className="text-sm font-semibold text-[#E4E1DA]">{selected.name} · <span className={scoreTone(selected.score)}>{selected.score > 0 ? "+" : ""}{selected.score}</span></p></div><p className="mt-2 text-sm leading-6 text-[#B0B3BB]">{selected.signal} {selected.explanation}</p></div><a href={selected.sourceUrl} target="_blank" rel="noreferrer" className="group rounded-xl bg-white/[0.06] px-4 py-3 transition hover:bg-white/[0.1]"><div className="flex items-center gap-2 text-xs text-[#8D919B]"><Database className="h-3.5 w-3.5" /> 資料來源 · {selected.frequency}</div><div className="mt-1 flex items-center justify-between text-sm text-[#D9F37A]"><span>{selected.source}</span><ArrowUpRight className="h-4 w-4 transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5" /></div></a></div></section>

        <section className="grid gap-4 xl:grid-cols-[0.92fr_1.08fr]"><div className="rounded-[28px] border border-white/10 bg-[#161922] p-5 sm:p-7"><div className="flex items-center justify-between"><div><p className="text-xs font-medium uppercase tracking-[0.16em] text-[#A5A8B0]">Snapshot log</p><h2 className="mt-1 font-[var(--font-display)] text-2xl tracking-[-0.035em] text-white">最近結論紀錄</h2></div><LineChartIcon className="h-5 w-5 text-[#D9F37A]" /></div><div className="mt-6 space-y-5">{history.slice(-5).reverse().map((entry, index) => <div className="relative flex gap-4" key={`${entry.calculatedAt}-${index}`}>{index !== Math.min(history.length, 5) - 1 && <span className="absolute left-[7px] top-5 h-[calc(100%+12px)] w-px bg-white/10" />}<span className={`relative mt-1.5 h-3.5 w-3.5 shrink-0 rounded-full border-2 border-[#161922] ${entry.regime === "Risk-on" ? "bg-[#6CE2C2]" : entry.regime === "Risk-off" ? "bg-[#FF8F82]" : "bg-[#F1BE71]"}`} /><div><div className="flex flex-wrap items-center gap-2"><span className="text-sm font-semibold text-[#E5E3DD]">{entry.regime} · {entry.compositeScore > 0 ? "+" : ""}{entry.compositeScore}</span><span className="text-[11px] text-[#7E828C]">{formatTimestamp(entry.calculatedAt)}</span></div><p className="mt-1 text-xs leading-5 text-[#A6A9B1]">置信度 {entry.confidence}% · {entry.dataStatus === "fresh" ? "完整資料覆蓋" : "部分資料覆蓋"}</p></div></div>)}{history.length === 0 && <p className="text-sm text-[#969AA4]">尚未保存紀錄。</p>}</div></div><div className="rounded-[28px] border border-white/10 bg-[#1A1D27] p-5 sm:p-7"><div className="flex items-center justify-between"><div><p className="text-xs font-medium uppercase tracking-[0.16em] text-[#A5A8B0]">Data integrity</p><h2 className="mt-1 font-[var(--font-display)] text-2xl tracking-[-0.035em] text-white">資料新鮮度與披露</h2></div><BarChart3 className="h-5 w-5 text-[#D9F37A]" /></div><div className="mt-5 space-y-3">{snapshot.factors.map((factor) => <div className="flex items-center justify-between gap-4 rounded-xl bg-black/15 px-4 py-3" key={factor.key}><div className="min-w-0"><p className="truncate text-sm text-[#DEDDD7]">{factor.shortName}</p><p className="mt-0.5 truncate text-[11px] text-[#858994]">{factor.latestValue} · {factor.source}</p></div><div className="shrink-0 text-right"><p className={`text-xs font-semibold ${factor.freshness === "fresh" ? "text-[#6CE2C2]" : factor.freshness === "unavailable" ? "text-[#FF8F82]" : "text-[#F1BE71]"}`}>{factor.frequency} · {freshnessLabel(factor.freshness)}</p><p className="mt-0.5 text-[11px] text-[#858994]">{formatTimestamp(factor.updatedAt)}</p></div></div>)}</div><div className="mt-4 flex gap-3 rounded-xl border border-white/10 bg-white/[0.025] p-3"><BadgeInfo className="mt-0.5 h-4 w-4 shrink-0 text-[#D9F37A]" /><p className="text-[11px] leading-5 text-[#979BA5]">本頁顯示自動取得的市場資料與可追溯來源。綜合分數是規則式風險偏好代理，並非對任何資產的買賣建議。</p></div></div></section>
      </main>
    </div>
  );
}
