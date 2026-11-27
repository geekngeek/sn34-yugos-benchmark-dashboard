"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { MultiChartData, Series } from "@/lib/multiChart";
import { ModelPicker } from "@/components/ModelPicker";
import { Stars } from "@/components/Stars";
import { ArchiveButton } from "@/components/Archive";
import { difficultyText } from "@/lib/difficulty";
import { LAB_ORDER, LAB_SLOT, LOW, LOW_LABEL } from "@/components/TradeoffChart";
import { AXIS_ORDER, METRICS, defaultAxes, value, type ChartPoint, type MetricKey } from "@/lib/chartMetrics";
import { autoDomain, scale, zoomDom, type Dom } from "@/lib/chartScale";
import { placeLabels, type LabelIn } from "@/lib/labelPlace";
import { keyClick, keyClickHint } from "@/lib/keyToggle";
import { MatchBars } from "@/components/Match";
import { qOne, useQuerySync, type Query } from "@/lib/urlState";

/**
 * The Benchmark list's combined chart: every benchmark the list's filters leave (sub-benchmarks when a topic or
 * difficulty filter is on, else each benchmark's overall table) in one quality-vs-X chart, nothing averaged.
 * Each benchmark has its own shape (and colour, by default); a model configuration's points on the different
 * benchmarks are joined by a grey "spread" line, so its best and worst benchmark read at a glance. Faint
 * benchmark lines join one benchmark's points across models; effort lines join a model's efforts on one
 * benchmark. "One per benchmark" draws small multiples instead (shared Y). Nothing is fetched until Draw.
 * Settings live in the URL (mc=1 redraws on load, mcx, mcy, mclx, mcly, mccolor, mclines, mclayout, mchide,
 * mcgrey, mcmodels).
 */

type ColorBy = "benchmark" | "developer" | "yugos" | "effort" | "none";
type LineKind = "spread" | "curves" | "efforts";
interface Candidate { no: string; name: string }

const H = 500;
const M = { top: 18, right: 150, bottom: 52, left: 64 };
const GM = { top: 10, right: 16, bottom: 40, left: 52 };     // small-multiple margins
const RANK_STEP = ["0", "1", "2", "3", "4", "5", "6"];
const EFFORT_LABEL: Record<string, string> = { none: "Non-reasoning", minimal: "Minimal", low: "Low", medium: "Medium",
  high: "High", xhigh: "Xhigh", max: "Max", enabled: "Reasoning" };
const variant = (p: ChartPoint) =>
  [p.reasoning_effort === null ? "Default" : EFFORT_LABEL[p.reasoning_effort] ?? p.reasoning_effort, p.mode].filter(Boolean).join(" · ");
/** X axes where a frontier makes sense: 1 = lower is better (price, time, tokens), -1 = higher is better (speed) */
const FRONTIER_X: Partial<Record<MetricKey, 1 | -1>> = { cost_per_task: 1, time_per_task: 1, ttft: 1, output_tokens: 1, output_price: 1, input_price: 1, tokens_per_sec: -1 };
/** on this chart "quality" is the comparable 0–100 score: lower-is-better and raw scales are left out */
const val = (p: ChartPoint, k: MetricKey): number | null => (k === "quality" ? p.sort_score : value(p, k));

// ---- benchmark shapes: 8 shapes x 8 colours, so up to 64 benchmarks stay distinct -------------------------
const SHAPES = ["circle", "square", "triangle", "diamond", "down", "plus", "star", "hexagon"] as const;
const shapeOf = (i: number) => SHAPES[i % 8];
const slotOf = (i: number) => ((i + Math.floor(i / 8)) % 8) + 1;
function poly(n: number, r: number, rot: number, inner?: number) {
  const pts: string[] = [];
  const k = inner ? n * 2 : n;
  for (let j = 0; j < k; j++) {
    const rr = inner && j % 2 ? inner : r, a = rot + (j * 2 * Math.PI) / k;
    pts.push(`${(Math.cos(a) * rr).toFixed(2)},${(Math.sin(a) * rr).toFixed(2)}`);
  }
  return pts.join(" ");
}
function Shape({ shape, x, y, r, className, style }: { shape: (typeof SHAPES)[number]; x: number; y: number; r: number; className?: string; style?: React.CSSProperties }) {
  const t = `translate(${x} ${y})`;
  switch (shape) {
    case "circle": return <circle cx={x} cy={y} r={r} className={className} style={style} />;
    case "square": return <rect x={x - r * 0.86} y={y - r * 0.86} width={r * 1.72} height={r * 1.72} className={className} style={style} />;
    case "triangle": return <polygon transform={t} points={poly(3, r * 1.25, -Math.PI / 2)} className={className} style={style} />;
    case "down": return <polygon transform={t} points={poly(3, r * 1.25, Math.PI / 2)} className={className} style={style} />;
    case "diamond": return <polygon transform={t} points={poly(4, r * 1.2, 0)} className={className} style={style} />;
    case "hexagon": return <polygon transform={t} points={poly(6, r * 1.05, 0)} className={className} style={style} />;
    case "star": return <polygon transform={t} points={poly(5, r * 1.35, -Math.PI / 2, r * 0.6)} className={className} style={style} />;
    case "plus": {
      const a = r * 1.15, b = r * 0.42;
      return <polygon transform={t} points={`${-b},${-a} ${b},${-a} ${b},${-b} ${a},${-b} ${a},${b} ${b},${b} ${b},${a} ${-b},${a} ${-b},${b} ${-a},${b} ${-a},${-b} ${-b},${-b}`} className={className} style={style} />;
    }
  }
}
function ShapeIcon({ i, color }: { i: number; color: string }) {
  return <svg width="14" height="14" aria-hidden="true" className="mc-icon"><Shape shape={shapeOf(i)} x={7} y={7} r={4.6} className="tc-dot" style={{ ["--c" as string]: color, strokeWidth: 1 }} /></svg>;
}

