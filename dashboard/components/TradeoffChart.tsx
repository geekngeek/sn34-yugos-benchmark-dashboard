"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { AXIS_ORDER, METRICS, coverage, value, type ChartPoint, type MetricKey } from "@/lib/chartMetrics";

/**
 * Quality vs price (or another measure), in the manner of Artificial Analysis: every model configuration is a
 * point and the efforts of one model are joined by a line, low → max. Both axes are selectable (?x= & ?y=,
 * log scale ?logx= / ?logy=). Colour by developer (fixed colour per lab, like Artificial Analysis), by Yugos
 * availability, by effort level, or one colour (?color=). The key above the chart names the colours; hovering a
 * key entry highlights it and clicking greys it out (?grey=). Filled dot = Yugos can route that configuration.
 */

type ColorBy = "developer" | "yugos" | "effort" | "none";
// Fixed colour per lab (colour follows the developer, never its rank). The first three slots are the only ones a
// scatter keeps apart for every reader, so they go to the most common labs; the rest are told apart by the key's
// hover/isolate and the labels. Other developers are grey.
const LAB_SLOT: Record<string, number> = { Google: 1, Anthropic: 2, OpenAI: 3, Alibaba: 7, Meta: 5, DeepSeek: 4, xAI: 8, Mistral: 6 };
const LAB_ORDER = ["Google", "Anthropic", "OpenAI", "Alibaba", "Meta", "DeepSeek", "xAI", "Mistral"];
const RANK_STEP = ["0", "1", "2", "3", "4", "5", "6"];    // effort ladder -> one-hue ordinal ramp (--tc-r0 … --tc-r6)
interface Key { id: string; label: string; color: string; count: number; title?: string }

const H = 460;
const M = { top: 18, right: 150, bottom: 52, left: 64 };
const EFFORT_LABEL: Record<string, string> = { none: "Non-reasoning", minimal: "Minimal", low: "Low", medium: "Medium",
  high: "High", xhigh: "Xhigh", max: "Max", enabled: "Reasoning" };
const variant = (p: ChartPoint) =>
  [p.reasoning_effort === null ? "Default" : EFFORT_LABEL[p.reasoning_effort] ?? p.reasoning_effort, p.mode].filter(Boolean).join(" · ");

// ---- scales ----------------------------------------------------------------------------------------
function niceTicks(lo: number, hi: number, n = 6): number[] {
  if (!(hi > lo)) return [lo];
  const raw = (hi - lo) / n;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(+v.toPrecision(12));
  return out;
}
function logTicks(lo: number, hi: number): number[] {
  const out: number[] = [];
  for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++) {
    for (const m of [1, 2, 5]) { const v = m * 10 ** e; if (v >= lo * 0.999 && v <= hi * 1.001) out.push(v); }
  }
  return out.length >= 4 ? out : niceTicks(lo, hi);      // zoomed in far: evenly spaced values read better
}
/** a scale's domain in "axis space": log10(value) on a log axis, the value itself otherwise */
type Dom = [number, number];
function autoDomain(vals: number[], log: boolean): Dom {
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (log) { lo = lo / 1.25; hi = hi * 1.25; } else { const pad = (hi - lo || Math.abs(hi) || 1) * 0.06; lo -= pad; hi += pad; }
  return log ? [Math.log10(lo), Math.log10(hi)] : [lo, hi];
}
function scale(dom: Dom, log: boolean, r0: number, r1: number) {
  const [a, b] = dom;
  const f = log ? (v: number) => Math.log10(v) : (v: number) => v;
  const lo = log ? 10 ** a : a, hi = log ? 10 ** b : b;
  return {
    map: (v: number) => r0 + ((f(v) - a) / (b - a || 1)) * (r1 - r0),
    invert: (px: number) => a + ((px - r0) / (r1 - r0)) * (b - a),          // pixel -> axis space
    ticks: log ? logTicks(lo, hi) : niceTicks(lo, hi),
    r0, r1, dom,
  };
}
/** zoom a domain by `f` (<1 = in) around the axis-space point `at` */
const zoomDom = ([a, b]: Dom, at: number, f: number): Dom => [at - (at - a) * f, at + (b - at) * f];

