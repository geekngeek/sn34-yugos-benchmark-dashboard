"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { AXIS_ORDER, METRICS, coverage, value, type ChartPoint, type MetricKey } from "@/lib/chartMetrics";
import { autoDomain, scale, zoomDom, type Dom } from "@/lib/chartScale";
import { placeLabels, type LabelIn } from "@/lib/labelPlace";
import { keyClick, keyClickHint } from "@/lib/keyToggle";

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
export const LAB_SLOT: Record<string, number> = { Google: 1, Anthropic: 2, OpenAI: 3, Alibaba: 7, Meta: 5, DeepSeek: 4, xAI: 8, Mistral: 6 };
export const LAB_ORDER = ["Google", "Anthropic", "OpenAI", "Alibaba", "Meta", "DeepSeek", "xAI", "Mistral"];
const RANK_STEP = ["0", "1", "2", "3", "4", "5", "6"];    // effort ladder -> one-hue ordinal ramp (--tc-r0 … --tc-r6)
interface Key { id: string; label: string; color: string; count: number; title?: string }

const H = 460;
export const LOW = 0.42;          // how far the rest of the chart fades while one model is emphasised
export const LOW_LABEL = 0.4;
const M = { top: 18, right: 150, bottom: 52, left: 64 };
const EFFORT_LABEL: Record<string, string> = { none: "Non-reasoning", minimal: "Minimal", low: "Low", medium: "Medium",
  high: "High", xhigh: "Xhigh", max: "Max", enabled: "Reasoning" };
const variant = (p: ChartPoint) =>
  [p.reasoning_effort === null ? "Default" : EFFORT_LABEL[p.reasoning_effort] ?? p.reasoning_effort, p.mode].filter(Boolean).join(" · ");

