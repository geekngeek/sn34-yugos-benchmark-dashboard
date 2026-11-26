"use client";

import Link from "next/link";
import { HoverTip } from "@/components/HoverTip";
import { ResetColumns, useColumnLayout, type ColDef, type SavedLayout } from "@/lib/columnLayout";

export interface SubRow {
  no: string;
  name: string;
  category: string;
  focus: string;
  results: number;          // results in the database for this sub-benchmark (0 = none)
  sources: string[];        // where those results come from
}

const DEFS: ColDef[] = [
  { key: "no", width: 56, min: 40, fixed: true }, { key: "name", width: 280, min: 120 },
  { key: "category", width: 170 }, { key: "focus", width: 380, min: 120 }, { key: "data", width: 220, min: 90 },
];
const LABEL: Record<string, string> = { no: "No", name: "Sub-benchmark", category: "Category", focus: "Focus", data: "Results in database" };

/** A benchmark's sub-benchmarks; each name opens its own details page. Columns move and resize like every table. */
export function SubBenchmarkTable({ rows, layout }: { rows: SubRow[]; layout?: SavedLayout }) {
  const cl = useColumnLayout("benchmark-subs", DEFS, layout, 2);
  const cell = (key: string, r: SubRow) => {
    switch (key) {
      case "no": return <td key={key} className="num muted">{r.no}</td>;
      case "name": return (
        <td key={key} className="clip" data-tip>
          <Link className="bl-name-link" href={`/benchmarks/${encodeURIComponent(r.no)}`}>{r.name}</Link>
        </td>
      );
      case "category": return <td key={key} className="clip subtle" data-tip>{r.category || "—"}</td>;
      case "focus": return <td key={key} className="clip subtle" data-tip>{r.focus || "—"}</td>;
      case "data": return (
        <td key={key} className="clip" data-tip title={r.sources.join(", ")}>
          {r.results ? <>{r.results.toLocaleString("en-US")} <span className="muted">· {r.sources.join(", ")}</span></>
                     : <span className="muted">no separate results</span>}
        </td>
      );
      default: return <td key={key} />;
    }
  };
  return (
    <>
      <div className="results-cols"><ResetColumns layout={cl} /></div>
      <HoverTip className="table-wrap">
        <div ref={cl.root} className="cl-fit">
          <table className="grid cl" style={{ width: cl.total }}>
            <colgroup>{cl.cols.map((c) => <col key={c.key} style={{ width: cl.width(c.key) }} />)}</colgroup>
            <thead>
              <tr>
                {cl.cols.map(({ key }) => {
                  const hp = cl.head(key);
                  return (
                    <th key={key} {...hp} className={`${hp.className}${key === "no" ? " num" : ""}`} style={{ width: cl.width(key) }}>
                      {LABEL[key]}{cl.grip(key)}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>{rows.map((r) => <tr key={r.no}>{cl.cols.map((c) => cell(c.key, r))}</tr>)}</tbody>
          </table>
        </div>
      </HoverTip>
    </>
  );
}