export function MultiBenchmarkChart({ candidates, scopeNote, query, filterBar, onArchive }: {
  candidates: Candidate[]; scopeNote: string; query?: Query; filterBar?: ReactNode;
  onArchive?: (nos: string[]) => void;   // archive the list rows a panel stands for (the list asks to confirm)
}) {
  // settings: from the URL, written back once something is drawn
  const [x, setX] = useState<MetricKey | null>(() => ((AXIS_ORDER as string[]).includes(qOne(query, "mcx")) ? qOne(query, "mcx") as MetricKey : null));
  const [y, setY] = useState<MetricKey>(() => ((AXIS_ORDER as string[]).includes(qOne(query, "mcy")) ? qOne(query, "mcy") as MetricKey : "quality"));
  const [lx, setLx] = useState<string>(() => qOne(query, "mclx"));       // "1" / "0" / "" = the metric's default
  const [ly, setLy] = useState<string>(() => qOne(query, "mcly"));
  const [colorBy, setColorBy] = useState<ColorBy>(() => (["benchmark", "developer", "yugos", "effort", "none"].includes(qOne(query, "mccolor")) ? qOne(query, "mccolor") : "benchmark") as ColorBy);
  const [lines, setLines] = useState<Set<LineKind>>(() => new Set((qOne(query, "mclines") || "spread,curves").split(",").filter((l): l is LineKind => ["spread", "curves", "efforts"].includes(l))));
  const [layout, setLayout] = useState<"one" | "grid">(() => (qOne(query, "mclayout") === "grid" ? "grid" : "one"));
  const [showLabels, setShowLabels] = useState(() => qOne(query, "mclabels") === "1");   // off by default: labels only on frontiers and the hovered model
  const [outline, setOutline] = useState(() => qOne(query, "mcoutline") !== "0");        // labels outlined in the developer's colour
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(qOne(query, "mchide").split(",").filter(Boolean)));
  const [grey, setGrey] = useState<string[]>(() => qOne(query, "mcgrey").split(",").filter(Boolean));
  // developers greyed out in the outline key (when the dots are coloured by something else), as on a benchmark's page
  const [devOff, setDevOff] = useState<string[]>(() => qOne(query, "mcdev").split(",").filter(Boolean));
  const [models, setModels] = useState<string[] | null>(() => (qOne(query, "mcmodels") ? qOne(query, "mcmodels").split(",").filter(Boolean) : null));

  const [data, setData] = useState<MultiChartData | null>(null);
  const [drawnNos, setDrawnNos] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [custom, setCustom] = useState<Record<string, string>>({});

  const fetchData = useCallback(async (nos: string[], sel: string[] | null) => {
    setLoading(true); setError("");
    try {
      const r = await fetch("/api/multi-chart", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ nos, models: sel }) });
      if (!r.ok) throw new Error(`${r.status}`);
      const d = (await r.json()) as MultiChartData;
      setData(d); setDrawnNos(nos); setCustom(d.customColors);
    } catch {
      setError("The chart data could not be loaded (API unreachable?).");
    } finally { setLoading(false); }
  }, []);
  const draw = () => fetchData(candidates.map((c) => c.no), models);
  // a link with mc=1 draws straight away, from the filters in the same link
  const auto = useRef(qOne(query, "mc") === "1");
  useEffect(() => { if (auto.current && candidates.length) { auto.current = false; draw(); } });   // eslint-disable-line react-hooks/exhaustive-deps
  const pickModels = (sel: string[] | null) => { setModels(sel); if (drawnNos) fetchData(drawnNos, sel); };

  const drawn = data !== null;
  useQuerySync({
    mc: drawn, mcx: drawn && x ? x : null, mcy: drawn && y !== "quality" ? y : null, mclx: drawn ? lx : null, mcly: drawn ? ly : null,
    mccolor: drawn && colorBy !== "benchmark" ? colorBy : null, mclines: drawn && [...lines].sort().join(",") !== "curves,spread" ? [...lines].join(",") || "none" : null,
    mclayout: drawn && layout === "grid" ? "grid" : null, mclabels: drawn && showLabels ? "1" : null, mcoutline: drawn && !outline ? "0" : null, mchide: drawn ? [...hidden].join(",") : null, mcgrey: drawn ? grey.join(",") : null, mcdev: drawn ? devOff.join(",") : null,
    mcmodels: drawn && models ? models.join(",") || "none" : null,
  });
  // once drawn, the chart follows the list: a change of filters or order redraws it after a short pause
  const wantKey = candidates.map((c) => c.no).join("|");
  const stale = drawnNos !== null && drawnNos.join("|") !== wantKey;
  useEffect(() => {
    if (!stale || !candidates.length) return;
    const t = setTimeout(() => fetchData(candidates.map((c) => c.no), models), 450);
    return () => clearTimeout(t);
  }, [wantKey, stale]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section className="card mc" aria-labelledby="mc-title">
      <div className="mc-head">
        <div>
          <h2 id="mc-title">Combined chart</h2>
          <p className="muted small">
            {candidates.length
              ? <>The current filters leave <b>{candidates.length}</b> {scopeNote}. {drawn ? "The chart follows the filters and order below as you change them" : "Draw puts every one of them in one chart"}: each benchmark keeps its own score, nothing is averaged.</>
              : "The current filters leave no benchmarks."}
          </p>
        </div>
        <div className="mc-draw">
          {stale && candidates.length > 0 && <span className="small mc-stale">Updating…</span>}
          <button type="button" className="button primary" onClick={draw} disabled={!candidates.length || loading}>
            {loading ? "Loading…" : drawn ? "Redraw" : "Draw"}
          </button>
        </div>
      </div>
      {filterBar && <div className="mc-filterbar">{filterBar}</div>}
      {error && <p className="empty">{error}</p>}
      {data && (
        <Chart onArchive={onArchive ? (nos) => { const on = new Set(candidates.map((c) => c.no)); onArchive(nos.filter((n) => on.has(n))); } : undefined} data={data} x={x} y={y} lx={lx} ly={ly} colorBy={colorBy} lines={lines} layout={layout} hidden={hidden} grey={grey} devOff={devOff}
               custom={custom} setCustom={setCustom} busy={loading}
               showLabels={showLabels} outline={outline} set={{ setX, setY, setLx, setLy, setColorBy, setLines, setLayout, setHidden, setGrey, setShowLabels, setOutline, setDevOff }}
               picker={data.configs.length > 0 && (
                 <ModelPicker configs={data.configs} selected={data.selected} defaults={data.defaults} defaultNote={data.defaultNote}
                              yugos={data.yugos} onApply={pickModels} />
               )} />
      )}
    </section>
  );
}

interface Setters {
  setX: (v: MetricKey | null) => void; setY: (v: MetricKey) => void; setLx: (v: string) => void; setLy: (v: string) => void;
  setColorBy: (v: ColorBy) => void; setLines: (v: Set<LineKind>) => void; setLayout: (v: "one" | "grid") => void;
  setHidden: (v: Set<string>) => void; setGrey: (v: string[]) => void; setShowLabels: (v: boolean) => void; setOutline: (v: boolean) => void; setDevOff: (v: string[]) => void;
}
interface Hover { p: ChartPoint; px: number; py: number; panel: string }

