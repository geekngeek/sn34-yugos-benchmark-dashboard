"use client";

import { Fragment, useMemo, useState, type ReactNode } from "react";
import { HoverTip } from "@/components/HoverTip";
import { LevelBar, MatchDetail } from "@/components/Match";
import { DatasetMatchChart, datasetSize, type YMetric } from "@/components/DatasetMatchChart";
import { ColumnsMenu, DensityToggle, useColumnLayout, type ColDef, type SavedLayout } from "@/lib/columnLayout";
import { FilterButton, FilterChips, FilterPop, type Chip } from "@/components/FilterPop";
import { qFlag, qOne, useQuerySync, type Query } from "@/lib/urlState";
import { CAT_LABEL, CAT_SHORT, MATCH_CATS, pct, type DatasetMatch, type MatchCat, type MatchTargets } from "@/lib/yugosMatch";

type SortKey = "name" | "chat" | "math_code" | "agentic" | "best" | "size" | "year";
type GroupBy = "none" | "best" | "kind";

const KIND_LABEL: Record<string, string> = { chat: "Chat & QA data", math_code: "Math & code data", agentic: "Tool-use & agent data", router: "Router data (per-question outcomes)" };
const YUGOS_LABEL: Record<string, string> = { live: "Live Yugos set", catalog: "In Yugos catalog" };

const COLS: ColDef[] = [
  { key: "name", width: 230, min: 140 }, { key: "yugos", width: 92, min: 70, fixed: true },
  { key: "chat", width: 66, min: 56, fixed: true }, { key: "math_code", width: 66, min: 56, fixed: true }, { key: "agentic", width: 66, min: 56, fixed: true },
  { key: "best", width: 150, min: 110 }, { key: "levels", width: 110, min: 80 }, { key: "size", width: 84, min: 64, fixed: true },
  { key: "public", width: 78, min: 60, fixed: true }, { key: "results", width: 78, min: 60, fixed: true },
  { key: "licence", width: 110, min: 70 }, { key: "year", width: 54, min: 46, fixed: true }, { key: "summary", width: 360, min: 140 },
];
const HEADS: Record<string, { label: string; sort?: SortKey; title?: string; num?: boolean }> = {
  name: { label: "Dataset", sort: "name" },
  yugos: { label: "Yugos", title: "Live Yugos set: one of the 10 public sets in the live pack (only questions outside its sample are usable). In Yugos catalog: a benchmark Yugos supports but doesn't use now." },
  chat: { label: "Chat", sort: "chat", num: true, title: "Match with Yugos's chat & QA questions" },
  math_code: { label: "Math", sort: "math_code", num: true, title: "Match with Yugos's math & code questions" },
  agentic: { label: "Agent", sort: "agentic", num: true, title: "Match with Yugos's agentic (tool-use) questions" },
  best: { label: "Best stands in for", sort: "best", title: "The Yugos part (public or hidden private) its questions fit best" },
  levels: { label: "Difficulty", title: "Share of questions at levels L1 (light, easy) to L5 (dark, unsolved)" },
  size: { label: "Questions", sort: "size", num: true, title: "Questions in the dataset (from its card or the Hugging Face row count)" },
  public: { label: "Download", title: "Can the questions (with answers) be downloaded?" },
  results: { label: "Per-q results", title: "Are per-model, per-question outcomes public? (very valuable for router training)" },
  licence: { label: "Licence" }, year: { label: "Year", sort: "year", num: true }, summary: { label: "What it is" },
};
const YES: Record<string, string> = { yes: "Yes", partial: "Partly", no: "No", unknown: "Unknown" };
/** Yes (green) · Partly (blue) · No / Unknown (grey), the same tags as every page */
function YesTag({ v }: { v?: string | null }) {
  const k = v ?? "unknown";
  return <span className={`tag${k === "yes" ? " ok" : k === "partial" ? " info" : ""}`}>{YES[k] ?? k}</span>;
}