export function TradeoffChart({ points, x, y, logX, logY, colorBy = "developer", grey = [] }: {
  points: ChartPoint[]; x: MetricKey; y: MetricKey; logX: boolean; logY: boolean; colorBy?: ColorBy; grey?: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(900);
  const [hover, setHover] = useState<{ group: string; p: ChartPoint; px: number; py: number } | null>(null);
  const [keyHover, setKeyHover] = useState<string | null>(null);     // a colour-key entry being hovered
  // full screen, whiteboard style: wheel zooms around the pointer, drag pans, Shift+wheel scrolls sideways
  const root = useRef<HTMLDivElement>(null);
  const [full, setFull] = useState(false);
  const [fullH, setFullH] = useState(700);
  const [view, setView] = useState<{ x: Dom; y: Dom } | null>(null);   // null = fit every point
  const drag = useRef<{ px: number; py: number; x: Dom; y: Dom } | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.max(420, el.clientWidth)));
    ro.observe(el);
    setW(Math.max(420, el.clientWidth));
    return () => ro.disconnect();
  }, [full]);

  // entering / leaving full screen (the browser's own full screen when it allows, else a page overlay)
  const enterFull = () => {
    setFull(true);
    root.current?.requestFullscreen?.().catch(() => undefined);
  };
  const exitFull = useCallback(() => {
    setFull(false);
    setView(null);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
  }, []);
  useEffect(() => {
    if (!full) return;
    const size = () => setFullH(Math.max(320, window.innerHeight - (root.current?.querySelector(".tc-plot")?.getBoundingClientRect().top ?? 160) - 44));
    size();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") exitFull(); };
    const onFs = () => { if (!document.fullscreenElement) { setFull(false); setView(null); } };
    window.addEventListener("resize", size);
    window.addEventListener("keydown", onKey);
    document.addEventListener("fullscreenchange", onFs);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const t = setTimeout(size, 120);
    return () => {
      clearTimeout(t);
      window.removeEventListener("resize", size);
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("fullscreenchange", onFs);
      document.body.style.overflow = prev;
    };
  }, [full, exitFull]);

  const setParam = useCallback((changes: Record<string, string | null>) => {
    const qs = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(changes)) { if (v === null) qs.delete(k); else qs.set(k, v); }
    startTransition(() => router.replace(`${pathname}${qs.size ? `?${qs}` : ""}`, { scroll: false }));
  }, [params, pathname, router]);

  const cov = useMemo(() => coverage(points), [points]);
  const greySet = useMemo(() => new Set(grey), [grey]);

  /** which key entry a point belongs to */
  const keyOf = (p: ChartPoint): string => {
    if (colorBy === "developer") return LAB_SLOT[p.provider] ? p.provider : "Other";
    if (colorBy === "yugos") return p.yugos_providers.length ? "routable" : "not";
    if (colorBy === "effort") return p.effort_rank === null ? (p.reasoning_effort === "enabled" ? "enabled" : "default") : `r${p.effort_rank}`;
    return "all";
  };
  const colorOfKey = (k: string): string => {
    if (greySet.has(k)) return "var(--tc-other)";
    if (colorBy === "developer") return LAB_SLOT[k] ? `var(--tc-c${LAB_SLOT[k]})` : "var(--tc-other)";
    if (colorBy === "yugos") return k === "routable" ? "var(--tc-c1)" : "var(--tc-other)";
    if (colorBy === "effort") return k.startsWith("r") ? `var(--tc-r${k.slice(1)})` : "var(--tc-other)";
    return "var(--tc-c1)";
  };
  const keys: Key[] = useMemo(() => {
    const count = new Map<string, number>();
    const others = new Set<string>();
    for (const p of points) {
      const k = keyOf(p);
      count.set(k, (count.get(k) ?? 0) + 1);
      if (k === "Other") others.add(p.provider);
    }
    const order = colorBy === "developer" ? [...LAB_ORDER, "Other"]
      : colorBy === "yugos" ? ["routable", "not"]
      : colorBy === "effort" ? [...RANK_STEP.map((r) => `r${r}`), "enabled", "default"] : ["all"];
    const label = (k: string) => colorBy === "yugos" ? (k === "routable" ? "Yugos can route" : "Not on Yugos")
      : colorBy === "effort" ? (k === "default" ? "Default (not stated)" : k === "enabled" ? "Reasoning (no level)"
        : ["Non-reasoning", "Minimal", "Low", "Medium", "High", "Xhigh", "Max"][Number(k.slice(1))])
      : colorBy === "none" ? "All models" : k;
    return order.filter((k) => count.has(k)).map((k) => ({
      id: k, label: label(k), color: colorOfKey(k), count: count.get(k)!,
      title: k === "Other" ? `Other developers: ${[...others].sort().join(", ")}` : undefined,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, colorBy, greySet]);
  const toggleGrey = (k: string) => {
    const next = greySet.has(k) ? grey.filter((g) => g !== k) : [...grey, k];
    setParam({ grey: next.length ? next.join(",") : null });
  };
  const mx = METRICS[x], my = METRICS[y];
  // a log axis cannot show 0 or negatives
  const usable = points.filter((p) => {
    const vx = value(p, x), vy = value(p, y);
    return vx !== null && vy !== null && (!logX || vx > 0) && (!logY || vy > 0);
  });

  const groupKey = (p: ChartPoint) => `${p.model_key}|${p.mode ?? ""}|${p.source_name}|${p.benchmark_name}|${p.benchmark_version ?? ""}`;
  const Hc = full ? fullH : H;
  // fewer points -> bigger dots (lines keep their 2px); the hover target always stays larger than the dot
  const n = usable.length;
  const R = n <= 8 ? 9 : n <= 20 ? 7.5 : n <= 50 ? 6 : n <= 120 ? 5 : 4.5;
  const fit = useMemo(() => usable.length ? {
    x: autoDomain(usable.map((p) => value(p, x)!), logX), y: autoDomain(usable.map((p) => value(p, y)!), logY),
  } : null,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [usable.length, points, x, y, logX, logY]);
  useEffect(() => { setView(null); }, [x, y, logX, logY, points]);        // new axes or data: fit again
  const plot = useMemo(() => {
    if (usable.length === 0 || !fit) return null;
    const sx = scale(view?.x ?? fit.x, logX, M.left, W - M.right);
    const sy = scale(view?.y ?? fit.y, logY, Hc - M.bottom, M.top);
    const inside = (p: ChartPoint) => {
      const px = sx.map(value(p, x)!), py = sy.map(value(p, y)!);
      return px >= M.left && px <= W - M.right && py >= M.top && py <= Hc - M.bottom;
    };
    const groups = new Map<string, ChartPoint[]>();
    for (const p of usable) groups.set(groupKey(p), [...(groups.get(groupKey(p)) ?? []), p]);
    // join a model's ranked efforts, low -> max (Default and "reasoning, level not stated" stay single points)
    const lines = [...groups.entries()].map(([k, ps]) => ({
      k, pts: ps.filter((p) => p.effort_rank !== null).sort((a, b) => a.effort_rank! - b.effort_rank!),
    })).filter((l) => l.pts.length > 1);
    // one label per model, at its best point; best models first, skip any label that would overlap
    const placed: { x0: number; x1: number; y0: number; y1: number }[] = [];
    const labels: { k: string; x: number; y: number; text: string }[] = [];
    // label at the best point that is in view (zoomed in, a model's best point may be off screen)
    const best = [...groups.entries()].map(([k, ps]) => ({ k, vis: ps.filter(inside) }))
      .filter((g) => g.vis.length > 0)
      .map(({ k, vis }) => ({ k, p: vis.reduce((a, b) => (value(b, y)! > value(a, y)! ? b : a)) }))
      .sort((a, b) => value(b.p, y)! - value(a.p, y)!);
    for (const { k, p } of best) {
      if (labels.length >= (full ? 80 : 18)) break;
      if (!inside(p)) continue;
      const lx = sx.map(value(p, x)!) + R + 4, ly = sy.map(value(p, y)!) + 4;
      const w = p.model_name.length * 6.4, box_ = { x0: lx, x1: lx + w, y0: ly - 11, y1: ly + 3 };
      if (box_.x1 > W - 4 || placed.some((b) => b.x0 < box_.x1 && box_.x0 < b.x1 && b.y0 < box_.y1 && box_.y0 < b.y1)) continue;
      placed.push(box_);
      labels.push({ k, x: lx, y: ly, text: p.model_name });
    }
    return { sx, sy, groups, lines, labels };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usable.length, points, x, y, logX, logY, W, Hc, view, fit, full, R]);

  // ---- whiteboard controls (full screen) ----
  const plotRef = useRef(plot);
  plotRef.current = plot;
  const zoomAt = useCallback((px: number, py: number, f: number) => {
    const pl = plotRef.current;
    if (!pl) return;
    setView({ x: zoomDom(pl.sx.dom, pl.sx.invert(px), f), y: zoomDom(pl.sy.dom, pl.sy.invert(py), f) });
  }, []);
  useEffect(() => {
    const el = box.current;
    if (!full || !el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const pl = plotRef.current;
      if (!pl) return;
      const r = el.getBoundingClientRect();
      if (e.shiftKey) {                                   // Shift+wheel: scroll sideways
        const [a, b] = pl.sx.dom, d = ((e.deltaY || e.deltaX) / (pl.sx.r1 - pl.sx.r0)) * (b - a);
        setView({ x: [a + d, b + d], y: pl.sy.dom });
        return;
      }
      const f = Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));   // trackpad pinch sends ctrl+wheel
      zoomAt(e.clientX - r.left, e.clientY - r.top, f);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [full, zoomAt]);
  const onPointerDown = (e: React.PointerEvent) => {
    if (!full || e.button !== 0 || !plot) return;
    drag.current = { px: e.clientX, py: e.clientY, x: plot.sx.dom, y: plot.sy.dom };
    setDragging(true);
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current, pl = plotRef.current;
    if (!d || !pl) return;
    const dx = ((e.clientX - d.px) / (pl.sx.r1 - pl.sx.r0)) * (d.x[1] - d.x[0]);
    const dy = ((e.clientY - d.py) / (pl.sy.r1 - pl.sy.r0)) * (d.y[1] - d.y[0]);
    setView({ x: [d.x[0] - dx, d.x[1] - dx], y: [d.y[0] - dy, d.y[1] - dy] });
    setHover(null);
  };
  const onPointerUp = () => { drag.current = null; setDragging(false); };
  const zoomCenter = (f: number) => zoomAt((M.left + W - M.right) / 2, (M.top + Hc - M.bottom) / 2, f);

  const options = (current: MetricKey) => AXIS_ORDER.map((k) => (
    <option key={k} value={k} disabled={cov[k] === 0 && k !== current}>{METRICS[k].short} ({cov[k]})</option>
  ));
  const missing = points.length - usable.length;
  const pointsByGroup = (k: string) => plot?.groups.get(k) ?? [];
  const dim = hover ? (k: string) => (k === hover.group ? 1 : 0.18)
    : keyHover ? (k: string) => (pointsByGroup(k).some((p) => keyOf(p) === keyHover) ? 1 : 0.12) : () => 1;

  return (
    <div ref={root} className={`tc${pending ? " busy" : ""}${full ? " full" : ""}${dragging ? " dragging" : ""}`}>
      <div className="tc-controls" role="group" aria-label="Chart axes">
        <label>Y axis <select value={y} onChange={(e) => setParam({ y: e.target.value === "quality" ? null : e.target.value, logy: null })}>{options(y)}</select></label>
        <label className="tc-log"><input type="checkbox" checked={logY} onChange={(e) => setParam({ logy: e.target.checked === METRICS[y].log ? null : e.target.checked ? "1" : "0" })} /> log</label>
        <label>X axis <select value={x} onChange={(e) => setParam({ x: e.target.value, logx: null })}>{options(x)}</select></label>
        <label className="tc-log"><input type="checkbox" checked={logX} onChange={(e) => setParam({ logx: e.target.checked === METRICS[x].log ? null : e.target.checked ? "1" : "0" })} /> log</label>
        <label>Colour by <select value={colorBy} onChange={(e) => setParam({ color: e.target.value === "developer" ? null : e.target.value, grey: null })}>
          <option value="developer">Developer</option><option value="yugos">Yugos availability</option>
          <option value="effort">Effort level</option><option value="none">One colour</option>
        </select></label>
        {!full ? (
          <button type="button" className="button tc-fs" onClick={enterFull} title="Open the chart full screen: wheel zooms, drag pans">⛶ Full screen</button>
        ) : (
          <span className="tc-zoom" role="group" aria-label="Zoom">
            <button type="button" className="button" onClick={() => zoomCenter(0.7)} title="Zoom in (wheel up)">+</button>
            <button type="button" className="button" onClick={() => zoomCenter(1 / 0.7)} title="Zoom out (wheel down)">−</button>
            <button type="button" className="button" onClick={() => setView(null)} disabled={!view} title="Fit every point (double-click)">Reset view</button>
            <button type="button" className="button primary" onClick={exitFull} title="Esc">Exit full screen</button>
          </span>
        )}
        <span className="tc-legend">
          <svg width="14" height="14" aria-hidden="true"><circle cx="7" cy="7" r="4.5" className="tc-dot" style={{ ["--c" as string]: "var(--tc-ink2)" }} /></svg> Yugos can route
          <svg width="14" height="14" aria-hidden="true"><circle cx="7" cy="7" r="4" className="tc-dot hollow" style={{ ["--c" as string]: "var(--tc-ink2)" }} /></svg> not on Yugos
          <svg width="22" height="14" aria-hidden="true"><line x1="1" y1="7" x2="21" y2="7" className="tc-line" style={{ ["--c" as string]: "var(--tc-ink2)" }} /></svg> one model’s efforts, low → max
        </span>
      </div>

      {/* the colour key: what each colour means; hover highlights, click greys out */}
      {colorBy !== "none" && (
        <div className="tc-key" role="group" aria-label="Colour key" onMouseLeave={() => setKeyHover(null)}>
          {keys.map((k) => (
            <button key={k.id} type="button" className={`tc-key-item${greySet.has(k.id) ? " off" : ""}`} title={k.title ?? (greySet.has(k.id) ? "Click to colour again" : "Hover to highlight · click to grey out")}
                    aria-pressed={!greySet.has(k.id)} onMouseEnter={() => setKeyHover(k.id)} onFocus={() => setKeyHover(k.id)}
                    onBlur={() => setKeyHover(null)} onClick={() => toggleGrey(k.id)}>
              <span className="tc-swatch" style={{ background: k.color }} aria-hidden="true" />
              {k.label} <span className="tc-key-n">{k.count}</span>
            </button>
          ))}
          {grey.length > 0 && <button type="button" className="link tc-key-reset" onClick={() => setParam({ grey: null })}>Colour all</button>}
        </div>
      )}

      <div className="tc-plot" ref={box} onMouseLeave={() => setHover(null)}>
        {!plot ? (
          <p className="empty">No points have both {mx.short.toLowerCase()} and {my.short.toLowerCase()} for the chosen models. Pick other axes.</p>
        ) : (
          <svg width={W} height={Hc} role="img" onPointerDown={onPointerDown} onPointerMove={onPointerMove}
               onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onDoubleClick={() => full && setView(null)} aria-label={`${my.label} against ${mx.label}, ${usable.length} model configurations`}>
            <defs><clipPath id="tc-clip"><rect x={M.left} y={M.top} width={W - M.left - M.right} height={Hc - M.top - M.bottom} /></clipPath></defs>
            {/* grid + axes: recessive */}
            {plot.sy.ticks.filter((t) => plot.sy.map(t) >= M.top - 1 && plot.sy.map(t) <= Hc - M.bottom + 1).map((t) => (
              <g key={`y${t}`}>
                <line x1={M.left} x2={W - M.right} y1={plot.sy.map(t)} y2={plot.sy.map(t)} className="tc-grid" />
                <text x={M.left - 8} y={plot.sy.map(t) + 4} className="tc-tick" textAnchor="end">{my.format(t)}</text>
              </g>
            ))}
            {plot.sx.ticks.filter((t) => plot.sx.map(t) >= M.left - 1 && plot.sx.map(t) <= W - M.right + 1).map((t) => (
              <g key={`x${t}`}>
                <line x1={plot.sx.map(t)} x2={plot.sx.map(t)} y1={M.top} y2={Hc - M.bottom} className="tc-grid" />
                <text x={plot.sx.map(t)} y={Hc - M.bottom + 18} className="tc-tick" textAnchor="middle">{mx.format(t)}</text>
              </g>
            ))}
            <text x={(M.left + W - M.right) / 2} y={Hc - 10} className="tc-axis" textAnchor="middle">{mx.label}{logX ? " · log scale" : ""}</text>
            <text transform={`translate(16 ${(M.top + Hc - M.bottom) / 2}) rotate(-90)`} className="tc-axis" textAnchor="middle">{my.label}{logY ? " · log" : ""}</text>

            <g clipPath="url(#tc-clip)">
            {/* a model's efforts joined */}
            {plot.lines.map((l) => (
              <polyline key={l.k} className="tc-line" style={{ opacity: dim(l.k), ["--c" as string]: colorOfKey(keyOf(l.pts[0])) }}
                points={l.pts.map((p) => `${plot.sx.map(value(p, x)!)},${plot.sy.map(value(p, y)!)}`).join(" ")} />
            ))}
            {/* points: filled = Yugos can route it */}
            {[...plot.groups.entries()].map(([k, ps]) => ps.map((p) => (
              <circle key={`${k}${p.config}`} cx={plot.sx.map(value(p, x)!)} cy={plot.sy.map(value(p, y)!)} r={p.yugos_providers.length ? R : R - 0.5}
                      className={`tc-dot${p.yugos_providers.length ? "" : " hollow"}`}
                      style={{ opacity: keyHover && keyOf(p) !== keyHover ? 0.12 : dim(k), ["--c" as string]: colorOfKey(keyOf(p)) }} />
            )))}
            </g>
            {/* selective labels: one per model at its best point (and the hovered model) */}
            {plot.labels.map((l) => (
              <text key={l.k} x={l.x} y={l.y} className="tc-label"
                    style={{ opacity: hover ? (hover.group !== l.k ? 0.15 : 1)
                      : keyHover ? (pointsByGroup(l.k).some((p) => keyOf(p) === keyHover) ? 1 : 0.15) : 1 }}>{l.text}</text>
            ))}
            {hover && !plot.labels.some((l) => l.k === hover.group) && (
              <text x={hover.px + R + 4} y={hover.py + 4} className="tc-label">{hover.p.model_name}</text>
            )}
            {/* hit targets bigger than the marks */}
            {[...plot.groups.entries()].map(([k, ps]) => ps.map((p) => {
              const px = plot.sx.map(value(p, x)!), py = plot.sy.map(value(p, y)!);
              return (
                <circle key={`h${k}${p.config}`} cx={px} cy={py} r={Math.max(12, R + 6)} className="tc-hit" tabIndex={0}
                        aria-label={`${p.model_name} ${variant(p)}: ${my.short} ${my.format(value(p, y)!)}, ${mx.short} ${mx.format(value(p, x)!)}`}
                        onMouseEnter={() => setHover({ group: k, p, px, py })} onFocus={() => setHover({ group: k, p, px, py })}
                        onBlur={() => setHover(null)} />
              );
            }))}
          </svg>
        )}
        {hover && plot && (
          <div className="tc-tip" style={{ left: Math.min(hover.px + 14, W - 250), top: Math.min(Math.max(hover.py - 10, 0), Hc - 150) }}>
            <b>{hover.p.model_name}</b> <span className="subtle">{variant(hover.p)}</span>
            <div className="subtle"><span className="tc-swatch" style={{ background: colorOfKey(keyOf(hover.p)) }} aria-hidden="true" /> {hover.p.provider}</div>
            <div>{my.short}: <b>{my.format(value(hover.p, y)!)}</b></div>
            <div>{mx.short}: <b>{mx.format(value(hover.p, x)!)}</b></div>
            {(plot.groups.get(hover.group) ?? []).length > 1 && (
              <div className="tc-ladder">
                {[...(plot.groups.get(hover.group) ?? [])].sort((a, b) => (a.effort_rank ?? -1) - (b.effort_rank ?? -1)).map((p) => (
                  <span key={p.config} className={p.config === hover.p.config ? "on" : ""}>{variant(p)} {my.format(value(p, y)!)}</span>
                ))}
              </div>
            )}
            <div className="muted small">{hover.p.source_name}{hover.p.yugos_providers.length ? ` · Yugos: ${hover.p.yugos_providers.join(", ")}` : " · not on Yugos"}</div>
          </div>
        )}
      </div>
      <p className="muted small tc-note">
        {usable.length} of {points.length} model configurations have both values{missing ? ` (${missing} lack ${[cov[x] < points.length ? mx.short.toLowerCase() : "", cov[y] < points.length ? my.short.toLowerCase() : ""].filter(Boolean).join(" or ")}${logX || logY ? " or are ≤ 0 on a log axis" : ""})` : ""}.
        Each point is a configuration’s latest result; the table below has every result.
        {full && " Wheel or pinch to zoom around the pointer · drag to pan · Shift+wheel to scroll sideways · double-click to fit · Esc to leave."}
      </p>
    </div>
  );
}