function Chart({ data, x: xSet, y, lx, ly, colorBy, lines, layout, hidden, grey, devOff, custom, setCustom, busy, set, picker, showLabels, outline, onArchive }: {
  onArchive?: (nos: string[]) => void;
  data: MultiChartData; x: MetricKey | null; y: MetricKey; lx: string; ly: string; colorBy: ColorBy; lines: Set<LineKind>;
  layout: "one" | "grid"; hidden: Set<string>; grey: string[]; devOff: string[]; custom: Record<string, string>; showLabels: boolean; outline: boolean;
  setCustom: (f: (c: Record<string, string>) => Record<string, string>) => void; busy: boolean; set: Setters; picker: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(900);
  // hovering a dot only highlights its configuration; clicking pins its details card (click again, elsewhere or Esc closes)
  const [hover, setHover] = useState<Hover | null>(null);
  const [pinned, setPinned] = useState<Hover | null>(null);
  const em = hover ?? pinned;
  // the pinned card closes on Esc or a click anywhere but a dot (a dot's own click opens, switches or closes it)
  useEffect(() => {
    if (!pinned) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setPinned(null); } };
    const down = (e: PointerEvent) => { if (!(e.target as Element | null)?.closest?.(".tc-hit")) setPinned(null); };
    window.addEventListener("keydown", k, true);
    document.addEventListener("pointerdown", down, true);
    return () => { window.removeEventListener("keydown", k, true); document.removeEventListener("pointerdown", down, true); };
  }, [pinned]);
  const [keyHover, setKeyHover] = useState<string | null>(null);     // "s:<series id>" or a colour-key id
  const [full, setFull] = useState(false);
  // "One per benchmark": a small chart's ⛶ icon opens just that benchmark full screen (zoom and pan as in one chart)
  const [focus, setFocus] = useState<string | null>(null);
  const solo = layout === "grid" && full && focus ? data.series.find((s) => s.id === focus) ?? null : null;
  const oneView = layout === "one" || !!solo;
  const [fullH, setFullH] = useState(700);
  const [view, setView] = useState<{ x: Dom; y: Dom } | null>(null);
  const drag = useRef<{ px: number; py: number; x: Dom; y: Dom; moved: boolean } | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.max(420, el.clientWidth)));
    ro.observe(el);
    setW(Math.max(420, el.clientWidth));
    return () => ro.disconnect();
  }, [full, layout]);

  const seriesIdx = useMemo(() => new Map(data.series.map((s, i) => [s.id, i])), [data.series]);
  const seriesOf = (p: ChartPoint) => data.series[seriesIdx.get(p.benchmark_id) ?? 0];
  const all = data.points.filter((p) => seriesIdx.has(p.benchmark_id));
  const shownPts = all.filter((p) => !hidden.has(p.benchmark_id));

  // axes: X defaults to output price per 1M tokens (the same on every benchmark, so a model's points share one
  // column) when enough points have it, else the details page's fallback (price / task, latency, …)
  const cov = useMemo(() => {
    const out = {} as Record<MetricKey, number>;
    for (const k of AXIS_ORDER) out[k] = shownPts.filter((p) => val(p, k) !== null).length;
    return out;
  }, [shownPts]);
  // the default X comes from every drawn benchmark, so hiding some never switches the axis
  const usableFor = (k: MetricKey) => all.filter((p) => val(p, k) !== null && val(p, y) !== null).length;
  const x: MetricKey = xSet ?? (usableFor("output_price") >= 3 ? "output_price" : defaultAxes(all.map((p) => ({ ...p, quality: p.sort_score }))).x);
  const logX = lx === "1" ? true : lx === "0" ? false : METRICS[x].log;
  const logY = ly === "1" ? true : ly === "0" ? false : METRICS[y].log;
  const mx = METRICS[x], my = METRICS[y];
  const usableAll = all.filter((p) => {
    const vx = val(p, x), vy = val(p, y);
    return vx !== null && vy !== null && (!logX || vx > 0) && (!logY || vy > 0);
  });
  // a developer switched off in the developer key is filtered out; axis limits still come from every drawn point
  const devOn = (p: ChartPoint) => colorBy === "developer" || !devOff.includes(LAB_SLOT[p.provider] || custom[p.provider] ? p.provider : "Other");
  const shownBench = usableAll.filter((p) => !hidden.has(p.benchmark_id));
  const usable = shownBench.filter(devOn);
  const notComparable = y === "quality" ? data.series.filter((s) => !hidden.has(s.id) && all.some((p) => p.benchmark_id === s.id) && all.every((p) => p.benchmark_id !== s.id || p.sort_score === null)) : [];

  // ---- colours ----
  const greySet = new Set(grey);
  const keyOf = (p: ChartPoint): string => {
    if (colorBy === "benchmark") return `s:${p.benchmark_id}`;
    if (colorBy === "developer") return LAB_SLOT[p.provider] || custom[p.provider] ? p.provider : "Other";
    if (colorBy === "yugos") return p.yugos_providers.length ? "routable" : "not";
    if (colorBy === "effort") return p.effort_rank === null ? (p.reasoning_effort === "enabled" ? "enabled" : "default") : `r${p.effort_rank}`;
    return "all";
  };
  const colorOfKey = (k: string): string => {
    if (greySet.has(k)) return "var(--tc-other)";
    if (k.startsWith("s:")) return `var(--tc-c${slotOf(seriesIdx.get(k.slice(2)) ?? 0)})`;
    if (colorBy === "developer") return custom[k] ?? (LAB_SLOT[k] ? `var(--tc-c${LAB_SLOT[k]})` : "var(--tc-other)");
    if (colorBy === "yugos") return k === "routable" ? "var(--tc-c1)" : "var(--tc-other)";
    if (colorBy === "effort") return k.startsWith("r") ? `var(--tc-r${k.slice(1)})` : "var(--tc-other)";
    return "var(--tc-c1)";
  };
  const devOffSet = new Set(colorBy === "developer" ? [] : devOff);
  const colorOf = (p: ChartPoint) => colorOfKey(keyOf(p));
  /** a developer's colour (the label border); the dots' own colour when they are coloured by developer */
  const devKey = (p: ChartPoint) => (LAB_SLOT[p.provider] || custom[p.provider] ? p.provider : "Other");
  const devColorOfKey = (k: string) => custom[k] ?? (LAB_SLOT[k] ? `var(--tc-c${LAB_SLOT[k]})` : "var(--tc-other)");
  const devColor = (p: ChartPoint) => (colorBy === "developer" ? colorOf(p) : devOffSet.has(devKey(p)) ? "var(--tc-other)" : devColorOfKey(devKey(p)));
  const devLegend = useMemo(() => {
    if (colorBy === "developer") return [];
    const n = new Map<string, number>();
    for (const p of shownBench) n.set(devKey(p), (n.get(devKey(p)) ?? 0) + 1);
    return [...LAB_ORDER, ...Object.keys(custom).filter((d) => !LAB_SLOT[d]).sort((a, b) => a.localeCompare(b)), "Other"].filter((d) => n.has(d));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownBench, colorBy, custom]);
  const seriesColor = (s: Series) => (colorBy === "benchmark" ? colorOfKey(`s:${s.id}`) : "var(--tc-ink2)");
  const colorKeys = useMemo(() => {
    if (colorBy === "benchmark" || colorBy === "none") return [];
    const count = new Map<string, number>(), others = new Set<string>();
    for (const p of shownPts) { const k = keyOf(p); count.set(k, (count.get(k) ?? 0) + 1); if (k === "Other") others.add(p.provider); }
    const order = colorBy === "developer" ? [...LAB_ORDER, ...Object.keys(custom).filter((d) => !LAB_SLOT[d]).sort((a, b) => a.localeCompare(b)), "Other"]
      : colorBy === "yugos" ? ["routable", "not"] : [...RANK_STEP.map((r) => `r${r}`), "enabled", "default"];
    const label = (k: string) => colorBy === "yugos" ? (k === "routable" ? "Yugos can route" : "Not on Yugos")
      : colorBy === "effort" ? (k === "default" ? "Default (not stated)" : k === "enabled" ? "Reasoning (no level)" : ["Non-reasoning", "Minimal", "Low", "Medium", "High", "Xhigh", "Max"][Number(k.slice(1))]) : k;
    return order.filter((k) => count.has(k)).map((k) => ({ id: k, label: label(k), count: count.get(k)!,
      title: k === "Other" ? `Other developers: ${[...others].sort().join(", ")}` : undefined }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownPts, colorBy, custom]);
  const otherDevs = colorBy !== "developer" ? [] : [...new Set(shownPts.map((p) => p.provider).filter((d) => !LAB_SLOT[d] && !custom[d]))].sort((a, b) => a.localeCompare(b));
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setDevColor = (dev: string, color: string | null) => {
    setCustom((c) => { const n = { ...c }; if (color) n[dev] = color; else delete n[dev]; return n; });
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      fetch("/api/chart-colors", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ developer: dev, color }) }).catch(() => undefined);
    }, 350);
  };
  const hexOf = (k: string) => {
    if (custom[k]) return custom[k];
    const v = root.current && LAB_SLOT[k] ? getComputedStyle(root.current).getPropertyValue(`--tc-c${LAB_SLOT[k]}`).trim() : "";
    return /^#[0-9a-f]{6}$/i.test(v) ? v : "#888888";
  };

  // ---- emphasis: hovering a point lifts its configuration everywhere; hovering a key entry lifts its points ----
  const lit = (p: ChartPoint) => em ? p.config === em.p.config
    : keyHover ? (keyHover.startsWith("s:") ? p.benchmark_id === keyHover.slice(2) : keyHover.startsWith("d:") ? devKey(p) === keyHover.slice(2) : keyOf(p) === keyHover) : true;

  // size, dot size and axis limits come from every drawn point, hidden benchmarks included: hiding or showing
  // benchmarks then only adds or removes dots, and everything else stays exactly where it was
  const n = usableAll.length;
  const R = n <= 12 ? 8 : n <= 30 ? 6.5 : n <= 80 ? 5.5 : n <= 200 ? 4.8 : 4.2;
  const Hc = full ? fullH : n > 200 ? 720 : n > 80 ? 600 : H;   // many dots: a taller chart gives the labels room
  const fitAll = useMemo(() => usableAll.length ? { x: autoDomain(usableAll.map((p) => val(p, x)!), logX), y: autoDomain(usableAll.map((p) => val(p, y)!), logY) } : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [usableAll.length, data, x, y, logX, logY]);
  useEffect(() => { setView(null); setPinned(null); }, [x, y, logX, logY, data, layout]);
  useEffect(() => { setPinned(null); }, [view, W, full, hidden]);

  // ---- full screen, whiteboard style (one chart only) ----
  const exitFull = useCallback(() => { setFull(false); setFocus(null); setView(null); if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined); }, []);
  useEffect(() => {
    if (!full) return;
    const size = () => setFullH(Math.max(320, window.innerHeight - (root.current?.querySelector(".mc-plot")?.getBoundingClientRect().top ?? 160) - 44));
    size();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") exitFull(); };
    const onFs = () => { if (!document.fullscreenElement) { setFull(false); setFocus(null); setView(null); } };
    window.addEventListener("resize", size); window.addEventListener("keydown", onKey); document.addEventListener("fullscreenchange", onFs);
    const prev = document.body.style.overflow; document.body.style.overflow = "hidden";
    const t = setTimeout(size, 120);
    return () => { clearTimeout(t); window.removeEventListener("resize", size); window.removeEventListener("keydown", onKey); document.removeEventListener("fullscreenchange", onFs); document.body.style.overflow = prev; };
  }, [full, exitFull]);
  const domsRef = useRef<{ x: Dom; y: Dom; w: number; h: number } | null>(null);
  const zoomAt = useCallback((px: number, py: number, f: number) => {
    const d = domsRef.current;
    if (!d) return;
    const ax = d.x[0] + ((px - M.left) / d.w) * (d.x[1] - d.x[0]);
    const ay = d.y[0] + ((Hc - M.bottom - py) / d.h) * (d.y[1] - d.y[0]);
    setView({ x: zoomDom(d.x, ax, f), y: zoomDom(d.y, ay, f) });
  }, [Hc]);
  useEffect(() => {
    const el = box.current;
    if (!full || !oneView || !el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const d = domsRef.current;
      if (!d) return;
      const r = el.getBoundingClientRect();
      if (e.shiftKey) { const dd = ((e.deltaY || e.deltaX) / d.w) * (d.x[1] - d.x[0]); setView({ x: [d.x[0] + dd, d.x[1] + dd], y: d.y }); return; }
      zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [full, oneView, zoomAt]);
  const pointer = full && oneView ? {
    onPointerDown: (e: React.PointerEvent) => {
      const d = domsRef.current;
      if (e.button !== 0 || !d) return;
      drag.current = { px: e.clientX, py: e.clientY, x: d.x, y: d.y, moved: false };   // a drag starts after a few pixels: a click still reaches the dot
    },
    onPointerMove: (e: React.PointerEvent) => {
      const g = drag.current, d = domsRef.current;
      if (!g || !d) return;
      if (!g.moved) {
        if (Math.hypot(e.clientX - g.px, e.clientY - g.py) < 4) return;
        g.moved = true; setDragging(true);
        (e.currentTarget as Element).setPointerCapture(e.pointerId);
      }
      const dx = ((e.clientX - g.px) / d.w) * (g.x[1] - g.x[0]), dy = ((e.clientY - g.py) / d.h) * (g.y[1] - g.y[0]);
      setView({ x: [g.x[0] - dx, g.x[1] - dx], y: [g.y[0] + dy, g.y[1] + dy] }); setHover(null); setPinned(null);
    },
    onPointerUp: () => { drag.current = null; setDragging(false); },
  } : undefined;

  const options = (current: MetricKey) => AXIS_ORDER.map((k) => (
    <option key={k} value={k} disabled={cov[k] === 0 && k !== current}>{METRICS[k].short}{k === "quality" ? " 0–100" : ""} ({cov[k]})</option>
  ));
  const toggleLine = (l: LineKind) => { const s = new Set(lines); if (s.has(l)) s.delete(l); else s.add(l); set.setLines(s); };
  // a benchmark with no point for the chosen axes cannot be drawn: the key shows it as unavailable (and why), and
  // the show/hide clicks only count the benchmarks that can be drawn
  const drawable = new Map<string, number>();
  for (const p of usableAll) drawable.set(p.benchmark_id, (drawable.get(p.benchmark_id) ?? 0) + 1);
  const whyNot = (id: string) => {
    const ps = all.filter((p) => p.benchmark_id === id);
    if (!ps.length) return "No results for the chosen models";
    if (!ps.some((p) => val(p, y) !== null)) return y === "quality" ? "Not on a 0–100 scale, so it has no Quality value" : `No ${my.short.toLowerCase()} data`;
    if (!ps.some((p) => val(p, x) !== null)) return `No ${mx.short.toLowerCase()} data`;
    return "Its values are ≤ 0, which a log axis cannot show";
  };
  // all shown: a click shows only that benchmark; then clicks add or remove; hiding the last one shows all again
  const seriesIds = data.series.map((s) => s.id).filter((id) => drawable.has(id));
  const toggleHidden = (id: string) => set.setHidden(new Set([...keyClick(seriesIds, [...hidden], id), ...[...hidden].filter((h) => !seriesIds.includes(h))]));
  const keyOrder = [...data.series.map((s, i) => ({ s, i }))].sort((a, b) => Number(!drawable.has(a.s.id)) - Number(!drawable.has(b.s.id)));

  // the tooltip: this configuration on every drawn benchmark
  const tip = (h: Hover, w: number, hh: number) => {
    const same = usable.filter((p) => p.config === h.p.config).sort((a, b) => val(b, y)! - val(a, y)!);
    const s = seriesOf(h.p);
    return (
      <div className="tc-tip mc-tip" style={{ left: Math.min(h.px + 14, w - 290), top: Math.min(Math.max(h.py - 10, 0), Math.max(0, hh - 60 - same.length * 18)) }}>
        <b>{h.p.model_name}</b> <span className="subtle">{variant(h.p)}</span>
        <div className="subtle">{h.p.provider}{h.p.yugos_providers.length ? ` · Yugos: ${h.p.yugos_providers.join(", ")}` : " · not on Yugos"}</div>
        {same.length <= 1 && <div><ShapeIcon i={seriesIdx.get(s.id) ?? 0} color={seriesColor(s)} /> {s.label}: <b>{my.format(val(h.p, y)!)}</b> · {mx.short} <b>{mx.format(val(h.p, x)!)}</b></div>}
        {same.length > 1 && (
          <table className="mc-tip-all"><thead><tr><td>On every drawn benchmark</td><td className="num">{y === "quality" ? "Score" : my.short}</td><td className="num">{mx.short}</td></tr></thead><tbody>
            {same.map((p) => {
              const ps = seriesOf(p);
              return (
                <tr key={`${p.benchmark_id}${p.source_name}`} className={p === h.p ? "on" : ""}>
                  <td><ShapeIcon i={seriesIdx.get(ps.id) ?? 0} color={seriesColor(ps)} /> {ps.label}</td>
                  <td className="num">{my.format(val(p, y)!)}</td>
                  <td className="num muted">{mx.format(val(p, x)!)}</td>
                </tr>
              );
            })}
          </tbody></table>
        )}
        <div className="muted small">{h.p.source_name}</div>
      </div>
    );
  };

  const plotProps = { x, y, logX, logY, R, lines, seriesIdx, colorOf, seriesColor: (p: ChartPoint) => seriesColor(seriesOf(p)), lit, hover: em, setHover, pinned, setPinned, tip, devColor: outline ? devColor : null };
  const gridCols = W >= 1150 ? 3 : W >= 760 ? 2 : 1;
  const panelW = Math.floor((W - (gridCols - 1) * 12) / gridCols);
  const panels = data.series.filter((s) => !hidden.has(s.id) && usable.some((p) => p.benchmark_id === s.id));

  return (
    <div ref={root} className={`tc mc-body${busy ? " busy" : ""}${full ? " full" : ""}${dragging ? " dragging" : ""}`}>
      <div className="tc-controls" role="group" aria-label="Chart settings">
        <span className="ctl-grp"><span className="ctl-lab">Y</span><select aria-label="Y axis" value={y} onChange={(e) => { set.setY(e.target.value as MetricKey); set.setLy(""); }}>{options(y)}</select>
          <label className="sw"><input type="checkbox" checked={logY} onChange={(e) => set.setLy(e.target.checked === METRICS[y].log ? "" : e.target.checked ? "1" : "0")} /> log</label></span>
        <span className="ctl-grp"><span className="ctl-lab">X</span><select aria-label="X axis" value={x} onChange={(e) => { set.setX(e.target.value as MetricKey); set.setLx(""); }}>{options(x)}</select>
          <label className="sw"><input type="checkbox" checked={logX} onChange={(e) => set.setLx(e.target.checked === METRICS[x].log ? "" : e.target.checked ? "1" : "0")} /> log</label></span>
        <span className="ctl-grp"><span className="ctl-lab">Colour</span><select aria-label="Colour by" value={colorBy} onChange={(e) => { set.setColorBy(e.target.value as ColorBy); set.setGrey([]); }}>
          <option value="benchmark">Benchmark</option><option value="developer">Developer</option><option value="yugos">Yugos availability</option>
          <option value="effort">Effort level</option><option value="none">One colour</option>
        </select></span>
        <span className="ctl-grp" role="group" aria-label="Lines"><span className="ctl-lab">Lines</span>
          <label className="sw" title="Join one model configuration's points on the different benchmarks (its spread: best to worst)"><input type="checkbox" checked={lines.has("spread")} onChange={() => toggleLine("spread")} /> Model across benchmarks</label>
          <label className="sw" title={FRONTIER_X[x] ? "Each benchmark's frontier: the best score reached so far, going from cheaper (or faster) to dearer (or slower)" : "Frontiers need a price, time, token or speed X axis"}>
            <input type="checkbox" checked={lines.has("curves")} disabled={!FRONTIER_X[x]} onChange={() => toggleLine("curves")} /> Frontier</label>
          <label className="sw" title="Join a model's effort levels (low → max) on each benchmark"><input type="checkbox" checked={lines.has("efforts")} onChange={() => toggleLine("efforts")} /> Efforts</label>
        </span>
        <span className="ctl-grp"><span className="ctl-lab">Show</span>
          <label className="sw" title="Off: labels appear only on the benchmark frontiers and on the model you hover"><input type="checkbox" checked={showLabels} onChange={(e) => set.setShowLabels(e.target.checked)} /> All labels</label>
          <label className="sw" title="Outline each label in its developer's colour"><input type="checkbox" checked={outline} onChange={(e) => set.setOutline(e.target.checked)} /> Developer outline</label></span>
        <span className="ctl-grp">
        <span className="bl-seg mc-seg" role="tablist" aria-label="Layout">
          <button type="button" role="tab" aria-selected={layout === "one"} className={layout === "one" ? "on" : ""} onClick={() => set.setLayout("one")}>One chart</button>
          <button type="button" role="tab" aria-selected={layout === "grid"} className={layout === "grid" ? "on" : ""} onClick={() => set.setLayout("grid")}
                  title="Small multiples: one chart per benchmark, same Y scale">One per benchmark</button>
        </span></span>
        {!full ? (
          <button type="button" className="button tc-fs" onClick={() => { setFull(true); root.current?.requestFullscreen?.().catch(() => undefined); }}
                  title={layout === "one" ? "Open the chart full screen: wheel zooms, drag pans" : "Open the charts full screen"}>⛶ Full screen</button>
        ) : (
          <span className="tc-zoom" role="group" aria-label="Zoom">
            {oneView && <>
              <button type="button" className="button" onClick={() => zoomAt((M.left + W - M.right) / 2, (M.top + Hc - M.bottom) / 2, 0.7)} title="Zoom in (wheel up)">+</button>
              <button type="button" className="button" onClick={() => zoomAt((M.left + W - M.right) / 2, (M.top + Hc - M.bottom) / 2, 1 / 0.7)} title="Zoom out (wheel down)">−</button>
              <button type="button" className="button" onClick={() => setView(null)} disabled={!view} title="Fit every point (double-click)">Reset view</button>
            </>}
            <button type="button" className="button primary" onClick={exitFull} title="Esc">Exit full screen</button>
          </span>
        )}
        <span className="mc-picker">{picker}</span>
      </div>

      {/* benchmarks: shape (and colour) of each; hover highlights, click hides. Not when one benchmark's chart is open full screen. */}
      {!solo && <div className="tc-key mc-key" role="group" aria-label="Benchmarks" onMouseLeave={() => setKeyHover(null)}>
        {keyOrder.map(({ s, i }) => {
          const cnt = drawable.get(s.id) ?? 0, na = cnt === 0, off = !na && hidden.has(s.id);
          const about = `${s.root ? `${s.root} › ` : ""}${s.label}\nDifficulty: ${difficultyText(s.difficulty)}${s.span ? " (range of its sub-benchmarks)" : ""}\n${s.db} · ${s.sources.join(", ")} · Benchmark list ${s.nos.join(", ")}`;
          return (
            <span key={s.id} className={`tc-key-item${off ? " off" : ""}${na ? " na" : ""}`} onMouseEnter={() => !off && !na && setKeyHover(`s:${s.id}`)} onMouseLeave={() => setKeyHover(null)}>
              <ShapeIcon i={i} color={off || na ? "var(--tc-other)" : seriesColor(s)} />
              <button type="button" className="tc-key-name" aria-pressed={!off && !na} disabled={na} onClick={() => toggleHidden(s.id)}
                      title={`${about}\n${na ? `Not drawn: ${whyNot(s.id)}. Pick other axes to see it.` : keyClickHint(seriesIds, [...hidden], s.id, { on: "show it again", off: "hide it" })}`}>
                {s.root && <span className="mc-key-root">{s.root}</span>}{s.label}
                {s.difficulty.kind !== "none" && <span className="mc-key-stars"><Stars d={s.difficulty} span={s.span} /></span>}
                {s.fit && <span className="mc-key-fit"><MatchBars t={s.fit} /></span>}
                <span className="tc-key-n">{na ? "–" : cnt}</span>
              </button>
            </span>
          );
        })}
        {seriesIds.some((id) => hidden.has(id)) && <button type="button" className="link tc-key-reset" onClick={() => set.setHidden(new Set())}>Show all</button>}
      </div>}

      {devLegend.length > 0 && (
        <div className="mc-devkey small" aria-label="Label outlines">
          <span className="muted">Developers:</span>
          {devLegend.map((d) => {
            const off = devOffSet.has(d);
            return (
              <button key={d} type="button" className={`mc-devchip${off ? " off" : ""}`} aria-pressed={!off}
                      style={{ ["--dev" as string]: off ? "var(--tc-other)" : devColorOfKey(d) }}
                      onMouseEnter={() => !off && setKeyHover(`d:${d}`)} onMouseLeave={() => setKeyHover(null)}
                      onClick={() => set.setDevOff(keyClick(devLegend, devOff, d))}
                      title={keyClickHint(devLegend, devOff, d, { on: "show its models again", off: "hide its models" })}>{d}</button>
            );
          })}
          {devOff.some((d) => devLegend.includes(d)) && <button type="button" className="link tc-key-reset" onClick={() => set.setDevOff([])}>Show all</button>}
        </div>
      )}
      {colorKeys.length > 0 && (
        <div className="tc-key" role="group" aria-label="Colour key" onMouseLeave={() => setKeyHover(null)}>
          {colorKeys.map((k) => {
            const pickable = colorBy === "developer" && k.id !== "Other";
            const off = greySet.has(k.id);
            return (
              <span key={k.id} className={`tc-key-item${off ? " off" : ""}`} onMouseEnter={() => setKeyHover(k.id)} onMouseLeave={() => setKeyHover(null)}>
                {pickable ? (
                  <label className="tc-swatch-pick" title={`Change ${k.label}'s colour`}>
                    <span className="tc-swatch" style={{ background: colorOfKey(k.id) }} />
                    <input type="color" value={hexOf(k.id)} aria-label={`Colour for ${k.label}`} onChange={(e) => setDevColor(k.id, e.target.value)} />
                  </label>
                ) : <span className="tc-swatch" style={{ background: colorOfKey(k.id) }} aria-hidden="true" />}
                <button type="button" className="tc-key-name" aria-pressed={!off} onClick={() => set.setGrey(keyClick(colorKeys.map((e) => e.id), grey, k.id))}
                        title={`${k.title ? `${k.title}\n` : ""}${keyClickHint(colorKeys.map((e) => e.id), grey, k.id, { on: "colour it again", off: "grey it out" })}`}>
                  {k.label} <span className="tc-key-n">{k.count}</span>
                </button>
                {custom[k.id] && <button type="button" className="tc-key-x" title={`Put ${k.label}'s default colour back`} onClick={() => setDevColor(k.id, null)}>↺</button>}
              </span>
            );
          })}
          {otherDevs.length > 0 && (
            <select className="tc-key-add" value="" aria-label="Give a developer in Other its own colour" onChange={(e) => { if (e.target.value) setDevColor(e.target.value, "#7a5c3e"); }}>
              <option value="">+ Add colour for…</option>
              {otherDevs.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          )}
          {grey.length > 0 && <button type="button" className="link tc-key-reset" onClick={() => set.setGrey([])}>Colour all</button>}
        </div>
      )}

      <div className="mc-plot" ref={box} onMouseLeave={() => setHover(null)}>
        {!data.selected.length ? (
          <p className="empty">No models chosen. Open “0 of {data.configs.length} models” to choose some.</p>
        ) : !usableAll.length || !fitAll ? (
          <p className="empty">No points have both {mx.short.toLowerCase()} and {my.short.toLowerCase()} for the chosen models and benchmarks. Pick other axes or models.</p>
        ) : solo ? (
          <>
            <div className="mc-panel-title"><ShapeIcon i={seriesIdx.get(solo.id) ?? 0} color={seriesColor(solo)} />
              <span className="mc-panel-name" title={[solo.root, solo.label].filter(Boolean).join(" · ")}>{solo.root && <span className="mc-key-root">{solo.root}</span>}<b>{solo.label}</b></span>
              {solo.difficulty.kind !== "none" && <Stars d={solo.difficulty} span={solo.span} />}{solo.fit && <span className="mc-key-fit"><MatchBars t={solo.fit} /></span>}</div>
            {(() => {
              const pts = usable.filter((p) => p.benchmark_id === solo.id);
              const own = { x: autoDomain(pts.map((p) => val(p, x)!), logX), y: fitAll.y };
              return <Plot {...plotProps} pts={pts} W={W} Hh={Hc - 24} m={M} id="one" dom={view ?? own} labelsMax={showLabels ? 1 : 0} domsRef={domsRef}
                           pointer={pointer} onDoubleClick={() => setView(null)} />;
            })()}
          </>
        ) : layout === "one" ? (
          <Plot {...plotProps} pts={usable} W={W} Hh={Hc} m={M} id="one" dom={view ?? fitAll} labelsMax={showLabels ? 1 : 0} domsRef={domsRef}
                pointer={pointer} onDoubleClick={() => full && setView(null)} />
        ) : (
          <div className="mc-grid" style={{ gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))` }}>
            {panels.map((s) => {
              const pts = usable.filter((p) => p.benchmark_id === s.id);
              const ph = full ? Math.max(260, Math.floor((fullH - 30) / Math.ceil(panels.length / gridCols)) - 30) : 270;
              // same Y scale in every panel, so heights compare; X fits each benchmark
              const dom = { x: autoDomain(pts.map((p) => val(p, x)!), logX), y: fitAll.y };
              return (
                <div key={s.id} className="mc-panel">
                  <div className="mc-panel-title small"><ShapeIcon i={seriesIdx.get(s.id) ?? 0} color={seriesColor(s)} />
                    <span className="mc-panel-name" title={[s.root, s.label].filter(Boolean).join(" · ")}>{s.root && <span className="mc-key-root">{s.root}</span>}<b>{s.label}</b></span>
                    {s.difficulty.kind !== "none" && <Stars d={s.difficulty} span={s.span} />}{s.fit && <span className="mc-key-fit"><MatchBars t={s.fit} /></span>} <span className="muted mc-panel-n">{pts.length}</span>
                    <button type="button" className="mc-panel-fs" aria-label={`Open ${s.label} full screen`} title="Open this chart full screen (wheel zooms, drag pans)"
                            onClick={() => { setFocus(s.id); setView(null); setFull(true); root.current?.requestFullscreen?.().catch(() => undefined); }}>
                      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M1 5V1h4M9 1h4v4M13 9v4H9M5 13H1V9" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </button>
                    {onArchive && !full && <ArchiveButton label={s.label} className="mc-panel-arc"
                      onClick={() => { onArchive(s.nos); }} />}</div>
                  <Plot {...plotProps} pts={pts} W={panelW} Hh={ph} m={GM} id={s.id} dom={dom} labelsMax={showLabels ? 1 : 0} small />
                </div>
              );
            })}
          </div>
        )}
      </div>

      <p className="muted small tc-note">
        {new Set(usable.map((p) => p.config)).size} model configurations · {usable.length} points on {new Set(usable.map((p) => p.benchmark_id)).size} benchmarks
        {shownPts.length > usable.length ? ` (${shownPts.length - usable.length} points lack ${mx.short.toLowerCase()} or ${my.short.toLowerCase()}${logX || logY ? " or are ≤ 0 on a log axis" : ""})` : ""}.
        {" "}Each point is a configuration’s latest result on one benchmark; shapes tell the benchmarks apart; filled = Yugos can route it. Hover a dot to highlight its model; click it for its values.
        {y === "quality" && " Quality is the comparable 0–100 score (Elo and other scales converted as on the Results page)."}
        {notComparable.length > 0 && ` Not on a 0–100 scale, so left out of Quality: ${notComparable.map((s) => s.label).join(", ")}.`}
        {data.unlinked.length > 0 && <> {data.unlinked.length} of the filtered rows have no results in our database (<span title={data.unlinked.map((u) => `${u.no} ${u.name}`).join("\n")}>hover for the list</span>).</>}
        {full && oneView && " Wheel or pinch to zoom · drag to pan · Shift+wheel scrolls sideways · double-click to fit · Esc to leave."}
      </p>
    </div>
  );
}

function Plot({ pts, W, Hh, m, id, dom, x, y, logX, logY, R, lines, seriesIdx, colorOf, seriesColor, lit, hover, setHover, pinned, setPinned, tip, devColor, labelsMax, small, domsRef, pointer, onDoubleClick }: {
  pts: ChartPoint[]; W: number; Hh: number; m: typeof M; id: string; dom: { x: Dom; y: Dom }; x: MetricKey; y: MetricKey; logX: boolean; logY: boolean;
  R: number; lines: Set<LineKind>; seriesIdx: Map<string, number>; colorOf: (p: ChartPoint) => string; seriesColor: (p: ChartPoint) => string;
  lit: (p: ChartPoint) => boolean; hover: Hover | null; setHover: (h: Hover | null) => void; pinned: Hover | null; setPinned: (f: (h: Hover | null) => Hover | null) => void; tip: (h: Hover, w: number, h2: number) => ReactNode; devColor: ((p: ChartPoint) => string) | null;
  labelsMax: number; small?: boolean; domsRef?: React.MutableRefObject<{ x: Dom; y: Dom; w: number; h: number } | null>;
  pointer?: { onPointerDown: (e: React.PointerEvent) => void; onPointerMove: (e: React.PointerEvent) => void; onPointerUp: () => void };
  onDoubleClick?: () => void;
}) {
  const mx = METRICS[x], my = METRICS[y];
  const pin = (p: ChartPoint, px: number, py: number) =>
    setPinned((c) => (c && c.p === p && c.panel === id ? null : { p, px, py, panel: id }));
  const sx = scale(dom.x, logX, m.left, W - m.right), sy = scale(dom.y, logY, Hh - m.bottom, m.top);
  if (domsRef) domsRef.current = { x: dom.x, y: dom.y, w: W - m.left - m.right, h: Hh - m.top - m.bottom };
  const r = small ? Math.min(R, 5) : R;
  const P = (p: ChartPoint) => [sx.map(val(p, x)!), sy.map(val(p, y)!)] as const;
  const inside = (p: ChartPoint) => { const [px, py] = P(p); return px >= m.left && px <= W - m.right && py >= m.top && py <= Hh - m.bottom; };
  const anyLit = hover !== null || pts.some((p) => !lit(p));
  const op = (p: ChartPoint) => (!anyLit || lit(p) ? 1 : LOW);

  const groupBy = (f: (p: ChartPoint) => string) => {
    const g = new Map<string, ChartPoint[]>();
    for (const p of pts) g.set(f(p), [...(g.get(f(p)) ?? []), p]);
    return g;
  };
  const byConfig = groupBy((p) => p.config);
  const spread = lines.has("spread") && !small ? [...byConfig.entries()].filter(([, ps]) => ps.length > 1)
    .map(([k, ps]) => ({ k, ps: [...ps].sort((a, b) => val(a, x)! - val(b, x)! || val(a, y)! - val(b, y)!) })) : [];
  // a benchmark's frontier: the models that beat every cheaper (or faster) one on that benchmark, joined directly
  const curves = lines.has("curves") && FRONTIER_X[x] ? [...groupBy((p) => p.benchmark_id).entries()].map(([k, ps]) => {
    const dir = FRONTIER_X[x]!, sorted = [...ps].sort((a, b) => dir * (val(a, x)! - val(b, x)!));
    const front: ChartPoint[] = [];
    for (const p of sorted) if (!front.length || val(p, y)! > val(front[front.length - 1], y)!) front.push(p);
    return { k, ps: front };
  }).filter((l) => l.ps.length > 1) : [];
  const efforts = lines.has("efforts") ? [...groupBy((p) => `${p.model_key}|${p.mode ?? ""}|${p.benchmark_id}|${p.source_name}`).entries()]
    .map(([k, ps]) => ({ k, ps: ps.filter((p) => p.effort_rank !== null).sort((a, b) => a.effort_rank! - b.effort_rank!) })).filter((l) => l.ps.length > 1) : [];
  const line = (ps: ChartPoint[]) => ps.map((p) => P(p).join(",")).join(" ");

  // every dot gets a label in the nearest free gap (lib/labelPlace.ts): a configuration's best point carries its
  // full name (with effort), its points on the other benchmarks the model name
  const fullName = (p: ChartPoint) => (p.reasoning_effort !== null || p.mode ? `${p.model_name} (${variant(p)})` : p.model_name);
  const ordered = [...byConfig.entries()].map(([k, ps]) => ({ k, vis: ps.filter(inside) })).filter((g) => g.vis.length)
    .map(({ k, vis }) => ({ k, vis, top: vis.reduce((a, b) => (val(b, y)! > val(a, y)! ? b : a)) })).sort((a, b) => val(b.top, y)! - val(a.top, y)!);
  const items: LabelIn[] = [];
  const cfgOf = new Map<string, string>(), ptOf = new Map<string, ChartPoint>();
  const add = (k: string, p: ChartPoint, i: number, text: string) => {
    const [px, py] = P(p), key = `${k}|${i}`;
    cfgOf.set(key, k); ptOf.set(key, p);
    items.push({ key, x: px, y: py, r, text });
  };
  for (const { k, top } of ordered) add(k, top, 0, fullName(top));
  for (const { k, top, vis } of ordered) vis.forEach((p, i) => { if (p !== top) add(k, p, i + 1, p.model_name); });
  // placing hundreds of labels takes a moment: only redo it when the points or the view change, not on hover
  const sig = `${W}|${Hh}|${dom.x.join()}|${dom.y.join()}|${x}|${y}|${logX}|${logY}|${r}|${labelsMax}|${pts.map((p) => p.config + p.benchmark_id).join()}`;
  const labels = useMemo(() => (labelsMax > 0 ? placeLabels(items, { x0: m.left, y0: m.top, x1: W - 4, y1: Hh - m.bottom }, { padX: 3, h: 16 }) : []),
    [sig]);  // eslint-disable-line react-hooks/exhaustive-deps
  // labels switched off: the dots on a drawn benchmark frontier keep theirs, and the emphasised configuration
  // (hovered, clicked, or its benchmark picked in the key) gets them too
  const onFrontier = new Set(curves.flatMap((l) => l.ps));
  const wanted = labelsMax > 0 ? [] : items.filter((i) => onFrontier.has(ptOf.get(i.key)!) || (anyLit && lit(ptOf.get(i.key)!)));
  const shownLabels = labelsMax > 0 ? labels : !wanted.length ? []
    : placeLabels(wanted, { x0: m.left, y0: m.top, x1: W - 4, y1: Hh - m.bottom }, { padX: 3, h: 16 });
  const clip = `mc-clip-${id.replace(/[^a-z0-9]/gi, "")}`;
  const xt = sx.ticks.filter((t) => sx.map(t) >= m.left - 1 && sx.map(t) <= W - m.right + 1);
  const yt = sy.ticks.filter((t) => sy.map(t) >= m.top - 1 && sy.map(t) <= Hh - m.bottom + 1);
  const xticks = small && xt.length > 5 ? xt.filter((_, i) => i % 2 === 0) : xt;

  return (
    <div className="tc-plot mc-plotbox">
      <svg width={W} height={Hh} role="img" aria-label={`${my.label} against ${mx.label}, ${pts.length} points`} onDoubleClick={onDoubleClick}
           onPointerDown={pointer?.onPointerDown} onPointerMove={pointer?.onPointerMove} onPointerUp={pointer?.onPointerUp} onPointerCancel={pointer?.onPointerUp}>
        <defs><clipPath id={clip}><rect x={m.left} y={m.top} width={W - m.left - m.right} height={Hh - m.top - m.bottom} /></clipPath></defs>
        {yt.map((t) => (
          <g key={`y${t}`}>
            <line x1={m.left} x2={W - m.right} y1={sy.map(t)} y2={sy.map(t)} className="tc-grid" />
            <text x={m.left - 8} y={sy.map(t) + 4} className="tc-tick" textAnchor="end">{my.format(t)}</text>
          </g>
        ))}
        {xticks.map((t) => (
          <g key={`x${t}`}>
            <line x1={sx.map(t)} x2={sx.map(t)} y1={m.top} y2={Hh - m.bottom} className="tc-grid" />
            <text x={sx.map(t)} y={Hh - m.bottom + 16} className="tc-tick" textAnchor="middle">{mx.format(t)}</text>
          </g>
        ))}
        <text x={(m.left + W - m.right) / 2} y={Hh - (small ? 6 : 10)} className="tc-axis" textAnchor="middle">{small ? mx.short : mx.label}{logX ? " · log" : ""}</text>
        {!small && <text transform={`translate(16 ${(m.top + Hh - m.bottom) / 2}) rotate(-90)`} className="tc-axis" textAnchor="middle">{y === "quality" ? "Quality (comparable score, 0–100)" : my.label}{logY ? " · log" : ""}</text>}

        <g clipPath={`url(#${clip})`}>
          {curves.map((l) => <polyline key={`c${l.k}`} className="tc-line mc-curve" points={line(l.ps)}
                                       style={{ ["--c" as string]: seriesColor(l.ps[0]), opacity: anyLit ? (l.ps.some(lit) && !hover ? 1 : 0.9 * LOW) : 0.9 }} />)}
          {spread.map((l) => <polyline key={`s${l.k}`} className="tc-line mc-spread" points={line(l.ps)}
                                       style={{ opacity: anyLit ? 0.45 * LOW : 0.45 }} />)}
          {efforts.map((l) => (
            <g key={`e${l.k}`} style={{ ["--c" as string]: colorOf(l.ps[0]), opacity: anyLit ? LOW : 1 }}>
              <polyline className="tc-effort-halo" points={line(l.ps)} />
              <polyline className="tc-line tc-effort" points={line(l.ps)} />
            </g>
          ))}
          {pts.map((p, i) => {
            const [px, py] = P(p);
            const front = onFrontier.has(p);       // dots on a benchmark frontier: a little bigger, with a dark ring
            return <Shape key={i} shape={shapeOf(seriesIdx.get(p.benchmark_id) ?? 0)} x={px} y={py} r={(p.yugos_providers.length ? r : r - 0.5) + (front ? 1.5 : 0)}
                          className={`tc-dot${p.yugos_providers.length ? "" : " hollow"}${front ? " front" : ""}`} style={{ opacity: op(p), ["--c" as string]: colorOf(p) }} />;
          })}
          {/* the emphasised configuration (or benchmark) on top: its lines thicker, its dots bigger and outlined */}
          {anyLit && (
            <g className="tc-hl">
              {curves.filter((l) => !hover && l.ps.some(lit)).map((l) => <polyline key={`hc${l.k}`} className="tc-line mc-curve hl" points={line(l.ps)} style={{ ["--c" as string]: seriesColor(l.ps[0]) }} />)}
              {spread.filter((l) => l.ps.some(lit)).map((l) => <polyline key={`hs${l.k}`} className="tc-line mc-spread hl" points={line(l.ps)} />)}
              {efforts.filter((l) => l.ps.some(lit)).map((l) => <polyline key={`he${l.k}`} className="tc-line hl" points={line(l.ps)} style={{ ["--c" as string]: colorOf(l.ps[0]) }} />)}
              {pts.filter(lit).map((p, i) => {
                const [px, py] = P(p);
                return <Shape key={`h${i}`} shape={shapeOf(seriesIdx.get(p.benchmark_id) ?? 0)} x={px} y={py} r={r + 1.5}
                              className={`tc-dot hl${p.yugos_providers.length ? "" : " hollow"}`} style={{ ["--c" as string]: colorOf(p) }} />;
              })}
            </g>
          )}
        </g>
        {shownLabels.map((l) => {
          const k = cfgOf.get(l.key)!;
          return (
            <g key={l.key} style={{ opacity: anyLit ? (byConfig.get(k)!.some(lit) ? 1 : LOW_LABEL) : l.crowded ? 0.3 : 1 }}
               className={[anyLit && byConfig.get(k)!.some(lit) ? "tc-lab-hl" : "", onFrontier.has(ptOf.get(l.key)!) ? "mc-lab-front" : ""].filter(Boolean).join(" ") || undefined}>
              {l.leader && <line x1={l.leader[0]} y1={l.leader[1]} x2={l.leader[2]} y2={l.leader[3]} className="tc-leader" />}
              {/* the label is outlined in its developer's colour (coloured outline, thin light halo, dark text), so
                  developers stay apparent whatever the dots are coloured by */}
              {devColor && <text x={l.tx} y={l.ty} className="mc-label-out" style={{ ["--c" as string]: devColor(ptOf.get(l.key)!) }}>{l.text}</text>}
              <text x={l.tx} y={l.ty} className="tc-label">{l.text}</text>
            </g>
          );
        })}
        {pts.map((p, i) => {
          const [px, py] = P(p);
          if (!inside(p)) return null;
          return <circle key={`h${i}`} cx={px} cy={py} r={Math.max(10, r + 5)} className="tc-hit" tabIndex={0}
                         aria-label={`${p.model_name} ${variant(p)}, ${p.benchmark_name}: ${my.short} ${my.format(val(p, y)!)}, ${mx.short} ${mx.format(val(p, x)!)}`}
                         onMouseEnter={() => setHover({ p, px, py, panel: id })} onMouseLeave={() => setHover(null)}
                         onFocus={() => setHover({ p, px, py, panel: id })} onBlur={() => setHover(null)}
                         onClick={(e) => { e.stopPropagation(); pin(p, px, py); }}
                         onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pin(p, px, py); } }} />;
        })}
      </svg>
      {pinned && pinned.panel === id && tip(pinned, W, Hh)}
    </div>
  );
}