export function TradeoffChart({ points, x, y, logX, logY, colorBy = "developer", grey = [], customColors = {} }: {
  points: ChartPoint[]; x: MetricKey; y: MetricKey; logX: boolean; logY: boolean; colorBy?: ColorBy; grey?: string[];
  customColors?: Record<string, string>;      // developer -> "#rrggbb", chosen in the colour key (shared, on the server)
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(900);
  const [ready, setReady] = useState(false);
  const showLabels = useSearchParams().get("labels") !== "0";     // ?labels=0: no labels, except on the hovered model       // labels are measured and placed in the browser only (no hydration mismatch)
  useEffect(() => setReady(true), []);
  // hovering a dot only highlights its model; clicking it pins the details card (click again, elsewhere or Esc closes)
  const [hover, setHover] = useState<{ group: string; p: ChartPoint; px: number; py: number } | null>(null);
  const [pinned, setPinned] = useState<{ group: string; p: ChartPoint; px: number; py: number } | null>(null);
  const em = hover ?? pinned;          // what is emphasised
  const [keyHover, setKeyHover] = useState<string | null>(null);     // a colour-key entry being hovered
  const [custom, setCustom] = useState<Record<string, string>>(customColors);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** set a developer's colour (null = its default); saved on the server, so every page and visitor gets it */
  const setDevColor = (dev: string, color: string | null) => {
    setCustom((c) => { const n = { ...c }; if (color) n[dev] = color; else delete n[dev]; return n; });
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {          // the picker fires while dragging: save once it settles
      fetch("/api/chart-colors", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ developer: dev, color }) }).catch(() => undefined);
    }, 350);
  };
  const resetColors = () => {
    setCustom({});
    fetch("/api/chart-colors", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reset: true }) })
      .catch(() => undefined);
  };
  // full screen, whiteboard style: wheel zooms around the pointer, drag pans, Shift+wheel scrolls sideways
  const root = useRef<HTMLDivElement>(null);
  const [full, setFull] = useState(false);
  const [fullH, setFullH] = useState(700);
  const [view, setView] = useState<{ x: Dom; y: Dom } | null>(null);   // null = fit every point
  const drag = useRef<{ px: number; py: number; x: Dom; y: Dom; moved: boolean } | null>(null);
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
    if (colorBy === "developer") return LAB_SLOT[p.provider] || custom[p.provider] ? p.provider : "Other";
    if (colorBy === "yugos") return p.yugos_providers.length ? "routable" : "not";
    if (colorBy === "effort") return p.effort_rank === null ? (p.reasoning_effort === "enabled" ? "enabled" : "default") : `r${p.effort_rank}`;
    return "all";
  };
  const colorOfKey = (k: string): string => {
    if (greySet.has(k)) return "var(--tc-other)";
    if (colorBy === "developer") return custom[k] ?? (LAB_SLOT[k] ? `var(--tc-c${LAB_SLOT[k]})` : "var(--tc-other)");
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
    const order = colorBy === "developer"
      ? [...LAB_ORDER, ...Object.keys(custom).filter((d) => !LAB_SLOT[d]).sort((a, b) => a.localeCompare(b)), "Other"]
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
  }, [points, colorBy, greySet, custom]);
  // developers that share the grey "Other" (they can be given a colour of their own)
  const otherDevs = useMemo(() => colorBy !== "developer" ? [] :
    [...new Set(points.map((p) => p.provider).filter((d) => !LAB_SLOT[d] && !custom[d]))].sort((a, b) => a.localeCompare(b)),
  [points, colorBy, custom]);
  /** the hex a picker starts from: the custom colour, else the default slot's current colour */
  const hexOf = (k: string) => {
    if (custom[k]) return custom[k];
    const el = root.current;
    const v = el && LAB_SLOT[k] ? getComputedStyle(el).getPropertyValue(`--tc-c${LAB_SLOT[k]}`).trim() : "";
    return /^#[0-9a-f]{6}$/i.test(v) ? v : "#888888";
  };
  // all coloured: a click keeps only that one coloured; then clicks add or remove; the last one brings all back
  const toggleGrey = (k: string) => {
    const next = keyClick(keys.map((e) => e.id), grey, k);
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
  useEffect(() => { setView(null); setPinned(null); }, [x, y, logX, logY, points]);        // new axes or data: fit again
  useEffect(() => { setPinned(null); }, [view, W, full]);          // the card's spot moved with the view
  // the pinned card closes on Esc or a click anywhere but a dot (a dot's own click opens, switches or closes it)
  useEffect(() => {
    if (!pinned) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setPinned(null); } };
    const down = (e: PointerEvent) => { if (!(e.target as Element | null)?.closest?.(".tc-hit")) setPinned(null); };
    window.addEventListener("keydown", k, true);
    document.addEventListener("pointerdown", down, true);
    return () => { window.removeEventListener("keydown", k, true); document.removeEventListener("pointerdown", down, true); };
  }, [pinned]);
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
    // every dot in view gets a label, placed in the nearest free gap (lib/labelPlace.ts). A model's best point
    // carries its name; its other effort levels, joined to it by the line, carry just the level ("High").
    const items: (LabelIn & { g: string })[] = [];
    const ordered = [...groups.entries()].map(([k, ps]) => ({ k, vis: ps.filter(inside) })).filter((g) => g.vis.length > 0)
      .map(({ k, vis }) => ({ k, vis, top: vis.reduce((a, b) => (value(b, y)! > value(a, y)! ? b : a)) }))
      .sort((a, b) => value(b.top, y)! - value(a.top, y)!);
    const item = (k: string, p: ChartPoint, text: string) =>
      items.push({ key: `${k}|${p.config}`, g: k, x: sx.map(value(p, x)!), y: sy.map(value(p, y)!), r: R, text });
    for (const { k, top, vis } of ordered) item(k, top, vis.length > 1 && (top.reasoning_effort !== null || top.mode) ? `${top.model_name} (${variant(top)})` : top.model_name);
    for (const { k, top, vis } of ordered) for (const p of vis) if (p !== top) item(k, p, variant(p));
    const group = new Map(items.map((i) => [i.key, i.g]));
    const bounds = { x0: M.left, y0: M.top, x1: W - 4, y1: Hc - M.bottom };
    const labels = !ready || !showLabels ? [] : placeLabels(items, bounds).map((l) => ({ ...l, g: group.get(l.key)! }));
    return { sx, sy, groups, lines, labels, items, bounds };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usable.length, points, x, y, logX, logY, W, Hc, view, fit, full, R, ready, showLabels]);

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
  // a drag starts only once the pointer has moved a few pixels, so a plain click still reaches the dot under it
  const onPointerDown = (e: React.PointerEvent) => {
    if (!full || e.button !== 0 || !plot) return;
    drag.current = { px: e.clientX, py: e.clientY, x: plot.sx.dom, y: plot.sy.dom, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current, pl = plotRef.current;
    if (!d || !pl) return;
    if (!d.moved) {
      if (Math.hypot(e.clientX - d.px, e.clientY - d.py) < 4) return;
      d.moved = true;
      setDragging(true);
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    }
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
  // emphasis: the hovered model (or key entry) is drawn again on top, bigger, outlined and bold; everything else
  // only fades back a little (LOW), so the rest of the chart stays readable
  // labels switched off: only the emphasised model (hovered, clicked, or picked in the key) gets labels
  const shownLabels = useMemo(() => {
    if (!plot) return [];
    if (showLabels) return plot.labels;
    if (!em && !keyHover) return [];
    const on = (g: string) => (em ? g === em.group : (plot.groups.get(g) ?? []).some((p) => keyOf(p) === keyHover));
    const pick = plot.items.filter((i) => on(i.g));
    const gOf = new Map(pick.map((i) => [i.key, i.g]));
    return placeLabels(pick, plot.bounds).map((l) => ({ ...l, g: gOf.get(l.key)! }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plot, showLabels, em, keyHover]);
  const dim = em ? (k: string) => (k === em.group ? 1 : LOW)
    : keyHover ? (k: string) => (pointsByGroup(k).some((p) => keyOf(p) === keyHover) ? 1 : LOW) : () => 1;
  const litPoint = (k: string, p: ChartPoint) => (em ? k === em.group : keyHover ? keyOf(p) === keyHover : false);

  return (
    <div ref={root} className={`tc${pending ? " busy" : ""}${full ? " full" : ""}${dragging ? " dragging" : ""}`}>
      <div className="tc-controls" role="group" aria-label="Chart axes">
        <span className="ctl-grp"><span className="ctl-lab">Y</span><select aria-label="Y axis" value={y} onChange={(e) => setParam({ y: e.target.value === "quality" ? null : e.target.value, logy: null })}>{options(y)}</select>
          <label className="sw"><input type="checkbox" checked={logY} onChange={(e) => setParam({ logy: e.target.checked === METRICS[y].log ? null : e.target.checked ? "1" : "0" })} /> log</label></span>
        <span className="ctl-grp"><span className="ctl-lab">X</span><select aria-label="X axis" value={x} onChange={(e) => setParam({ x: e.target.value, logx: null })}>{options(x)}</select>
          <label className="sw"><input type="checkbox" checked={logX} onChange={(e) => setParam({ logx: e.target.checked === METRICS[x].log ? null : e.target.checked ? "1" : "0" })} /> log</label></span>
        <span className="ctl-grp"><span className="ctl-lab">Colour</span><select aria-label="Colour by" value={colorBy} onChange={(e) => setParam({ color: e.target.value === "developer" ? null : e.target.value, grey: null })}>
          <option value="developer">Developer</option><option value="yugos">Yugos availability</option>
          <option value="effort">Effort level</option><option value="none">One colour</option>
        </select></span>
        <span className="ctl-grp"><span className="ctl-lab">Show</span><label className="sw" title="Off: labels appear only on the model you hover"><input type="checkbox" checked={showLabels}
          onChange={(e) => setParam({ labels: e.target.checked ? null : "0" })} /> Labels</label></span>
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
          <svg width="22" height="14" aria-hidden="true"><line x1="1" y1="7" x2="21" y2="7" className="tc-line tc-effort" style={{ ["--c" as string]: "var(--tc-ink2)" }} /></svg> one model’s efforts, low → max
        </span>
      </div>

      {/* the colour key: what each colour means; hover highlights, click greys out */}
      {colorBy !== "none" && (
        <div className="tc-key" role="group" aria-label="Colour key" onMouseLeave={() => setKeyHover(null)}>
          {keys.map((k) => {
            const pickable = colorBy === "developer" && k.id !== "Other";
            return (
              <span key={k.id} className={`tc-key-item${greySet.has(k.id) ? " off" : ""}`}
                    onMouseEnter={() => setKeyHover(k.id)} onMouseLeave={() => setKeyHover(null)}>
                {pickable ? (
                  <label className="tc-swatch-pick" title={`Change ${k.label}'s colour`}>
                    <span className="tc-swatch" style={{ background: k.color }} />
                    <input type="color" value={hexOf(k.id)} aria-label={`Colour for ${k.label}`}
                           onChange={(e) => setDevColor(k.id, e.target.value)} />
                  </label>
                ) : <span className="tc-swatch" style={{ background: k.color }} aria-hidden="true" />}
                <button type="button" className="tc-key-name" aria-pressed={!greySet.has(k.id)} onFocus={() => setKeyHover(k.id)}
                        onBlur={() => setKeyHover(null)} onClick={() => toggleGrey(k.id)}
                        title={`${k.title ? `${k.title}\n` : ""}${keyClickHint(keys.map((e) => e.id), grey, k.id, { on: "colour it again", off: "grey it out" })}`}>
                  {k.label} <span className="tc-key-n">{k.count}</span>
                </button>
                {custom[k.id] && (
                  <button type="button" className="tc-key-x" title={`Put ${k.label}'s default colour back`} onClick={() => setDevColor(k.id, null)}>↺</button>
                )}
              </span>
            );
          })}
          {otherDevs.length > 0 && (
            <select className="tc-key-add" value="" aria-label="Give a developer in Other its own colour"
                    onChange={(e) => { if (e.target.value) setDevColor(e.target.value, "#7a5c3e"); }}>
              <option value="">+ Add colour for…</option>
              {otherDevs.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          )}
          {grey.length > 0 && <button type="button" className="link tc-key-reset" onClick={() => setParam({ grey: null })}>Colour all</button>}
          {Object.keys(custom).length > 0 && <button type="button" className="link tc-key-reset" onClick={resetColors}>Reset colours</button>}
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
            {/* a light halo under each line keeps it readable where lines cross */}
            {plot.lines.map((l) => {
              const pts = l.pts.map((p) => `${plot.sx.map(value(p, x)!)},${plot.sy.map(value(p, y)!)}`).join(" ");
              return (
                <g key={l.k} style={{ opacity: dim(l.k), ["--c" as string]: colorOfKey(keyOf(l.pts[0])) }}>
                  <polyline className="tc-effort-halo" points={pts} />
                  <polyline className="tc-line tc-effort" points={pts} />
                </g>
              );
            })}
            {/* points: filled = Yugos can route it */}
            {[...plot.groups.entries()].map(([k, ps]) => ps.map((p) => (
              <circle key={`${k}${p.config}`} cx={plot.sx.map(value(p, x)!)} cy={plot.sy.map(value(p, y)!)} r={p.yugos_providers.length ? R : R - 0.5}
                      className={`tc-dot${p.yugos_providers.length ? "" : " hollow"}`}
                      style={{ opacity: keyHover && keyOf(p) !== keyHover ? LOW : dim(k), ["--c" as string]: colorOfKey(keyOf(p)) }} />
            )))}
            {/* the emphasised model on top: thicker line, bigger outlined dots */}
            {(em || keyHover) && (
              <g className="tc-hl">
                {plot.lines.filter((l) => l.pts.some((p) => litPoint(l.k, p))).map((l) => (
                  <polyline key={`hl${l.k}`} className="tc-line hl" style={{ ["--c" as string]: colorOfKey(keyOf(l.pts[0])) }}
                    points={l.pts.map((p) => `${plot.sx.map(value(p, x)!)},${plot.sy.map(value(p, y)!)}`).join(" ")} />
                ))}
                {[...plot.groups.entries()].map(([k, ps]) => ps.filter((p) => litPoint(k, p)).map((p) => (
                  <circle key={`hl${k}${p.config}`} cx={plot.sx.map(value(p, x)!)} cy={plot.sy.map(value(p, y)!)} r={R + 1.5}
                          className={`tc-dot hl${p.yugos_providers.length ? "" : " hollow"}`} style={{ ["--c" as string]: colorOfKey(keyOf(p)) }} />
                )))}
              </g>
            )}
            </g>
            {/* every dot labelled; a label set apart from its dot has a leader line */}
            {shownLabels.map((l) => {
              const on = em ? em.group === l.g : keyHover ? pointsByGroup(l.g).some((p) => keyOf(p) === keyHover) : null;
              const o = on === null ? (l.crowded ? 0.3 : 1) : on ? 1 : LOW_LABEL;
              return (
                <g key={l.key} style={{ opacity: o }} className={on ? "tc-lab-hl" : undefined}>
                  {l.leader && <line x1={l.leader[0]} y1={l.leader[1]} x2={l.leader[2]} y2={l.leader[3]} className="tc-leader" />}
                  <text x={l.tx} y={l.ty} className="tc-label">{l.text}</text>
                </g>
              );
            })}
            {/* hit targets bigger than the marks */}
            {[...plot.groups.entries()].map(([k, ps]) => ps.map((p) => {
              const px = plot.sx.map(value(p, x)!), py = plot.sy.map(value(p, y)!);
              return (
                <circle key={`h${k}${p.config}`} cx={px} cy={py} r={Math.max(12, R + 6)} className="tc-hit" tabIndex={0}
                        aria-label={`${p.model_name} ${variant(p)}: ${my.short} ${my.format(value(p, y)!)}, ${mx.short} ${mx.format(value(p, x)!)}`}
                        onMouseEnter={() => setHover({ group: k, p, px, py })} onMouseLeave={() => setHover(null)}
                        onFocus={() => setHover({ group: k, p, px, py })} onBlur={() => setHover(null)}
                        onClick={(e) => { e.stopPropagation(); setPinned((c) => (c && c.group === k && c.p.config === p.config ? null : { group: k, p, px, py })); }}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setPinned((c) => (c && c.p.config === p.config && c.group === k ? null : { group: k, p, px, py })); } }} />
              );
            }))}
          </svg>
        )}
        {pinned && plot && (
          <div className="tc-tip" style={{ left: Math.min(pinned.px + 14, W - 250), top: Math.min(Math.max(pinned.py - 10, 0), Hc - 150) }}>
            <b>{pinned.p.model_name}</b> <span className="subtle">{variant(pinned.p)}</span>
            <div className="subtle"><span className="tc-swatch" style={{ background: colorOfKey(keyOf(pinned.p)) }} aria-hidden="true" /> {pinned.p.provider}</div>
            <div>{my.short}: <b>{my.format(value(pinned.p, y)!)}</b></div>
            <div>{mx.short}: <b>{mx.format(value(pinned.p, x)!)}</b></div>
            {(plot.groups.get(pinned.group) ?? []).length > 1 && (
              <div className="tc-ladder">
                {[...(plot.groups.get(pinned.group) ?? [])].sort((a, b) => (a.effort_rank ?? -1) - (b.effort_rank ?? -1)).map((p) => (
                  <span key={p.config} className={p.config === pinned.p.config ? "on" : ""}>{variant(p)} {my.format(value(p, y)!)}</span>
                ))}
              </div>
            )}
            <div className="muted small">{pinned.p.source_name}{pinned.p.yugos_providers.length ? ` · Yugos: ${pinned.p.yugos_providers.join(", ")}` : " · not on Yugos"}</div>
          </div>
        )}
      </div>
      <p className="muted small tc-note">
        {usable.length} of {points.length} model configurations have both values{missing ? ` (${missing} lack ${[cov[x] < points.length ? mx.short.toLowerCase() : "", cov[y] < points.length ? my.short.toLowerCase() : ""].filter(Boolean).join(" or ")}${logX || logY ? " or are ≤ 0 on a log axis" : ""})` : ""}.
        Each point is a configuration’s latest result; the table below has every result. Hover a dot to highlight its model; click it for its values.
        {full && " Wheel or pinch to zoom around the pointer · drag to pan · Shift+wheel to scroll sideways · double-click to fit · Esc to leave."}
      </p>
    </div>
  );
}
