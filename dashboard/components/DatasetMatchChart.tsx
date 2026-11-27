"use client";

// Datasets: match % (y) against how many questions there are (x, log scale), one dot per dataset coloured by the
// Yugos category it fits best. Up and to the right = many questions that behave like Yugos's.
import { useEffect, useMemo, useState } from "react";
import { scale } from "@/lib/chartScale";
import { placeLabels } from "@/lib/labelPlace";
import { CAT_LABEL, MATCH_CATS, type DatasetMatch, type MatchCat } from "@/lib/yugosMatch";

export type YMetric = "best" | MatchCat;
const W = 960, H = 380, M = { l: 52, r: 20, t: 16, b: 44 };
const UNKNOWN_W = 54;   // strip on the left for datasets whose size isn't known

export const datasetSize = (d: DatasetMatch): number | null => d.n_questions ?? d.hub?.rows_total ?? null;
export const yValue = (d: DatasetMatch, y: YMetric) => (y === "best" ? d.best.match : d.match[y].match);
export const colourCat = (d: DatasetMatch, y: YMetric): MatchCat => (y === "best" ? d.best.category : y);

export function DatasetMatchChart({ data, y, selected, onSelect }: { data: DatasetMatch[]; y: YMetric; selected: string | null; onSelect: (id: string) => void }) {
  const [hover, setHover] = useState<string | null>(null);
  const [ready, setReady] = useState(false);   // labels are measured with the browser's font: place them after mount
  useEffect(() => setReady(true), []);
  const plot = { x0: M.l + UNKNOWN_W, x1: W - M.r, y0: M.t, y1: H - M.b };
  const pts = useMemo(() => {
    const sizes = data.map(datasetSize).filter((v): v is number => !!v && v > 0);
    const lo = Math.max(1, Math.min(...sizes, 10) / 1.5), hi = Math.max(...sizes, 1000) * 1.5;
    const sx = scale([Math.log10(lo), Math.log10(hi)], true, plot.x0, plot.x1);
    const sy = scale([0, 1], false, plot.y1, plot.y0);
    // datasets of unknown size: spread across the left strip by id so they don't stack
    const out = data.map((d, i) => {
      const n = datasetSize(d);
      const x = n && n > 0 ? sx.map(n) : M.l + 8 + ((i * 37) % (UNKNOWN_W - 16));
      return { d, x, y: sy.map(yValue(d, y)), cat: colourCat(d, y), n };
    });
    return { out, sx, sy };
  }, [data, y]); // eslint-disable-line react-hooks/exhaustive-deps

  const labels = useMemo(() => {
    if (!ready) return [];
    const top = [...pts.out].filter((p) => p.n).sort((a, b) => yValue(b.d, y) - yValue(a.d, y)).slice(0, 10);
    return placeLabels(top.map((p) => ({ key: p.d.id, x: p.x, y: p.y, r: 5, text: p.d.name.length > 28 ? `${p.d.name.slice(0, 27)}…` : p.d.name })),
      { x0: plot.x0, x1: plot.x1, y0: plot.y0, y1: plot.y1 },
      { obstacles: pts.out.filter((p) => !top.includes(p)).map((p) => ({ x0: p.x - 6, x1: p.x + 6, y0: p.y - 6, y1: p.y + 6 })) });
  }, [pts, y, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  const hp = hover ? pts.out.find((p) => p.d.id === hover) : null;
  const counts = MATCH_CATS.map((c) => ({ c, n: pts.out.filter((p) => p.cat === c).length }));
  const yName = y === "best" ? "Best match" : `${CAT_LABEL[y]} match`;
  return (
    <figure className="dsc">
      <figcaption className="dsc-key small">
        {counts.map(({ c, n }) => <span key={c}><span className={`mx-dot mx-${c}`} />{CAT_LABEL[c]} <span className="muted">{n}</span></span>)}
        <span className="muted">· dot colour = {y === "best" ? "the category it fits best" : CAT_LABEL[y]} · up and right = many questions that fit</span>
      </figcaption>
      <div className="dsc-wrap">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${yName} against number of questions, ${data.length} datasets`}>
          {pts.sy.ticks.map((t) => (
            <g key={`y${t}`}>
              <line x1={M.l} x2={plot.x1} y1={pts.sy.map(t)} y2={pts.sy.map(t)} className="dsc-grid" />
              <text x={M.l - 6} y={pts.sy.map(t) + 4} className="dsc-tick" textAnchor="end">{Math.round(t * 100)}%</text>
            </g>
          ))}
          {pts.sx.ticks.filter((t) => [1, 10, 100, 1000, 10000, 100000, 1000000, 10000000].includes(t)).map((t) => (
            <text key={`x${t}`} x={pts.sx.map(t)} y={H - M.b + 16} className="dsc-tick" textAnchor="middle">{t >= 1e6 ? `${t / 1e6}M` : t >= 1e3 ? `${t / 1e3}k` : t}</text>
          ))}
          <line x1={plot.x0 - 6} x2={plot.x0 - 6} y1={plot.y0} y2={plot.y1} className="dsc-sep" />
          <text x={M.l + UNKNOWN_W / 2 - 4} y={H - M.b + 16} className="dsc-tick" textAnchor="middle">size ?</text>
          <text x={(plot.x0 + plot.x1) / 2} y={H - 6} className="dsc-axis" textAnchor="middle">Questions in the dataset (log scale)</text>
          <text x={14} y={(plot.y0 + plot.y1) / 2} className="dsc-axis" textAnchor="middle" transform={`rotate(-90 14 ${(plot.y0 + plot.y1) / 2})`}>{yName}</text>
          {labels.map((l) => (
            <g key={`l${l.key}`} className="dsc-label">
              {l.leader && <line x1={l.leader[0]} y1={l.leader[1]} x2={l.leader[2]} y2={l.leader[3]} className="dsc-leader" />}
              <text x={l.tx} y={l.ty} className={l.crowded ? "crowded" : ""}>{l.text}</text>
            </g>
          ))}
          {pts.out.map((p) => (
            <circle key={p.d.id} cx={p.x} cy={p.y} r={p.d.id === selected ? 7 : 5}
                    className={`dsc-dot mx-${p.cat}${p.d.id === selected ? " sel" : ""}${p.d.yugos === "live" ? " live" : ""}`}
                    onMouseEnter={() => setHover(p.d.id)} onMouseLeave={() => setHover(null)} onClick={() => onSelect(p.d.id)}>
              <title>{`${p.d.name}: ${Math.round(yValue(p.d, y) * 100)}% · ${p.n ? `${p.n.toLocaleString("en-US")} questions` : "size unknown"}`}</title>
            </circle>
          ))}
        </svg>
        {hp && (
          <div className="dsc-tip small" style={{ left: `${(hp.x / W) * 100}%`, top: `${(hp.y / H) * 100}%` }}>
            <b>{hp.d.name}</b>
            <div>{MATCH_CATS.map((c) => `${CAT_LABEL[c]} ${Math.round(hp.d.match[c].match * 100)}%`).join(" · ")}</div>
            <div className="muted">{hp.n ? `${hp.n.toLocaleString("en-US")} questions` : "size unknown"}{hp.d.yugos === "live" ? " · live Yugos set" : ""}</div>
          </div>
        )}
      </div>
      <p className="small muted dsc-note">Hollow ring = a live Yugos public set (only the questions outside the live sample are usable). Click a dot for its details.</p>
    </figure>
  );
}
