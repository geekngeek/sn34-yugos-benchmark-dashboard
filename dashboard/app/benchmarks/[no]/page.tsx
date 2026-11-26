import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ModelPicker } from "@/components/ModelPicker";
import { ResultsTable, type ResultsColumn } from "@/components/ResultsTable";
import { TradeoffChart } from "@/components/TradeoffChart";
import { AXIS_ORDER, METRICS, defaultAxes, type ChartPoint, type MetricKey } from "@/lib/chartMetrics";
import { SubBenchmarkTable, type SubRow } from "@/components/SubBenchmarkTable";
import { api, type BenchmarkInfo, type ModelConfig } from "@/lib/api";
import { parentOf, readBenchmarkMap, readListRows, type ListRow, type MapRef } from "@/lib/benchmarkMap";
import { METRIC_INFO } from "@/lib/metrics";
import { readLayout } from "@/lib/uiLayout";
import { readModelLinks, readState } from "@/lib/yugosModels";
import { readChartColors } from "@/lib/chartColors";
import "./detail.css";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const PAGE_SIZE = 100;
const WHERE = { page: "on the site", data: "in the official data file", paper: "in the paper" } as const;

// the results table's columns (same as the Results page) -> API sort key
const COLUMNS: { key: string; label: string; sort: string | null; numeric?: boolean; firstOrder?: "asc" | "desc" }[] = [
  { key: "model", label: "Model", sort: "model_name", firstOrder: "asc" },
  { key: "developer", label: "Developer", sort: "provider", firstOrder: "asc" },
  { key: "benchmark", label: "Benchmark", sort: "benchmark", firstOrder: "asc" },
  { key: "area", label: "Area", sort: "area", firstOrder: "asc" },
  { key: "effort", label: "Effort", sort: "reasoning_effort", firstOrder: "asc" },
  { key: "score", label: "Score", sort: "benchmark_score", numeric: true },
  { key: "accuracy", label: "Accuracy", sort: "accuracy", numeric: true },
  { key: "cost", label: "$ / task", sort: "cost_per_task_usd", numeric: true, firstOrder: "asc" },
  { key: "speed", label: "Tok/s", sort: "tokens_per_sec", numeric: true },
  { key: "date", label: "Date", sort: "date", numeric: true },
  { key: "source", label: "Source", sort: "source_name", firstOrder: "asc" },
];

async function load(no: string) {
  const [rows, map] = await Promise.all([readListRows(), readBenchmarkMap()]);
  const row = rows.find((r) => r.no === no);
  return { rows, map, row };
}

export async function generateMetadata({ params }: { params: Promise<{ no: string }> }): Promise<Metadata> {
  const no = decodeURIComponent((await params).no);
  const { row } = await load(no);
  return { title: row ? `${row.name} · Benchmark list` : "Benchmark not found" };
}

/**
 * One row of the Benchmark list. A benchmark (No 5) shows its details, its sub-benchmarks and its overall
 * results table; a sub-benchmark (No 5.1) shows its details and its own results. Results come from the
 * database benchmarks the row is linked to in data/benchmark-map.json.
 */
