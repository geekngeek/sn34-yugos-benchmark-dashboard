"use client";

import Link from "next/link";
import { HoverTip } from "@/components/HoverTip";
import { ResetColumns, useColumnLayout, type ColDef, type SavedLayout } from "@/lib/columnLayout";
import type { Result } from "@/lib/types";
import { benchmarkTitle, effortLabel, formatDate, formatNumber, formatPercent, formatScore, formatUsd } from "@/lib/format";

/** a header as the page built it: label, and the sort link (null = not sortable) */
export interface ResultsColumn {
  key: string;
  label: string;
  numeric?: boolean;
  href: string | null;
  active: boolean;
  order: "asc" | "desc";
}

// default order and widths (px) of the results table's columns
const DEFS: ColDef[] = [
  { key: "model", width: 160, min: 80 }, { key: "developer", width: 100 }, { key: "benchmark", width: 240, min: 100 },
  { key: "area", width: 80 }, { key: "effort", width: 75, fixed: true }, { key: "score", width: 120, min: 60, fixed: true },
  { key: "accuracy", width: 95, min: 60, fixed: true }, { key: "cost", width: 90, min: 60, fixed: true }, { key: "speed", width: 70, min: 50, fixed: true },
  { key: "date", width: 115, min: 80, fixed: true }, { key: "source", width: 150 },
];

/** The results table: columns can be dragged into another order and resized; the layout is saved on the server. */
export function ResultsTable({ items, columns, layout, layoutId = "results" }: {
  items: Result[];
  columns: ResultsColumn[];
  layout?: SavedLayout;
  layoutId?: string;            // which saved column layout this table uses (each page can keep its own)
}) {
  const cl = useColumnLayout(layoutId, DEFS, layout, 2);
  const head = new Map(columns.map((c) => [c.key, c]));

  const cell = (key: string, r: Result) => {
    switch (key) {
      case "model": return (
        <td key={key} className="model clip" data-tip
            title={[r.model_key && `Model ID: ${r.model_key}`, r.raw_model_name && `Source's name: ${r.raw_model_name}`].filter(Boolean).join("\n") || undefined}>
          {r.model_name}
          {r.model_snapshot && <span className="muted"> · {r.model_snapshot}</span>}
        </td>
      );
      case "developer": return <td key={key} className="clip" data-tip>{r.provider}</td>;
      case "benchmark": return (
        <td key={key} className="clip bench" data-tip>
          {benchmarkTitle(r.benchmark_name, r.benchmark_version)}
          {r.sub_area && <span className="muted"> · {r.sub_area}</span>}
        </td>
      );
      case "area": return <td key={key} className="subtle" data-tip>{r.area ?? "—"}</td>;
      case "effort": return (
        <td key={key} className="subtle" data-tip title={r.mode ? `Run mode: ${r.mode}` : undefined}>
          {effortLabel(r.reasoning_effort)}{r.mode && <span className="muted"> · {r.mode}</span>}
        </td>
      );
      case "score": return <td key={key} className="num strong"><Score r={r} /></td>;
      case "accuracy": return <td key={key} className="num">{formatPercent(r.accuracy)}</td>;
      case "cost": return <td key={key} className="num">{formatUsd(r.cost_per_task_usd)}</td>;
      case "speed": return <td key={key} className="num">{formatNumber(r.tokens_per_sec)}</td>;
      case "date": return (
        <td key={key} className="num">
          {r.evaluation_date ? formatDate(r.evaluation_date) : (
            <span className="muted" title="No evaluation date published; this is the collection date">{formatDate(r.collected_at)}*</span>
          )}
        </td>
      );
      case "source": return <td key={key} className="subtle clip" data-tip>{r.source_name}</td>;
      default: return <td key={key} />;
    }
  };

  return (
    <>
      <div className="results-cols"><ResetColumns layout={cl} /></div>
      <HoverTip className="table-wrap">
        <div ref={cl.root} className="cl-fit">
        <table className="grid results cl" style={{ width: cl.total }}>
          <colgroup>{cl.cols.map((c) => <col key={c.key} style={{ width: cl.width(c.key) }} />)}</colgroup>
          <thead>
            <tr>
              {cl.cols.map(({ key }) => {
                const c = head.get(key)!;
                const hp = cl.head(key);
                return (
                  <th key={key} {...hp} className={`${hp.className}${c.numeric ? " num" : ""}`} style={{ width: cl.width(key) }}
                      aria-sort={c.active ? (c.order === "asc" ? "ascending" : "descending") : undefined}>
                    {c.href ? (
                      <Link href={c.href} draggable={false} className={`sort${c.active ? " active" : ""}`}>
                        {c.label}
                        <span className="arrow" aria-hidden="true">{c.active ? (c.order === "asc" ? "▲" : "▼") : "↕"}</span>
                      </Link>
                    ) : c.label}
                    {cl.grip(key)}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {items.map((r) => <tr key={r.id}>{cl.cols.map((c) => cell(c.key, r))}</tr>)}
          </tbody>
        </table>
        </div>
      </HoverTip>
    </>
  );
}

/** the 0-100 score, with the original number and its scale before it when it was converted */
function Score({ r }: { r: Result }) {
  const raw = formatScore(r.benchmark_score, r.score_unit);
  if (r.display_score !== null && r.display_score !== undefined) {
    const original = r.scale_note === "Elo" ? `Elo ${raw}` : `${raw} ${r.scale_note ?? ""}`.trim();
    return (
      <span title={`Converted to 0–100 from the published ${original}`}>
        <span className="muted rating">{original}</span>{r.display_score.toFixed(1)}
      </span>
    );
  }
  if (r.scale_note) {
    return (
      <span title="Not on a 0–100 scale; shown as published and sorted after the 0–100 scores">
        <span className="muted rating">{r.scale_note}</span>{raw}
      </span>
    );
  }
  return <>{raw}</>;
}