export function DatasetsTable({ data, targets, layout, query }: { data: DatasetMatch[]; targets: MatchTargets | null; layout?: SavedLayout; query?: Query }) {
  const cl = useColumnLayout("datasets", COLS, layout);
  const [q, setQ] = useState(() => qOne(query, "q"));
  const [fit, setFit] = useState<"" | MatchCat>(() => (MATCH_CATS.includes(qOne(query, "fit") as MatchCat) ? qOne(query, "fit") as MatchCat : ""));
  const [fitMin, setFitMin] = useState(() => Number(qOne(query, "fitmin")) || 0);
  const [onlyPublic, setOnlyPublic] = useState(() => qFlag(query, "public"));
  const [onlyResults, setOnlyResults] = useState(() => qFlag(query, "results"));
  const [hideLive, setHideLive] = useState(() => qFlag(query, "nolive"));
  const [groupBy, setGroupBy] = useState<GroupBy>(() => (["best", "kind"].includes(qOne(query, "group")) ? qOne(query, "group") as GroupBy : "best"));
  const [yMetric, setYMetric] = useState<YMetric>(() => (MATCH_CATS.includes(qOne(query, "y") as MatchCat) ? qOne(query, "y") as YMetric : "best"));
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>(() => {
    const k = qOne(query, "sort") as SortKey; return HEADS[k]?.sort ? { key: k, dir: qOne(query, "dir") === "asc" ? 1 : -1 } : { key: "best", dir: -1 };
  });
  const [open, setOpen] = useState<string | null>(() => qOne(query, "open") || null);
  useQuerySync({ q: q.trim(), fit: fit || null, fitmin: fit && fitMin ? String(fitMin) : null, public: onlyPublic, results: onlyResults, nolive: hideLive,
                 group: groupBy === "best" ? null : groupBy, y: yMetric === "best" ? null : yMetric,
                 sort: sort.key === "best" && sort.dir === -1 ? null : sort.key, dir: sort.key === "best" && sort.dir === -1 ? null : sort.dir === 1 ? "asc" : "desc", open });

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    const val = (d: DatasetMatch, k: SortKey): number | string => k === "name" ? d.name.toLowerCase() : k === "best" ? d.best.match
      : k === "size" ? datasetSize(d) ?? -1 : k === "year" ? Number(d.release_year) || 0 : d.match[k].match;
    const rows = data.filter((d) => (!t || `${d.name} ${d.id} ${d.hf ?? ""} ${d.summary ?? ""} ${d.licence ?? ""}`.toLowerCase().includes(t))
      && (!fit || d.match[fit].match * 100 >= fitMin) && (!onlyPublic || d.questions_public === "yes" || d.questions_public === "partial")
      && (!onlyResults || d.per_question_results === "yes") && (!hideLive || (d.yugos !== "live" && !d.live_overlap)));
    const groupKey = (d: DatasetMatch) => (groupBy === "best" ? MATCH_CATS.indexOf(d.best.category) : groupBy === "kind" ? ["chat", "math_code", "agentic", "router"].indexOf(d.group) : 0);
    return rows.sort((a, b) => groupKey(a) - groupKey(b) || (val(a, sort.key) < val(b, sort.key) ? -sort.dir : val(a, sort.key) > val(b, sort.key) ? sort.dir : 0));
  }, [data, q, fit, fitMin, onlyPublic, onlyResults, hideLive, sort, groupBy]);

  const groupOf = (d: DatasetMatch) => (groupBy === "best" ? `Fits ${CAT_LABEL[d.best.category]} best` : groupBy === "kind" ? KIND_LABEL[d.group] ?? d.group : "");
  const groupCount = useMemo(() => { const m: Record<string, number> = {}; for (const d of filtered) m[groupOf(d)] = (m[groupOf(d)] ?? 0) + 1; return m; }, [filtered, groupBy]); // eslint-disable-line react-hooks/exhaustive-deps
  const colCount = cl.cols.length;
  const filtersOn = !!(q || fit || onlyPublic || onlyResults || hideLive);

  // filters live in the column headers (▾); active ones show as chips above the table
  const [pop, setPop] = useState<string | null>(null);
  const filterOn: Record<string, boolean> = { best: !!fit, public: onlyPublic, results: onlyResults, yugos: hideLive };
  const yesCount = (k: "questions_public" | "per_question_results", vals: string[]) => data.filter((d) => vals.includes(d[k] ?? "")).length;
  const popups: Record<string, () => ReactNode> = {
    best: () => (<>
      <p className="hf-title">Fits a Yugos category</p>
      <label className="hf-opt"><input type="radio" name="ds-fit" checked={!fit} onChange={() => setFit("")} /> Any category</label>
      {MATCH_CATS.map((c) => (
        <label key={c} className="hf-opt"><input type="radio" name="ds-fit" checked={fit === c} onChange={() => { setFit(c); if (!fitMin) setFitMin(50); }} /> {CAT_LABEL[c]}</label>))}
      {fit && <label className="hf-opt">At least
        <select value={fitMin} onChange={(e) => setFitMin(Number(e.target.value))}>{[0, 30, 50, 60, 70, 80].map((v) => <option key={v} value={v}>{v}%</option>)}</select></label>}
    </>),
    public: () => (<>
      <p className="hf-title">Download</p>
      <label className="hf-opt"><input type="checkbox" checked={onlyPublic} onChange={(e) => setOnlyPublic(e.target.checked)} /> Questions downloadable<span className="hf-n">{yesCount("questions_public", ["yes", "partial"])}</span></label>
    </>),
    results: () => (<>
      <p className="hf-title">Per-question results</p>
      <label className="hf-opt"><input type="checkbox" checked={onlyResults} onChange={(e) => setOnlyResults(e.target.checked)} /> Has per-question results<span className="hf-n">{yesCount("per_question_results", ["yes"])}</span></label>
    </>),
    yugos: () => (<>
      <p className="hf-title">Yugos</p>
      <label className="hf-opt"><input type="checkbox" checked={hideLive} onChange={(e) => setHideLive(e.target.checked)} /> No live-set overlap<span className="hf-n">{data.filter((d) => d.yugos !== "live" && !d.live_overlap).length}</span></label>
    </>),
  };
  const th = (key: string) => {
    const h = HEADS[key];
    const hp = cl.head(key);
    const sorted = !!h.sort && sort.key === h.sort;
    return (
      <th key={key} {...hp} title={h.title} className={`${hp.className ?? ""}${h.num ? " num" : ""}${sorted || filterOn[key] ? " col-on" : ""}`}
          aria-sort={sorted ? (sort.dir === 1 ? "ascending" : "descending") : undefined}>
        <span className="th-in">
          {h.sort ? (
            <button type="button" className="rb-sort col-sort" onClick={() => setSort((s) => ({ key: h.sort!, dir: s.key === h.sort ? (-s.dir as 1 | -1) : (h.sort === "name" ? 1 : -1) }))}>
              {h.label}{sorted && <span className="col-arrow">{sort.dir === 1 ? "▲" : "▼"}</span>}
            </button>
          ) : <span>{h.label}</span>}
          {popups[key] && <FilterButton col={key} label={h.label} on={!!filterOn[key]} open={pop === key} onToggle={() => setPop((p) => (p === key ? null : key))} />}
        </span>
        {cl.grip(key)}
      </th>
    );
  };
  const chips: Chip[] = [];
  if (q) chips.push({ key: "q", label: `Search: “${q.trim()}”`, clear: () => setQ("") });
  if (fit) chips.push({ key: "fit", label: `Fits ${CAT_LABEL[fit]}${fitMin ? ` ≥ ${fitMin}%` : ""}`, clear: () => { setFit(""); setFitMin(0); }, open: () => setPop("best") });
  if (onlyPublic) chips.push({ key: "public", label: "Questions downloadable", clear: () => setOnlyPublic(false), open: () => setPop("public") });
  if (onlyResults) chips.push({ key: "results", label: "Has per-question results", clear: () => setOnlyResults(false), open: () => setPop("results") });
  if (hideLive) chips.push({ key: "nolive", label: "No live-set overlap", clear: () => setHideLive(false), open: () => setPop("yugos") });
  const clearAll = () => { setQ(""); setFit(""); setFitMin(0); setOnlyPublic(false); setOnlyResults(false); setHideLive(false); };

  const cell = (d: DatasetMatch, key: string): ReactNode => {
    switch (key) {
      case "name": return (
        <td key={key} className="ds-name" data-tip>
          <span className="rb-caret" aria-hidden="true">{open === d.id ? "▾" : "▸"}</span> {d.name}
          {d.hf && <span className="muted small"> · {d.hf}</span>}
        </td>);
      case "yugos": return <td key={key}><span className="ds-yugcell">{d.yugos ? <span className={`tag ${d.yugos === "live" ? "warn" : ""}`}>{d.yugos === "live" ? "Live set" : "Catalog"}</span> : null}
        {d.live_overlap && d.yugos !== "live" && <span className="tag warn" title={d.overlap ?? "Shares questions with a live Yugos set"}>◆</span>}</span></td>;
      case "chat": case "math_code": case "agentic": {
        const c = key as MatchCat; const v = d.match[c].match;
        return <td key={key} className={`num ds-pct${d.best.category === c ? " top" : ""}`}>
          <span className={`ds-pbar mx-${c}`} style={{ width: `${Math.round(v * 100)}%` }} /><span className="ds-pv">{Math.round(v * 100)}</span></td>;
      }
      case "best": return <td key={key} data-tip><span className={`mx-dot mx-${d.best.category}`} /> {CAT_SHORT[d.best.category]}, {d.best.part}{d.best.part === "private" ? " (hidden)" : ""}</td>;
      case "levels": return <td key={key}><LevelBar levels={d.levels} small /></td>;
      case "size": { const n = datasetSize(d); return <td key={key} className="num">{n ? n.toLocaleString("en-US") : <span className="muted">?</span>}</td>; }
      case "public": return <td key={key}><YesTag v={d.questions_public} /></td>;
      case "results": return <td key={key}><YesTag v={d.per_question_results} /></td>;
      case "licence": return <td key={key} data-tip>{d.licence ?? d.hub?.licence ?? <span className="muted">—</span>}</td>;
      case "year": return <td key={key} className="num">{d.release_year ?? (d.hub?.created ? d.hub.created.slice(0, 4) : "")}</td>;
      case "summary": return <td key={key} className="rb-clip" data-tip>{d.summary}</td>;
      default: return <td key={key} />;
    }
  };

  let lastGroup = "", band = 0;
  return (
    <div className="ds">
      <div className="rb-filters ds-filters">
        <input type="search" className="rb-search" placeholder="Search name, id, summary, licence…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search datasets" />
        <span className="bl-total"><b>{filtered.length}</b> of {data.length} datasets</span>
        <span className="bl-viewopts">
          <span className="ym-group"><span className="ctl-lab">Group</span>
            <select aria-label="Group by" value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)} style={{ width: "auto" }}>
              <option value="best">Best category</option><option value="kind">Kind of data</option><option value="none">None</option>
            </select>
          </span>
          <ColumnsMenu layout={cl} labels={Object.fromEntries(Object.entries(HEADS).map(([k, h]) => [k, h.label]))} />
          <DensityToggle />
        </span>
      </div>
      <FilterChips chips={chips} onClearAll={clearAll} />
      {pop && popups[pop] && <FilterPop anchor={pop} onClose={() => setPop(null)}>{popups[pop]()}</FilterPop>}

      <div className="ds-picks" aria-label="Top picks per category">
        {MATCH_CATS.map((c) => {
          const top = filtered.filter((d) => d.yugos !== "live" && (d.questions_public === "yes" || d.questions_public === "partial"))
            .sort((a, b) => b.match[c].match - a.match[c].match).slice(0, 3);
          return (
            <div key={c} className="ds-pick">
              <div className="small"><span className={`mx-dot mx-${c}`} /> <b>{CAT_LABEL[c]}</b> <span className="muted">· best downloadable stand-ins</span></div>
              <ol className="small">
                {top.map((d) => (
                  <li key={d.id}>
                    <button type="button" className="link" onClick={() => { setOpen(d.id); requestAnimationFrame(() => document.getElementById(`ds-${d.id}`)?.scrollIntoView({ block: "center", behavior: "smooth" })); }}>{d.name}</button>
                    {" "}<b>{pct(d.match[c].match)}</b>
                    <span className="muted"> · {d.match[c].part}{(datasetSize(d) ?? 0) > 0 ? ` · ${datasetSize(d)!.toLocaleString("en-US")} q` : ""}{d.per_question_results === "yes" ? " · per-q results" : ""}{d.live_overlap ? " · ◆ overlap" : ""}</span>
                  </li>
                ))}
                {!top.length && <li className="muted">none with these filters</li>}
              </ol>
            </div>
          );
        })}
      </div>

      <div className="ds-chartbar">
        <span className="ctl-lab">Chart height</span>
        <span className="seg" role="group" aria-label="Chart height">
          {(["best", ...MATCH_CATS] as YMetric[]).map((m) => (
            <button key={m} type="button" className={yMetric === m ? "on" : ""} aria-pressed={yMetric === m} onClick={() => setYMetric(m)}>
              {m === "best" ? "Best match" : CAT_LABEL[m]}
            </button>
          ))}
        </span>
      </div>
      <DatasetMatchChart data={filtered} y={yMetric} selected={open} onSelect={(id) => { setOpen(id); requestAnimationFrame(() => document.getElementById(`ds-${id}`)?.scrollIntoView({ block: "center", behavior: "smooth" })); }} />

      <HoverTip>
      <div className="rb-scroll" ref={cl.root}>
        <table className="grid rb-table cl ds-table" style={{ width: cl.total }}>
          <colgroup>{cl.cols.map((c) => <col key={c.key} style={{ width: cl.width(c.key) }} />)}</colgroup>
          <thead><tr>{cl.cols.map((c) => th(c.key))}</tr></thead>
          <tbody>
            {filtered.length === 0 && <tr><td colSpan={colCount} className="rb-none">No datasets match.</td></tr>}
            {filtered.map((d, i) => {
              const g = groupOf(d);
              const showGroup = groupBy !== "none" && g !== lastGroup;
              if (showGroup) band = 0; else band += 1;
              const first = i === 0;
              lastGroup = g;
              const isOpen = open === d.id;
              const zb = band % 2 ? " zb" : "";
              return (
                <Fragment key={d.id}>
                  {showGroup && !first && <tr className="rb-gap" aria-hidden="true"><td colSpan={colCount} /></tr>}
                  {showGroup && <tr className="rb-grouprow"><td colSpan={colCount}><strong>{g}</strong> <span className="subtle">· {groupCount[g]} dataset{groupCount[g] === 1 ? "" : "s"}</span></td></tr>}
                  <tr id={`ds-${d.id}`} className={`rb-row${isOpen ? " open" : ""}${zb}`} tabIndex={0} aria-expanded={isOpen}
                      onClick={() => setOpen(isOpen ? null : d.id)}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(isOpen ? null : d.id); } }}>
                    {cl.cols.map((c) => cell(d, c.key))}
                  </tr>
                  {isOpen && (
                    <tr className={`rb-detail${zb}`}>
                      <td colSpan={colCount}>
                        <div className="rb-detail-inner ds-detail">
                          <div className="ds-detail-main">
                            <h3 className="ds-title">{d.name} <span className="muted small">{d.id}</span></h3>
                            <p className="small row">
                              {d.url && <a href={d.url} target="_blank" rel="noreferrer">Home ↗</a>}
                              {d.hf && <a href={`https://huggingface.co/datasets/${d.hf}`} target="_blank" rel="noreferrer">Hugging Face ↗</a>}
                              {d.yugos && <span className={`ds-yug ${d.yugos}`}>{YUGOS_LABEL[d.yugos]}</span>}
                              {d.list_no && <a href={`/benchmarks?q=${encodeURIComponent(d.name)}`}>Benchmark list row {d.list_no}</a>}
                              <button type="button" className="link" onClick={() => setOpen(null)}>Close</button>
                            </p>
                            <MatchDetail m={d} targets={targets} />
                          </div>
                          <aside className="ds-detail-side small">
                            <h4>Hugging Face facts</h4>
                            <dl className="mx-facts">
                              <dt>Rows</dt><dd>{d.hub?.rows_total?.toLocaleString("en-US") ?? "—"}</dd>
                              <dt>Licence</dt><dd>{d.hub?.licence ?? "—"}</dd>
                              <dt>Gated</dt><dd>{d.hub?.gated ? String(d.hub.gated) : "no"}</dd>
                              <dt>Created</dt><dd>{d.hub?.created ?? "—"}</dd>
                              <dt>Downloads</dt><dd>{d.hub?.downloads?.toLocaleString("en-US") ?? "—"}</dd>
                              {d.languages?.length ? <><dt>Languages</dt><dd>{d.languages.join(", ")}</dd></> : null}
                            </dl>
                            {d.anchor_scores && Object.values(d.anchor_scores).some(Boolean) && <>
                              <h4>Published scores used for the difficulty</h4>
                              <table className="ds-anchors"><tbody>
                                {(["1", "2", "3", "4"] as const).map((g) => {
                                  const a = d.anchor_scores?.[g];
                                  return <tr key={g}><th>Group {g}</th><td>{a ? <>{a.model} <b>{(a.score > 1 ? a.score : a.score * 100).toFixed(1)}</b> {/^https?:/.test(a.source) && <a href={a.source} target="_blank" rel="noreferrer">source ↗</a>}</> : <span className="muted">—</span>}</td></tr>;
                                })}
                              </tbody></table>
                              <p className="muted">Groups: 1 small/old · 2 2024 flagships · 3 late-2025 frontier · 4 Nov-2026 frontier.</p>
                            </>}
                          </aside>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      </HoverTip>
      <p className="small muted">Sorted by {HEADS[sort.key].label.toLowerCase()} · match = task fit × weighted mean of turns, answer, domain, difficulty, freshness and length.</p>
    </div>
  );
}