export default async function BenchmarkDetailPage({ params, searchParams }: { params: Promise<{ no: string }>; searchParams: Promise<SP> }) {
  const no = decodeURIComponent((await params).no);
  const sp = await searchParams;
  const { rows, map, row } = await load(no);
  if (!row) notFound();

  const parentNo = parentOf(no);
  const parent = parentNo ? rows.find((r) => r.no === parentNo) : undefined;
  const kids = parentNo ? [] : rows.filter((r) => parentOf(r.no) === no);
  const linked = map[no];

  const [dbList, tableLayout, subLayout] = await Promise.all([
    api.benchmarks().catch((): BenchmarkInfo[] => []),
    readLayout("benchmark-results"),
    readLayout("benchmark-subs"),
  ]);
  const byKey = new Map(dbList.map((b) => [`${b.benchmark_name}|${b.benchmark_version ?? ""}`, b]));
  const info = (r: MapRef) => byKey.get(`${r.name}|${r.version ?? ""}`);

  // which database benchmarks feed the table
  const family = (linked?.benchmarks ?? []).filter((r) => info(r));
  let shown: MapRef[] = [];
  if (!parentNo) {
    const chosen = one(sp.b);                                        // ?b=<benchmark id> switches the table
    const pick = family.find((r) => info(r)?.id === chosen);
    // no single overall benchmark (e.g. τ-bench): open the family's benchmark with the most results
    const biggest = [...family].sort((a, z) => (info(z)?.result_count ?? 0) - (info(a)?.result_count ?? 0))[0];
    shown = pick ? [pick] : linked?.overall && info(linked.overall) ? [linked.overall] : biggest ? [biggest] : [];
  } else {
    shown = family;
  }
  const ids = shown.map((r) => info(r)!.id);

  // model selection (as on Artificial Analysis): ?models=<config>,… / all / none; without it the default:
  // the models selected on the Yugos models page that have results here (else the 30 best)
  const [configs, yugosState, yugosLinks] = await Promise.all([
    ids.length ? api.configs(ids).catch((): ModelConfig[] => []) : Promise.resolve([] as ModelConfig[]),
    readState(), readModelLinks(),
  ]);
  const yugosOut = new Set(yugosState.excluded);
  const yugosIds = [...new Set(Object.entries(yugosLinks).filter(([m]) => !yugosOut.has(m)).map(([, l]) => l.modelId).filter(Boolean))];
  const yugosSet = new Set(yugosIds);
  const fromYugos = configs.filter((c) => yugosSet.has(c.model_key)).map((c) => c.config);
  const defaults = fromYugos.length ? fromYugos : configs.slice(0, 30).map((c) => c.config);
  const defaultNote = fromYugos.length
    ? `Default: the models selected on the Yugos models page (${new Set(configs.filter((c) => yugosSet.has(c.model_key)).map((c) => c.model_key)).size} have results here).`
    : "Default: the 30 best-scoring models (none of the models selected on the Yugos models page has results here).";
  const modelsParam = one(sp.models);
  const selection = !modelsParam ? defaults : modelsParam === "all" ? configs.map((c) => c.config)
    : modelsParam === "none" ? [] : modelsParam.split(",").map((x) => x.trim()).filter(Boolean);
  const everything = selection.length >= configs.length && configs.every((c) => selection.includes(c.config));
  const configsFilter = everything ? undefined : selection.length ? selection.join(",") : "none";

  // sort and page: in the URL like every table in the app
  const sort = one(sp.sort) || "benchmark_score";
  const order = one(sp.order) === "asc" ? "asc" : "desc";
  const pageNo = Math.max(1, Math.floor(Number(one(sp.page)) || 1));
  const data = ids.length
    ? await api.results({ benchmark_id: ids, configs: configsFilter, sort, order, limit: PAGE_SIZE, offset: (pageNo - 1) * PAGE_SIZE }).catch(() => null)
    : null;
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  // the trade-off chart: one point per configuration, same model selection as the table
  const points: ChartPoint[] = ids.length && configsFilter !== "none"
    ? await api.chartPoints(ids, configsFilter).catch((): ChartPoint[] => []) : [];
  const axes = defaultAxes(points);
  const pickAxis = (v: string, fallback: MetricKey) => ((AXIS_ORDER as string[]).includes(v) ? v as MetricKey : fallback);
  const xAxis = pickAxis(one(sp.x), axes.x), yAxis = pickAxis(one(sp.y), axes.y);
  const logOf = (v: string, k: MetricKey) => (v === "1" ? true : v === "0" ? false : METRICS[k].log);
  const href = (changes: { sort?: string; order?: string; page?: number; b?: string | null }) => {
    const qs = new URLSearchParams();
    const b = changes.b === undefined ? one(sp.b) : changes.b;
    if (b) qs.set("b", b);
    if (modelsParam) qs.set("models", modelsParam);          // the model selection belongs to the page, not one table
    for (const k of ["x", "y", "logx", "logy", "color", "grey", "labels"]) if (one(sp[k])) qs.set(k, one(sp[k]));   // chart settings
    const s = changes.sort ?? sort, o = changes.order ?? order;
    if (s !== "benchmark_score" || o !== "desc") { qs.set("sort", s); qs.set("order", o); }
    const pg = changes.page ?? pageNo;
    if (pg > 1) qs.set("page", String(pg));
    return `/benchmarks/${encodeURIComponent(no)}${qs.size ? `?${qs}` : ""}`;
  };

  const subRows: SubRow[] = kids.map((k) => {
    const refs = (map[k.no]?.benchmarks ?? []).filter((r) => info(r));
    return { no: k.no, name: k.name, category: k.category, focus: k.focus,
             results: refs.reduce((n, r) => n + (info(r)?.result_count ?? 0), 0), sources: [...new Set(refs.map((r) => r.source))] };
  });
  const withData = subRows.filter((s) => s.results).length;

  return (
    <main className="page wide bd">
      <nav className="bd-crumbs small" aria-label="Breadcrumb">
        <Link href="/benchmarks">Benchmark list</Link>
        {parent && <> <span aria-hidden="true">›</span> <Link href={`/benchmarks/${encodeURIComponent(parent.no)}`}>{parent.name}</Link></>}
        <span aria-hidden="true"> ›</span> <span>{row.name}</span>
      </nav>

      <header className="bd-head">
        <div>
          <h1><span className="bd-no">{row.no}</span> {row.name}</h1>
          <p className="bd-tags">
            {parentNo ? <span className="chip">Sub-benchmark of {parent?.name ?? parentNo}</span> : <span className="chip">Benchmark · {kids.length} sub-benchmarks</span>}
            {row.category && <span className="chip">{row.category}</span>}
            {/^yes$/i.test(row.yugos) && <span className="bl-yes">Used by Yugos</span>}
            {/^https?:\/\//.test(row.url) && <a href={row.url} target="_blank" rel="noreferrer">{row.url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")} ↗</a>}
          </p>
        </div>
      </header>

      <Details row={row} />

      {!parentNo && (
        <section className="card bd-section" aria-labelledby="subs">
          <div className="table-head">
            <h2 id="subs">Sub-benchmarks <span className="muted small">{kids.length} · {withData} with results in the database</span></h2>
          </div>
          {kids.length ? <SubBenchmarkTable rows={subRows} layout={subLayout} /> : <p className="empty">This benchmark has no sub-benchmarks in the list.</p>}
        </section>
      )}

      <section className="card bd-section" aria-labelledby="table">
        <div className="table-head">
          <h2 id="table">
            {parentNo ? "Results" : "Overall table"}
            {data && <span className="muted small"> · {data.total.toLocaleString("en-US")} result{data.total === 1 ? "" : "s"}</span>}
          </h2>
          {configs.length > 0 && (
            <ModelPicker configs={configs} selected={selection.filter((c) => configs.some((x) => x.config === c))}
                         defaults={defaults} defaultNote={defaultNote} yugos={yugosIds} />
          )}
        </div>

        {!parentNo && family.length > 0 && (
          <div className="bd-sets" role="group" aria-label="Database benchmarks of this benchmark">
            <span className="muted small">Table:</span>
            {family.map((r) => {
              const b = info(r)!;
              const on = ids[0] === b.id;
              const isOverall = linked?.overall && r.name === linked.overall.name && r.version === linked.overall.version && r.source === linked.overall.source;
              const isDefault = isOverall || (!linked?.overall && shown[0] === r && !one(sp.b));
              return (
                <Link key={b.id} href={href({ b: isDefault ? null : b.id, page: 1 })} className={`chip${on ? " on" : ""}`}
                      title={`${b.result_count} results · ${r.source}`} aria-current={on ? "true" : undefined}>
                  {[r.name, r.version].filter(Boolean).join(" · ")}{isOverall ? " (overall)" : ""} <span className="bd-count">{b.result_count}</span>
                </Link>
              );
            })}
          </div>
        )}
        {parentNo && shown.length > 0 && (
          <p className="muted small bd-from">
            From {shown.map((r, i) => <span key={i}>{i ? "; " : ""}<b>{[r.name, r.version].filter(Boolean).join(" · ")}</b> ({r.source}{r.method === "override" ? ", linked by hand" : ""})</span>)}.
          </p>
        )}

        {points.length > 0 && (
          <TradeoffChart points={points} x={xAxis} y={yAxis} logX={logOf(one(sp.logx), xAxis)} logY={logOf(one(sp.logy), yAxis)}
                         colorBy={(["developer", "yugos", "effort", "none"].includes(one(sp.color)) ? one(sp.color) : "developer") as "developer"}
                         grey={one(sp.grey) ? one(sp.grey).split(",") : []} customColors={await readChartColors()} />
        )}

        {!ids.length ? (
          <p className="empty">
            {parentNo
              ? "No separate results for this sub-benchmark in our database: its source publishes this number only inside another score, or we have no data from it."
              : "No results for this benchmark in our database yet."}
          </p>
        ) : data && data.total === 0 && configsFilter ? (
          <p className="empty">No results for the chosen models. Open “{selection.length} of {configs.length} models” to choose others.</p>
        ) : !data ? (
          <p className="empty">The results could not be loaded (API unreachable).</p>
        ) : (
          <>
            <ResultsTable items={data.items} layout={tableLayout} layoutId="benchmark-results"
              columns={COLUMNS.map((c): ResultsColumn => {
                const active = c.sort === sort;
                const next = active ? (order === "desc" ? "asc" : "desc") : (c.firstOrder ?? "desc");
                return { key: c.key, label: c.label, numeric: c.numeric, active, order,
                         href: c.sort ? href({ sort: c.sort, order: next, page: 1 }) : null };
              })} />
            {pages > 1 && (
              <nav className="pager" aria-label="Pages">
                <span className="muted small">Page {pageNo} of {pages}</span>
                <div className="row">
                  {pageNo > 1 ? <Link className="button" href={href({ page: pageNo - 1 })}>‹ Prev</Link> : <span className="button disabled">‹ Prev</span>}
                  {pageNo < pages ? <Link className="button" href={href({ page: pageNo + 1 })}>Next ›</Link> : <span className="button disabled">Next ›</span>}
                </div>
              </nav>
            )}
          </>
        )}
      </section>
    </main>
  );
}

/** everything the Benchmark list knows about the row */
function Details({ row }: { row: ListRow }) {
  const params = row.metrics.params;
  return (
    <section className="card bd-section bd-details" aria-label="Details">
      <dl>
        {row.focus && <><dt>Focus</dt><dd>{row.focus}</dd></>}
        {row.top && <><dt>Top ranked models</dt><dd className="pre">{row.top}</dd></>}
        {row.yugosUse && <><dt>Yugos use</dt><dd className="pre">{row.yugosUse}</dd></>}
        {params.length > 0 && (
          <>
            <dt>Reports</dt>
            <dd>
              <ul className="bd-params">
                {params.map((p, i) => (
                  <li key={i}>
                    <span className={`bl-tag t-${p.key}${p.where === "page" ? "" : " faint"}`}>{METRIC_INFO[p.key].title}</span>{" "}
                    <b>{p.label}</b>{p.detail && <span className="subtle"> — {p.detail}</span>}
                    <span className="muted"> ({WHERE[p.where]}{p.evidence && <>, <a href={p.evidence} target="_blank" rel="noreferrer">source ↗</a></>})</span>
                  </li>
                ))}
              </ul>
              {row.metrics.notReported.length > 0 && (
                <p className="muted small">Not reported: {row.metrics.notReported.map((k) => METRIC_INFO[k].title).join(", ")}</p>
              )}
            </dd>
          </>
        )}
        {row.notes && <><dt>Notes (research)</dt><dd className="pre subtle">{row.notes}</dd></>}
        {row.myNotes && <><dt>My notes</dt><dd className="pre">{row.myNotes}</dd></>}
        {row.extra.map(([k, v]) => <span key={k} className="bd-extra"><dt>{k}</dt><dd className="pre">{v}</dd></span>)}
      </dl>
    </section>
  );
}
