"use client";

import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { HoverTip } from "@/components/HoverTip";
import { Stars } from "@/components/Stars";
import { difficultyText, LEVEL_HELP, LEVEL_NAMES, type Difficulty } from "@/lib/difficulty";
import { TOPICS, TOPIC_LABEL, parentTopics, subTopics } from "@/lib/benchmarkTopics";
import { qFlag, qMany, qOne, useQuerySync, type Query } from "@/lib/urlState";
import { MultiBenchmarkChart } from "@/components/MultiBenchmarkChart";
import { FilterPop } from "@/components/FilterPop";
import { RangeSlider } from "@/components/RangeSlider";
import { ColumnsMenu, DensityToggle, useColumnLayout, type ColDef, type SavedLayout } from "@/lib/columnLayout";
import { METRIC_INFO, METRIC_KEYS, reportedKeys, type MetricKey, type Metrics } from "@/lib/metrics";
import { MatchBars, MatchDetail } from "@/components/Match";
import { CAT_LABEL, MATCH_CATS, pct, type MatchCat, type MatchInfo, type MatchTargets, type MatchTriple } from "@/lib/yugosMatch";

export interface TreeItem {
  difficulty: Difficulty;   // level 1..5 (research), see lib/difficulty.ts
  no: string;
  name: string;
  yugos: string;
  category: string;
  url: string;
  focus: string;
  top: string;          // "1. Model (score)\n2. …" or free text
  yugosUse: string;
  notes: string;        // research caveats
  myNotes: string;      // editable
  metrics: Metrics;     // reporting parameters (parent benchmarks)
  extra: [string, string][];   // any other CSV columns
  children: TreeItem[];
  match?: MatchInfo | null;   // Yugos match of a sub-benchmark (lib/yugosMatch.ts)
  fit?: MatchTriple | null;   // its 3 category scores; for a parent, the best of its sub-benchmarks
  live?: string[];            // live Yugos sets it shares questions with (ids); for a parent, those of its sub-benchmarks
  data?: number;              // results in our database; for a parent, the total of its sub-benchmarks
  dataFrom?: string[];        // where they come from: "name · version (source): n"
}

interface Ranked { name: string; score: string }

/** "1. Model (score)" lines -> [{name, score}]; null when the text isn't such a list */
function parseTop(text: string): Ranked[] | null {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return null;
  const out: Ranked[] = [];
  for (const l of lines) {
    const m = l.match(/^\d+\.\s*(.*?)(?:\s*\(([^()]*)\))?\s*[;,]?$/);
    if (!m) return null;
    out.push({ name: m[1], score: m[2] ?? "" });
  }
  return out;
}

const shortUrl = (u: string) => u.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");

/**
 * The benchmark list as a compact tree: one line per benchmark, sub-benchmarks indented under
 * their parent. The selected row's full details and its editable note show in the side panel.
 * Keys: ↑/↓ move, → open / go to first child, ← close / go to parent, / search.
 */
// tree columns: default order and widths (px); dragged and resized by the user, saved on the server
const TREE_COLS: ColDef[] = [
  { key: "no", width: 56, min: 44, fixed: true }, { key: "name", width: 340, min: 180 }, { key: "difficulty", width: 124, min: 110, fixed: true },
  { key: "fit", width: 184, min: 170, fixed: true }, { key: "live", width: 150, min: 90 }, { key: "data", width: 84, min: 70, fixed: true }, { key: "category", width: 110, hidden: true }, { key: "focus", width: 220 }, { key: "top", width: 300, hidden: true },
  { key: "reports", width: 230 }, { key: "link", width: 28, min: 22, fixed: true }, { key: "notes", width: 28, min: 22, fixed: true },
];
const TREE_HEADS: Record<string, { label: string; cls?: string; title?: string; aria?: string }> = {
  no: { label: "No", cls: "c-no" }, name: { label: "Benchmark" },
  difficulty: { label: "Difficulty", title: "Difficulty level 1-5 from published scores (hover a row's stars for details)" },
  fit: { label: "Yugos fit", title: "How well the questions could stand in for Yugos's questions: bars for chat · math & code · agentic, with the best %. On a benchmark row: its best sub-benchmark. Click a row for the breakdown." },
  live: { label: "Live overlap", title: "◆ Shares questions with these live Yugos sets: remove those questions before use, never test on them. Hover a row for the reason." },
  category: { label: "Category" }, focus: { label: "Focus" }, top: { label: "Top ranked" },
  reports: { label: "Reports", title: "Parameters the benchmark reports besides its score" },
  data: { label: "Data", cls: "c-data", title: "Results we hold in our database. On a benchmark row: how many of its sub-benchmarks have any." },
  link: { label: "", cls: "c-ico", aria: "Link" }, notes: { label: "", cls: "c-ico", aria: "Notes" },
};

/** names in the Columns menu (the link and notes icon columns are always on) */
const COL_LABELS: Record<string, string> = {
  no: "No", name: "Benchmark", difficulty: "Difficulty", fit: "Yugos fit", live: "Live overlap", data: "Data",
  category: "Category", focus: "Focus", top: "Top ranked", reports: "Reports",
};

type SortKey = "no" | "name" | "difficulty" | "fit" | "category" | "data";
/** the filters the combined chart's bar offers (the same popups as the column headers) */
const CHART_FILTERS = ["name", "difficulty", "fit", "live", "data", "reports"] as const;
/** sortable columns and the direction a first click sorts them (names A–Z; levels, fit and data highest first) */
const SORTS: Record<SortKey, { first: 1 | -1 }> = {
  no: { first: 1 }, name: { first: 1 }, difficulty: { first: -1 }, fit: { first: -1 }, category: { first: 1 }, data: { first: -1 },
};

/** the text with every match of the search marked */
function Hl({ text, q }: { text: string; q: string }) {
  if (!q || !text) return <>{text}</>;
  const lower = text.toLowerCase(), out: React.ReactNode[] = [];
  let i = 0, k: number;
  while ((k = lower.indexOf(q, i)) >= 0) {
    if (k > i) out.push(text.slice(i, k));
    out.push(<mark key={k} className="bl-hl">{text.slice(k, k + q.length)}</mark>);
    i = k + q.length;
  }
  out.push(text.slice(i));
  return <>{out}</>;
}

export function BenchmarkTree({ items, expandAll = false, initialView = "tree", layout, query: initialQuery, matchTargets = null, liveSets = {} }: { items: TreeItem[]; expandAll?: boolean; initialView?: "tree" | "flat" | "params"; layout?: SavedLayout; query?: Query; matchTargets?: MatchTargets | null; liveSets?: Record<string, string> }) {
  const cl = useColumnLayout("benchmark-list", TREE_COLS, layout);
  const [tree, setTree] = useState(items);
  const [open, setOpen] = useState<Set<string>>(() => new Set(expandAll ? items.filter((p) => p.children.length).map((p) => p.no) : []));
  // every filter, the sort and the view start from the URL and are written back to it:
  // ?q= &notes=1 &cat= &diff= (0 = not rated) &param= &site=1 &fit= &fitmin= &live=none|any|<set>… &data=has|none &sort= &dir= &view=flat|params
  const [query, setQuery] = useState(() => qOne(initialQuery, "q"));
  const [onlyNoted, setOnlyNoted] = useState(() => qFlag(initialQuery, "notes"));
  const [cats, setCats] = useState<string[]>(() => qMany(initialQuery, "cat"));      // sub-benchmarks in any of these topics
  // difficulty levels (?diff=3&diff=4): sub-benchmarks whose level (or range of levels) includes a checked one; 0 = not rated
  const [levels, setLevels] = useState<number[]>(() => qMany(initialQuery, "diff").map(Number).filter((n) => n >= 0 && n <= 5));
  const [params, setParams] = useState<string[]>(() => qMany(initialQuery, "param")); // benchmark must report all of these parameters
  // Yugos fit (?fit=chat&fitmin=50): sub-benchmarks whose match for that category (or their best one, "any") is at least fitmin %
  const [fitCat, setFitCat] = useState<"" | MatchCat | "any">(() => { const v = qOne(initialQuery, "fit"); return (["chat", "math_code", "agentic", "any"].includes(v) ? v : "") as "" | MatchCat | "any"; });
  // the fit range in % (?fitmin=50&fitmax=80); a sub-benchmark passes when its fit for the chosen category is inside it
  const [fitMin, setFitMin] = useState<number>(() => { const v = Number(qOne(initialQuery, "fitmin")); return Number.isFinite(v) && qOne(initialQuery, "fitmin") !== "" ? Math.min(100, Math.max(0, v)) : 50; });
  const [fitMax, setFitMax] = useState<number>(() => { const v = Number(qOne(initialQuery, "fitmax")); return Number.isFinite(v) && qOne(initialQuery, "fitmax") !== "" ? Math.min(100, Math.max(0, v)) : 100; });
  // live-set overlap: "" all, "none" no overlap, "any" some overlap, else the chosen live sets (?live=hle&live=mmlu_pro); old ?nolive=1 = none
  const [live, setLive] = useState<string[]>(() => { const v = qMany(initialQuery, "live"); return v.length ? v : qFlag(initialQuery, "nolive") ? ["none"] : []; });
  const [dataMode, setDataMode] = useState<"" | "has" | "none">(() => { const v = qOne(initialQuery, "data"); return v === "has" || v === "none" ? v : ""; });
  const [onSiteOnly, setOnSiteOnly] = useState(() => qFlag(initialQuery, "site"));    // …shown on the benchmark's own page
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 } | null>(() => {
    const k = qOne(initialQuery, "sort") as SortKey;
    return SORTS[k] ? { key: k, dir: qOne(initialQuery, "dir") === "asc" ? 1 : qOne(initialQuery, "dir") === "desc" ? -1 : SORTS[k].first } : null;
  });
  const [pop, setPop] = useState<string | null>(null);    // the column whose filter popup is open
  const [selected, setSelected] = useState<string>(items[0]?.no ?? "");
  const [view, setView] = useState<"tree" | "flat" | "params">(initialView);
  // details panel: closed gives the table the full width; remembered between visits
  const [panel, setPanelState] = useState(true);
  useEffect(() => { if (localStorage.getItem("bl-panel") === "closed") setPanelState(false); }, []);
  const setPanel = (on: boolean) => { setPanelState(on); localStorage.setItem("bl-panel", on ? "open" : "closed"); };
  // details panel width: drag its left edge; remembered between visits
  const [panelW, setPanelW] = useState(PANEL_DEFAULT);
  useEffect(() => { const w = Number(localStorage.getItem("bl-panel-w")); if (w) setPanelW(clampPanel(w)); }, []);
  const resizePanel = useCallback((w: number, save = false) => {
    const c = clampPanel(w); setPanelW(c); if (save) localStorage.setItem("bl-panel-w", String(c));
  }, []);
  const listRef = useRef<HTMLDivElement>(null);
  // the grid element is both the keyboard list and the box the columns share (stable, so the size observer isn't rebuilt each render)
  const gridRef = useCallback((el: HTMLDivElement | null) => { (listRef as React.MutableRefObject<HTMLDivElement | null>).current = el; cl.root(el); }, [cl.root]);
  const searchRef = useRef<HTMLInputElement>(null);

  const q = query.trim().toLowerCase();
  const textFiltering = q !== "" || onlyNoted;
  const subFiltered = cats.length > 0 || levels.length > 0 || fitCat !== "" || live.length > 0 || dataMode !== "";
  const filtering = textFiltering || subFiltered || params.length > 0;   // filtered rows show their matching sub-benchmarks, open
  const text = (i: TreeItem) => [i.name, i.category, i.focus, i.top, i.yugosUse, i.notes, i.myNotes, i.url,
    ...i.metrics.params.map((m) => `${m.key} ${METRIC_INFO[m.key].title} ${m.label} ${m.detail}`)].join(" ").toLowerCase();
  const match = (i: TreeItem) => (!q || text(i).includes(q)) && (!onlyNoted || i.myNotes.trim() !== "");
  // a sub-benchmark's topics (lib/benchmarkTopics.ts): from its name, else its focus, else its parent
  const topicsOf = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const p of tree) for (const c of p.children) m.set(c.no, subTopics(c, p).topics);
    return m;
  }, [tree]);
  const rated = (c: TreeItem) => c.difficulty.kind === "firm" || c.difficulty.kind === "range";
  const levelOk = (c: TreeItem) => !levels.length || levels.some((L) => L === 0 ? !rated(c) : rated(c) && L >= c.difficulty.lo && L <= c.difficulty.hi);   // "2-3" counts for 2 and for 3
  const fitPct = (c: TreeItem, cat: MatchCat | "any") => (c.fit ? Math.round((cat === "any" ? Math.max(...MATCH_CATS.map((k) => c.fit![k])) : c.fit[cat]) * 100) : null);
  const fitOk = (c: TreeItem) => { if (!fitCat) return true; const v = fitPct(c, fitCat); return v !== null && v >= fitMin && v <= fitMax; };
  const liveOk = (c: TreeItem) => !live.length || (live[0] === "none" ? !c.live?.length : live[0] === "any" ? !!c.live?.length : live.some((s) => c.live?.includes(s)));
  const dataOk = (c: TreeItem) => !dataMode || (dataMode === "has" ? (c.data ?? 0) > 0 : !(c.data ?? 0));
  const kidOk = (c: TreeItem) => (!cats.length || (topicsOf.get(c.no) ?? []).some((t) => cats.includes(t))) && levelOk(c) && fitOk(c) && liveOk(c) && dataOk(c);
  // Reports: a benchmark passes on what it reports itself; a sub-benchmark on what its own table reports (its
  // researched "Metrics detail"), or its parent's while it has none of its own
  const metricsOk = (m: Metrics) => {
    const got = reportedKeys(m);
    return params.every((k) => got.some((r) => r.key === k && (!onSiteOnly || r.where === "page")));
  };
  const passes = (p: TreeItem) => !params.length || metricsOk(p.metrics);
  const subPasses = (c: TreeItem, p: TreeItem) => !params.length || metricsOk(ownMetrics(c) ?? p.metrics);
  useQuerySync({ q: query.trim(), notes: onlyNoted, cat: cats, diff: levels.map(String), param: params, site: onSiteOnly && params.length > 0,
                 fit: fitCat || null, fitmin: fitCat ? String(fitMin) : null, fitmax: fitCat && fitMax < 100 ? String(fitMax) : null, live, nolive: null, data: dataMode || null,
                 sort: sort?.key ?? null, dir: sort ? (sort.dir === 1 ? "asc" : "desc") : null,
                 view: view === "tree" ? null : view });

  // the value a row sorts by (null sorts last either way); Yugos fit uses the filtered category, else the best of the three
  const sortVal = useCallback((i: TreeItem, key: SortKey): number | string | null => {
    switch (key) {
      case "no": return i.no.split(".").reduce((n, x, k) => n + Number(x) * (k ? 1 / 1000 : 1), 0);
      case "name": return i.name.toLowerCase();
      case "difficulty": return i.difficulty.kind === "firm" || i.difficulty.kind === "range" ? i.difficulty.lo * 10 + i.difficulty.hi : null;
      case "fit": return i.fit ? (fitCat && fitCat !== "any" ? i.fit[fitCat] : Math.max(...MATCH_CATS.map((k) => i.fit![k]))) : null;
      case "category": return i.category.trim().toLowerCase() || null;
      case "data": return i.data ?? 0;
    }
  }, [fitCat]);
  const bySort = useCallback((a: TreeItem, b: TreeItem) => {
    if (!sort) return 0;
    const x = sortVal(a, sort.key), y = sortVal(b, sort.key);
    if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
    return (typeof x === "string" ? x.localeCompare(y as string) : x - (y as number)) * sort.dir;
  }, [sort, sortVal]);

  // the filter result, view-independent: each benchmark that stays, with the sub-benchmarks that pass, sorted
  const groups = useMemo(() => {
    const out: { p: TreeItem; kids: TreeItem[] }[] = [];
    for (const p of tree) {
      // a benchmark stays when it reports the chosen parameters itself (its overall table) or a sub-benchmark does
      let base = params.length ? p.children.filter((c) => subPasses(c, p)) : p.children;
      if (subFiltered) base = base.filter(kidOk);
      if (subFiltered && base.length === 0) continue;
      if (params.length && !passes(p) && base.length === 0) continue;
      // searching keeps the sub-benchmarks that match themselves; all of them only when the search names the benchmark
      const kids = textFiltering ? (q && !onlyNoted && p.name.toLowerCase().includes(q) ? base : base.filter(match)) : base;
      if (textFiltering && !match(p) && kids.length === 0) continue;
      out.push({ p, kids: sort ? [...kids].sort(bySort) : kids });
    }
    return sort ? out.sort((a, b) => bySort(a.p, b.p)) : out;
  }, [tree, q, onlyNoted, cats, levels, params, onSiteOnly, topicsOf, fitCat, fitMin, fitMax, live, dataMode, sort, bySort]); // eslint-disable-line react-hooks/exhaustive-deps

  // rows on screen: the tree (parents, open ones with their sub-benchmarks) or one flat, globally sorted list
  const visible = useMemo(() => {
    const rows: { item: TreeItem; depth: number; parent?: TreeItem; shownKids: number }[] = [];
    if (view === "flat") {
      for (const { p, kids } of groups) {
        if (!p.children.length) rows.push({ item: p, depth: 0, shownKids: 0 });
        for (const c of kids) rows.push({ item: c, depth: 1, parent: p, shownKids: 0 });
      }
      if (sort) rows.sort((a, b) => bySort(a.item, b.item));
      return rows;
    }
    for (const { p, kids } of groups) {
      rows.push({ item: p, depth: 0, shownKids: kids.length });
      if (filtering ? kids.length > 0 : open.has(p.no)) for (const c of kids) rows.push({ item: c, depth: 1, parent: p, shownKids: 0 });
    }
    return rows;
  }, [groups, view, open, filtering, sort, bySort]);

  const byNo = useMemo(() => {
    const m = new Map<string, { item: TreeItem; parent?: TreeItem }>();
    for (const p of tree) { m.set(p.no, { item: p }); for (const c of p.children) m.set(c.no, { item: c, parent: p }); }
    return m;
  }, [tree]);
  const current = byNo.get(selected);

  const toggle = (no: string, to?: boolean) => setOpen((s) => {
    const n = new Set(s); const want = to ?? !n.has(no);
    if (want) n.add(no); else n.delete(no);
    return n;
  });
  const parentsWithKids = tree.filter((p) => p.children.length).map((p) => p.no);
  const allSubs = useMemo(() => tree.flatMap((p) => p.children), [tree]);
  // topics with how many sub-benchmarks (in how many benchmarks) have each
  const catOptions = useMemo(() => {
    const n = new Map<string, { subs: number; in: Set<string> }>();
    for (const p of tree) for (const c of p.children) for (const t of topicsOf.get(c.no) ?? []) {
      const e = n.get(t) ?? { subs: 0, in: new Set<string>() };
      e.subs += 1; e.in.add(p.name);
      n.set(t, e);
    }
    return TOPICS.filter((t) => n.has(t.id)).map((t) => {
      const e = n.get(t.id)!;
      return { value: t.id, label: t.label, n: e.subs, title: `${t.label}: ${e.subs} sub-benchmarks in ${e.in.size} benchmarks (${[...e.in].slice(0, 6).join(", ")}${e.in.size > 6 ? ", …" : ""})` };
    });
  }, [tree, topicsOf]);
  const paramOptions = useMemo(() => METRIC_KEYS.map((k: MetricKey) => {
    const all = tree.filter((p) => reportedKeys(p.metrics).some((r) => r.key === k)).length;
    const page = tree.filter((p) => reportedKeys(p.metrics).some((r) => r.key === k && r.where === "page")).length;
    return { value: k, label: METRIC_INFO[k].title, n: all, title: `${METRIC_INFO[k].help}: ${all} benchmarks report it, ${page} on the site itself` };
  }).filter((o) => o.n > 0), [tree]);
  const levelCounts = useMemo(() => [0, 1, 2, 3, 4, 5].map((L) => allSubs.filter((c) => L === 0 ? !rated(c) : rated(c) && L >= c.difficulty.lo && L <= c.difficulty.hi).length), [allSubs]); // eslint-disable-line react-hooks/exhaustive-deps
  const liveCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of allSubs) for (const s of c.live ?? []) m.set(s, (m.get(s) ?? 0) + 1);
    return m;
  }, [allSubs]);
  const overlapping = allSubs.filter((c) => c.live?.length).length;
  const withData = allSubs.filter((c) => (c.data ?? 0) > 0).length;

  // the combined chart below the list draws what the filters leave: the matching sub-benchmarks while a filter is on
  // (a benchmark matched by its own text with no sub-benchmark shown stands for itself), else every listed benchmark's overall table
  const chartRows = useMemo(() => {
    const items: TreeItem[] = [];
    for (const { p, kids } of groups) {
      if (!filtering) { items.push(p); continue; }
      if (!kids.length) items.push(p);
      items.push(...kids);
    }
    // the chart lists its benchmarks in the list's order: with a sort, across every sub-benchmark (as the flat view)
    if (sort) items.sort(bySort);
    const out = items.map((i) => ({ no: i.no, name: i.name }));
    return { rows: out, note: filtering ? (out.some((o) => !o.no.includes(".")) ? "sub-benchmarks and benchmarks" : "sub-benchmarks")
                                        : "benchmarks (each one's overall table)" };
  }, [groups, filtering, sort, bySort]);
  const subTotal = allSubs.length;
  const shownSubs = groups.reduce((n, g) => n + g.kids.length, 0);

  // keep the selected row in view when moving with the keyboard
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-no="${CSS.escape(selected)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const at = visible.findIndex((r) => r.item.no === selected);
    const row = visible[at];
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = visible[Math.min(visible.length - 1, Math.max(0, at + (e.key === "ArrowDown" ? 1 : -1)))];
      if (next) setSelected(next.item.no);
    } else if (view === "flat") {
      if (e.key === "/") { e.preventDefault(); searchRef.current?.focus(); }
    } else if (e.key === "ArrowRight" && row) {
      e.preventDefault();
      if (row.depth === 0 && row.item.children.length) {
        if (!filtering && !open.has(row.item.no)) toggle(row.item.no, true);
        else if (visible[at + 1]?.depth === 1) setSelected(visible[at + 1].item.no);
      }
    } else if (e.key === "ArrowLeft" && row) {
      e.preventDefault();
      if (row.depth === 1 && row.parent) setSelected(row.parent.no);
      else if (!filtering) toggle(row.item.no, false);
    } else if (e.key === "Enter" && row?.depth === 0 && !filtering) {
      e.preventDefault(); toggle(row.item.no);
    } else if (e.key === "/") {
      e.preventDefault(); searchRef.current?.focus();
    }
  };

  const updateNote = (no: string, note: string) =>
    setTree((t) => t.map((p) => p.no === no ? { ...p, myNotes: note }
      : { ...p, children: p.children.map((c) => (c.no === no ? { ...c, myNotes: note } : c)) }));

  // header click: sort by that column (its natural direction first), click again to reverse, a third time to stop.
  // A sort from the tree switches to the flat list, where it runs across every sub-benchmark.
  const sortBy = (key: string) => {
    if (!SORTS[key as SortKey]) return;
    const k = key as SortKey;
    setSort((s) => !s || s.key !== k ? { key: k, dir: SORTS[k].first } : s.dir === SORTS[k].first ? { key: k, dir: (-s.dir) as 1 | -1 } : null);
    if (view === "tree" && (!sort || sort.key !== k)) setView("flat");
  };
  const clearAll = () => { setQuery(""); setOnlyNoted(false); setCats([]); setParams([]); setOnSiteOnly(false); setLevels([]); setFitCat(""); setLive([]); setDataMode(""); setSort(null); };

  // what each active filter (and the sort) says in the chip bar, and the column it belongs to
  const levelName = (L: number) => (L === 0 ? "not rated" : String(L));
  const chips: { key: string; col: string; label: string; clear: () => void }[] = [];
  if (q) chips.push({ key: "q", col: "", label: `Search: “${query.trim()}”`, clear: () => setQuery("") });
  if (onlyNoted) chips.push({ key: "notes", col: "", label: "With my notes", clear: () => setOnlyNoted(false) });
  if (levels.length) chips.push({ key: "diff", col: "difficulty", label: `Difficulty: ${levels.map(levelName).join(", ")}`, clear: () => setLevels([]) });
  if (fitCat) chips.push({ key: "fit", col: "fit", label: `Yugos fit: ${fitCat === "any" ? "best of three" : CAT_LABEL[fitCat]} ${fitMax < 100 ? `${fitMin}–${fitMax}%` : `≥ ${fitMin}%`}`, clear: () => setFitCat("") });
  if (live.length) chips.push({ key: "live", col: "live", label: `Live overlap: ${live[0] === "none" ? "none" : live[0] === "any" ? "any" : live.join(", ")}`, clear: () => setLive([]) });
  if (cats.length) chips.push({ key: "cat", col: "name", label: `Topic: ${cats.map((c) => TOPIC_LABEL[c] ?? c).join(", ")}`, clear: () => setCats([]) });
  if (params.length) chips.push({ key: "param", col: "reports", label: `Reports: ${params.map((k) => METRIC_INFO[k as MetricKey]?.title ?? k).join(" + ")}${onSiteOnly ? " (on site)" : ""}`, clear: () => { setParams([]); setOnSiteOnly(false); } });
  if (dataMode) chips.push({ key: "data", col: "data", label: dataMode === "has" ? "Has data" : "No data", clear: () => setDataMode("") });
  const activeCols = new Set(chips.map((c) => c.col));

  // the filter popup of each filterable column
  const popups: Record<string, () => React.ReactNode> = {
    difficulty: () => (<>
      <p className="hf-title">Difficulty</p>
      {[1, 2, 3, 4, 5, 0].map((L) => (
        <label key={L} className="hf-opt" title={L ? LEVEL_HELP[L] : "No level researched yet"}>
          <input type="checkbox" checked={levels.includes(L)} onChange={(e) => setLevels((v) => e.target.checked ? [...v, L].sort() : v.filter((x) => x !== L))} />
          {L ? `${L} · ${LEVEL_NAMES[L]}` : "Not rated"}<span className="hf-n">{levelCounts[L]}</span>
        </label>))}
      <p className="hf-note">A range such as 2–3 counts for each level it covers.</p>
    </>),
    fit: () => (<>
      <p className="hf-title">Yugos fit</p>
      {(["", "any", ...MATCH_CATS] as const).map((k) => (
        <label key={k || "all"} className="hf-opt">
          <input type="radio" name="hf-fit" checked={fitCat === k} onChange={() => setFitCat(k)} />
          {k === "" ? "Any" : k === "any" ? "Best of the three" : CAT_LABEL[k]}
        </label>))}
      {fitCat && <>
        <p className="hf-sub">Fit range</p>
        <RangeSlider label="Yugos fit range" min={fitMin} max={fitMax} onChange={(a, b) => { setFitMin(a); setFitMax(b); }} />
        <p className="hf-note"><b>{allSubs.filter((c) => { const v = fitPct(c, fitCat); return v !== null && v >= fitMin && v <= fitMax; }).length}</b> of {subTotal} sub-benchmarks in this range</p>
      </>}
      <p className="hf-note">Sorting this column uses the category chosen here.</p>
    </>),
    live: () => (<>
      <p className="hf-title">Live overlap</p>
      <label className="hf-opt"><input type="radio" name="hf-live" checked={!live.length} onChange={() => setLive([])} /> All</label>
      <label className="hf-opt"><input type="radio" name="hf-live" checked={live[0] === "none"} onChange={() => setLive(["none"])} /> No overlap<span className="hf-n">{subTotal - overlapping}</span></label>
      <label className="hf-opt"><input type="radio" name="hf-live" checked={live[0] === "any"} onChange={() => setLive(["any"])} /> Any overlap<span className="hf-n">{overlapping}</span></label>
      <p className="hf-sub">Overlaps with</p>
      {Object.keys(liveSets).filter((s) => liveCounts.has(s)).map((s) => (
        <label key={s} className="hf-opt" title={liveSets[s]}>
          <input type="checkbox" checked={live.includes(s)}
                 onChange={(e) => setLive((v) => { const sets = v.filter((x) => x !== "none" && x !== "any"); return e.target.checked ? [...sets, s] : sets.filter((x) => x !== s); })} />
          <span className="live-set">{s}</span><span className="hf-n">{liveCounts.get(s)}</span>
        </label>))}
    </>),
    name: () => (<>
      <p className="hf-title">Topic</p>
      {catOptions.map((o) => (
        <label key={o.value} className="hf-opt" title={o.title}>
          <input type="checkbox" checked={cats.includes(o.value)} onChange={(e) => setCats((v) => e.target.checked ? [...v, o.value] : v.filter((x) => x !== o.value))} />
          {o.label}<span className="hf-n">{o.n}</span>
        </label>))}
    </>),
    reports: () => (<>
      <p className="hf-title">Reports (all of)</p>
      {paramOptions.map((o) => (
        <label key={o.value} className="hf-opt" title={o.title}>
          <input type="checkbox" checked={params.includes(o.value)} onChange={(e) => setParams((v) => e.target.checked ? [...v, o.value] : v.filter((x) => x !== o.value))} />
          {o.label}<span className="hf-n">{o.n}</span>
        </label>))}
      <label className="hf-opt hf-sep" title="Count a parameter only when the benchmark's own page shows it (not just its data file or paper)">
        <input type="checkbox" checked={onSiteOnly} disabled={!params.length} onChange={(e) => setOnSiteOnly(e.target.checked)} /> Shown on the site only
      </label>
    </>),
    data: () => (<>
      <p className="hf-title">Data in our database</p>
      <label className="hf-opt"><input type="radio" name="hf-data" checked={!dataMode} onChange={() => setDataMode("")} /> All</label>
      <label className="hf-opt"><input type="radio" name="hf-data" checked={dataMode === "has"} onChange={() => setDataMode("has")} /> Has results<span className="hf-n">{withData}</span></label>
      <label className="hf-opt"><input type="radio" name="hf-data" checked={dataMode === "none"} onChange={() => setDataMode("none")} /> No results<span className="hf-n">{subTotal - withData}</span></label>
    </>),
  };

  return (
    <HoverTip className="bl">
      <div className="bl-tools">
        <div className="bl-seg" role="tablist" aria-label="View">
          <button type="button" role="tab" aria-selected={view === "tree"} className={view === "tree" ? "on" : ""} onClick={() => setView("tree")}
                  title="Benchmarks with their sub-benchmarks folded underneath">Tree</button>
          <button type="button" role="tab" aria-selected={view === "flat"} className={view === "flat" ? "on" : ""} onClick={() => setView("flat")}
                  title="Every sub-benchmark on its own row, so a sort runs across all of them">Flat</button>
          <button type="button" role="tab" aria-selected={view === "params"} className={view === "params" ? "on" : ""} onClick={() => setView("params")}>Parameters</button>
        </div>
        <input ref={searchRef} type="search" className="bl-search" placeholder="Search names, models, notes…  ( / )"
               value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search the benchmark list" />
        <label className="bl-toggle"><input type="checkbox" checked={onlyNoted} onChange={(e) => setOnlyNoted(e.target.checked)} /> With my notes</label>
        <span className="bl-total" aria-live="polite">
          {filtering
            ? <><b>{shownSubs}</b> of {subTotal} sub-benchmarks <span className="muted">in {groups.length} of {tree.length} benchmarks</span></>
            : <><b>{tree.length}</b> benchmarks · <b>{subTotal}</b> sub-benchmarks</>}
        </span>
        {!panel && <button type="button" className="button bl-showpanel" onClick={() => setPanel(true)}
                           title="Show the details panel (or click a row)">◧ Details</button>}
        {view !== "params" && <span className="bl-viewopts"><ColumnsMenu layout={cl} labels={COL_LABELS} /><DensityToggle /></span>}
        {view === "tree" && <span className="row bl-expand">
          <button type="button" className="link" disabled={filtering || open.size === parentsWithKids.length}
                  onClick={() => setOpen(new Set(parentsWithKids))}>Expand all</button>
          <button type="button" className="link" disabled={filtering || open.size === 0}
                  onClick={() => setOpen(new Set())}>Collapse all</button>
        </span>}
      </div>

      <div className="bl-chips" role="group" aria-label="Active filters and sort">
        {chips.length === 0 && !sort
          ? <span className="muted small">No filters. Click a column name to sort, or its <span className="hf-icon" aria-hidden="true">▾</span> to filter.</span>
          : <>
            {chips.map((c) => (
              <span key={c.key} className="bl-chip">
                <button type="button" className="bl-chip-label" title={c.col ? "Change this filter" : undefined}
                        onClick={() => { if (c.col) { if (view === "params") setView("tree"); setPop(c.col); } }}>{c.label}</button>
                <button type="button" className="bl-chip-x" aria-label={`Remove ${c.label}`} onClick={c.clear}>×</button>
              </span>))}
            {sort && <span className="bl-chip sort">
              <button type="button" className="bl-chip-label" title="Reverse" onClick={() => setSort({ ...sort, dir: (-sort.dir) as 1 | -1 })}>
                Sort: {TREE_HEADS[sort.key].label}{sort.key === "fit" ? ` (${fitCat && fitCat !== "any" ? CAT_LABEL[fitCat] : "best"})` : ""} {sort.dir === 1 ? "▲" : "▼"}
              </button>
              <button type="button" className="bl-chip-x" aria-label="Stop sorting" onClick={() => setSort(null)}>×</button>
            </span>}
            <button type="button" className="link" onClick={clearAll}>Clear all</button>
          </>}
        {view !== "params" && <span className="bl-chips-legend">
          Reports: <span className="bl-tag">Cost</span> on the site · <span className="bl-tag faint">Cost</span> only in a data file or the paper
        </span>}
      </div>

      <div className={`bl-body${panel ? "" : " full"}`} style={{ "--bl-panel-w": `${panelW}px` } as React.CSSProperties}>
        {view === "params" ? (
          <ParamsGrid items={visible.filter((r) => r.depth === 0).map((r) => r.item)} selected={selected} onSelect={(no) => { setSelected(no); setPanel(true); }} onOpen={() => setPanel(true)} />
        ) : (
        <div className={`bl-grid${view === "flat" ? " flat" : ""}`} role={view === "flat" ? "grid" : "treegrid"} aria-label="Benchmarks" tabIndex={0} ref={gridRef} onKeyDown={onKey}
             style={{ ["--bl-cols" as string]: cl.cols.map((c) => `${cl.width(c.key)}px`).join(" ") }}
             aria-activedescendant={selected ? `bl-${selected}` : undefined}>
          <div className="bl-row bl-head" role="row">
            {cl.cols.map(({ key }) => {
              const h = TREE_HEADS[key];
              const hp = cl.head(key);
              const sortable = !!SORTS[key as SortKey], sorted = sort?.key === key;
              const on = activeCols.has(key) || sorted;
              return (
                <span key={key} role="columnheader" {...hp} className={`${hp.className}${h.cls ? ` ${h.cls}` : ""}${on ? " col-on" : ""}`}
                      title={h.title} aria-label={h.aria} aria-sort={sorted ? (sort!.dir === 1 ? "ascending" : "descending") : undefined}>
                  {sortable
                    ? <button type="button" className="col-label col-sort" onClick={() => sortBy(key)} title={`${h.title ? `${h.title}\n\n` : ""}Click to sort`}>
                        {h.label}{sorted && <span className="col-arrow">{sort!.dir === 1 ? "▲" : "▼"}</span>}
                      </button>
                    : <span className="col-label">{h.label}</span>}
                  {popups[key] && <button type="button" className={`col-filter${activeCols.has(key) ? " on" : ""}`} draggable={false}
                                          aria-label={`Filter ${h.label}`} aria-expanded={pop === key} data-pop={key}
                                          onClick={(e) => { e.stopPropagation(); setPop((p) => (p === key ? null : key)); }}>▾</button>}
                  {cl.grip(key)}
                </span>
              );
            })}
          </div>
          {visible.length === 0 && <div className="bl-empty muted">
            {onlyNoted && !tree.some((p) => p.myNotes.trim() || p.children.some((c) => c.myNotes.trim()))
              ? "No benchmark has a note of yours yet: select a row and write one under My notes in the details panel."
              : <>No matches. <button type="button" className="link" onClick={clearAll}>Clear all filters</button></>}</div>}
          {visible.map(({ item: i, depth, shownKids, parent }, vi) => {
            const flat = view === "flat";
            const isOpen = !flat && depth === 0 && (filtering ? shownKids > 0 : open.has(i.no));
            const ranked = parseTop(i.top);
            const cells: Record<string, () => React.ReactNode> = {
              difficulty: () => (
                  <span key="difficulty" className="c-diff" title={i.difficulty.kind === "none" ? "" : `${difficultyText(i.difficulty)}${depth === 0 && i.children.length ? " (range of its sub-benchmarks)" : ""}`}>
                    <Stars d={i.difficulty} span={depth === 0 && i.children.length > 0} />
                  </span>
              ),
              no: () => (
                  <span key="no" className="c-no num">{i.no}</span>
              ),
              fit: () => (
                  <span key="fit" className="c-fit">
                    {i.fit ? <MatchBars t={i.fit} faint={depth === 0}
                                        title={`${depth === 0 ? "Best sub-benchmark per category — " : ""}${MATCH_CATS.map((k) => `${CAT_LABEL[k]} ${pct(i.fit![k])}`).join(" · ")}${i.match ? ` · stands in for the ${i.match.best.part} part of ${CAT_LABEL[i.match.best.category]}` : ""}`} />
                           : depth === 1 ? <span className="muted small" title="Not assessed yet">—</span> : null}
                  </span>
              ),
              live: () => (
                  <FitTags key="live" className={`c-live${depth === 0 && i.children.length ? " faint" : ""}`} tip sig={(i.live ?? []).join()}
                           title={i.live?.length ? `${depth === 0 && i.children.length ? "Its sub-benchmarks share questions with: " : "Shares questions with live Yugos "}${i.live.map((id) => `${id} (${liveSets[id] ?? id})`).join(", ")}${depth === 1 && i.match?.overlap ? `\n\n${i.match.overlap}` : ""}` : undefined}
                           lead={i.live?.length ? <span className="live-mark" aria-label="Overlaps live Yugos sets">◆</span> : null}
                           tags={(i.live ?? []).map((id) => <span key={id} className="live-set">{id}</span>)} />
              ),
              data: () => {
                const kidsWith = i.children.filter((c) => (c.data ?? 0) > 0).length;
                return depth === 0 && i.children.length ? (
                  <span key="data" className="c-data faint num" title={`${kidsWith} of ${i.children.length} sub-benchmarks have results in our database (${(i.data ?? 0).toLocaleString("en-US")} results)`}>
                    {kidsWith}/{i.children.length}
                  </span>
                ) : (
                  <span key="data" className={`c-data num${i.data ? "" : " none"}`}
                        title={i.data ? `${i.data.toLocaleString("en-US")} results in our database:\n${(i.dataFrom ?? []).join("\n")}` : "No results in our database"}>
                    {i.data ? i.data.toLocaleString("en-US") : "—"}
                  </span>
                );
              },
              name: () => (
                  <span key="name" className="c-name">
                    {flat ? null : depth === 0 ? (
                      i.children.length ? (
                        <button type="button" className="bl-caret" aria-label={isOpen ? "Collapse" : "Expand"} disabled={filtering}
                                onClick={(e) => { e.stopPropagation(); setSelected(i.no); toggle(i.no); }}>{isOpen ? "▾" : "▸"}</button>
                      ) : <span className="bl-caret" />
                    ) : <span className="bl-guide" aria-hidden="true" />}
                    <span className="bl-label" data-tip>
                      <Link href={`/benchmarks/${encodeURIComponent(i.no)}`} className="bl-name-link"
                            onClick={(e) => e.stopPropagation()} title={`Open ${i.name}${flat && parent ? ` (${parent.name})` : ""}`}><Hl text={i.name} q={q} /></Link>
                      {flat && parent && <span className="bl-parent">· {parent.name}</span>}
                    </span>
                    {!flat && depth === 0 && i.children.length > 0 && (
                      <span className="bl-count">{filtering && shownKids !== i.children.length ? `${shownKids}/` : ""}{i.children.length}</span>
                    )}
                  </span>
              ),
              category: () => (
                  <span key="category" className="c-cat" data-tip><Hl text={i.category} q={q} /></span>
              ),
              focus: () => (
                  <span key="focus" className="c-focus" data-tip><Hl text={i.focus} q={q} /></span>
              ),
              top: () => (
                  <span key="top" className="c-top" data-tip>
                    {ranked ? ranked.map((r, k) => (
                      <Fragment key={k}>
                        {k > 0 && <span className="bl-sep">·</span>}
                        <span className={k === 0 ? "bl-first" : undefined}><Hl text={r.name} q={q} /></span>
                        {r.score && <span className="bl-score">{r.score}</span>}
                      </Fragment>
                    )) : <span className="muted"><Hl text={i.top.replace(/\s*\n\s*/g, " ")} q={q} /></span>}
                  </span>
              ),
              reports: () => {
                const show = depth === 0 || !!ownMetrics(i);
                const keys = show && i.metrics.params.length ? reportTagKeys(i) : [];
                return show && i.metrics.params.length && !keys.length
                  ? <span key="reports" className="c-rep" data-tip><span className="muted">score only</span></span>
                  : <FitTags key="reports" className="c-rep" tip sig={keys.map((k) => k.key + k.where).join()}
                             tags={keys.map(({ key, where }) => <span key={key} className={`bl-tag t-${key}${where === "page" ? "" : " faint"}`}>{METRIC_INFO[key].short}</span>)} />;
              },
              link: () => (
                  <span key="link" className="c-ico">
                    {/^https?:\/\//.test(i.url) && (
                      <a href={i.url} target="_blank" rel="noreferrer" title={i.url} aria-label={`Open ${i.name}`}
                         onClick={(e) => e.stopPropagation()}>↗</a>
                    )}
                  </span>
              ),
              notes: () => (
                  <span key="notes" className="c-ico">
                    {i.myNotes.trim() ? <span className="bl-mine" title="Has my note">✎</span>
                      : i.notes.trim() ? <span className="bl-info" title="Has research notes (see details)">i</span> : null}
                  </span>
              ),
            };
            return (
              <div key={i.no} id={`bl-${i.no}`} data-no={i.no} role="row" aria-level={flat ? undefined : depth + 1}
                   aria-expanded={!flat && depth === 0 && i.children.length ? isOpen : undefined} aria-selected={selected === i.no}
                   className={`bl-row ${depth && !flat ? "sub" : flat ? "flatrow" : "parent"}${selected === i.no ? " sel" : ""}${isOpen ? " open" : ""}${vi % 2 ? " zb" : ""}`}
                   onClick={() => { setSelected(i.no); setPanel(true); }}>
                {cl.cols.map((c) => cells[c.key]())}
              </div>
            );
          })}
        </div>
        )}
        {pop && popups[pop.split("@")[0]] && (view !== "params" || pop.endsWith("@chart")) &&
          <FilterPop anchor={pop} onClose={() => setPop(null)}>{popups[pop.split("@")[0]]()}</FilterPop>}

        {panel && current && <Details key={current.item.no} item={current.item} parent={current.parent} onClose={() => setPanel(false)} matchTargets={matchTargets}
                             width={panelW} onResize={resizePanel}
                             onSaved={(note) => updateNote(current.item.no, note)}
                             onPick={(no) => { setSelected(no); if (byNo.get(no)?.parent) toggle(byNo.get(no)!.parent!.no, true); }} />}
      </div>
      <MultiBenchmarkChart candidates={chartRows.rows} scopeNote={chartRows.note} query={initialQuery} filterBar={
        <>
          <span className="mcf-lab">Filter</span>
          {CHART_FILTERS.map((k) => (
            <button key={k} type="button" className={`mcf-btn${activeCols.has(k) ? " on" : ""}`} data-pop={`${k}@chart`} aria-expanded={pop === `${k}@chart`}
                    onClick={() => setPop((p) => (p === `${k}@chart` ? null : `${k}@chart`))}>
              {k === "name" ? "Topic" : TREE_HEADS[k].label} ▾
            </button>))}
          <span className="mcf-lab">Order by</span>
          <select aria-label="Order the benchmarks by" value={sort?.key ?? ""}
                  onChange={(e) => { const k = e.target.value as SortKey; setSort(k ? { key: k, dir: SORTS[k].first } : null); }}>
            <option value="">List order</option>
            {(Object.keys(SORTS) as SortKey[]).map((k) => <option key={k} value={k}>{TREE_HEADS[k].label}</option>)}
          </select>
          {sort && <button type="button" className="mcf-btn" title="Reverse the order" onClick={() => setSort({ ...sort, dir: (-sort.dir) as 1 | -1 })}>{sort.dir === 1 ? "▲ low → high" : "▼ high → low"}</button>}
          <span className="mcf-chips">
            {chips.map((c) => (
              <span key={c.key} className="bl-chip">
                <button type="button" className="bl-chip-label" data-pop={c.col ? `${c.col}~chip` : undefined}
                        onClick={() => { if (c.col) setPop(`${c.col}@chart`); }}>{c.label}</button>
                <button type="button" className="bl-chip-x" aria-label={`Remove ${c.label}`} onClick={c.clear}>×</button>
              </span>))}
            {chips.length > 0 && <button type="button" className="link" onClick={clearAll}>Clear all</button>}
          </span>
        </>
      } />
    </HoverTip>
  );
}

const PANEL_DEFAULT = 360;
const clampPanel = (w: number) =>
  Math.round(Math.max(260, Math.min(w, typeof window === "undefined" ? 900 : Math.max(260, window.innerWidth * 0.6))));

/** drag handle on the panel's left edge: drag, ←/→ keys, double-click resets */
function PanelResizer({ width, onResize }: { width: number; onResize: (w: number, save?: boolean) => void }) {
  const start = useRef<{ x: number; w: number } | null>(null);
  return (
    <div className="bl-resize" role="separator" aria-orientation="vertical" aria-label="Resize the details panel"
         aria-valuenow={width} tabIndex={0} title="Drag to resize · double-click to reset"
         onPointerDown={(e) => { start.current = { x: e.clientX, w: width }; e.currentTarget.setPointerCapture(e.pointerId); e.preventDefault(); }}
         onPointerMove={(e) => { if (start.current) onResize(start.current.w + (start.current.x - e.clientX)); }}
         onPointerUp={(e) => { if (start.current) { onResize(start.current.w + (start.current.x - e.clientX), true); start.current = null; } }}
         onPointerCancel={() => { start.current = null; }}
         onDoubleClick={() => onResize(PANEL_DEFAULT, true)}
         onKeyDown={(e) => {
           if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); onResize(width + (e.key === "ArrowLeft" ? 24 : -24), true); }
         }} />
  );
}

function Details({ item, parent, onSaved, onPick, onClose, width, onResize, matchTargets }: {
  width: number; onResize: (w: number, save?: boolean) => void; matchTargets: MatchTargets | null;
  item: TreeItem; parent?: TreeItem; onSaved: (note: string) => void; onPick: (no: string) => void; onClose: () => void;
}) {
  const ranked = parseTop(item.top);
  const [draft, setDraft] = useState(item.myNotes);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState("");
  const dirty = draft.trim() !== item.myNotes.trim();

  const save = async () => {
    if (!dirty || state === "saving") return;
    setState("saving");
    try {
      const res = await fetch("/api/benchmark-notes", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ no: item.no, name: item.name, note: draft }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      onSaved(draft.trim()); setState("saved");
    } catch (e) { setError((e as Error).message); setState("error"); }
  };

  return (
    <aside className="bl-detail" aria-label={`Details: ${item.name}`}>
      <PanelResizer width={width} onResize={onResize} />
      <button type="button" className="bl-close" onClick={onClose} aria-label="Close the details panel"
              title="Close (full-width table)">×</button>
      <div className="bl-crumb small muted">
        {parent ? <><button type="button" className="link" onClick={() => onPick(parent.no)}>{parent.name}</button> › {item.no}</> : `No ${item.no}`}
      </div>
      <h2 className="bl-title">{item.name}</h2>
      <div className="row small">
        {item.category && <span className="chip">{item.category}</span>}
        {item.children.length > 0 && <span className="muted">{item.children.length} sub-benchmarks</span>}
      </div>
      {/^https?:\/\//.test(item.url) && (
        <a className="bl-url small" href={item.url} target="_blank" rel="noreferrer">{shortUrl(item.url)} ↗</a>
      )}

      {item.difficulty.kind !== "none" && (
        <Field label="Difficulty">
          <p className="row"><Stars d={item.difficulty} span={item.children.length > 0} /> <b>{difficultyText(item.difficulty)}</b></p>
          {item.difficulty.kind !== "na" && item.difficulty.lo === item.difficulty.hi && <p className="small subtle">{LEVEL_HELP[item.difficulty.lo]}</p>}
          {item.difficulty.detail && <p className="pre small subtle">{item.difficulty.detail}</p>}
        </Field>
      )}
      {item.focus && <Field label="Focus"><p>{item.focus}</p></Field>}
      {item.match && <Field label="Yugos fit"><MatchDetail m={item.match} targets={matchTargets} /></Field>}
      {!item.match && item.children.some((c) => c.match) && (
        <Field label="Yugos fit: best sub-benchmarks">
          <ul className="bl-fitlist small">
            {MATCH_CATS.map((k) => {
              const top = item.children.filter((c) => c.fit).sort((a, b) => b.fit![k] - a.fit![k]).slice(0, 3).filter((c) => c.fit![k] >= 0.1);
              return top.length ? <li key={k}><b>{CAT_LABEL[k]}:</b> {top.map((c, n) => (
                <Fragment key={c.no}>{n > 0 && ", "}<button type="button" className="link" onClick={() => onPick(c.no)}>{c.name}</button> {pct(c.fit![k])}</Fragment>))}</li> : null;
            })}
          </ul>
        </Field>
      )}
      {(() => {   // the topics the category filter uses, and where they came from
        const t = parent ? subTopics(item, parent) : { topics: parentTopics(item), from: "name" as const };
        if (!t.topics.length) return null;
        return (
          <Field label="Topics (category filter)">
            <p>{t.topics.map((id) => TOPIC_LABEL[id]).join(" · ")}
              {parent && <span className="muted small"> — from its {t.from === "parent" ? "parent benchmark" : t.from}</span>}</p>
          </Field>
        );
      })()}
      {item.top.trim() && (
        <Field label="Top ranked models">
          {ranked ? (
            <ol className="bl-rank">
              {ranked.map((r, k) => <li key={k}><span>{r.name}</span>{r.score && <span className="bl-score">{r.score}</span>}</li>)}
            </ol>
          ) : <p className="pre">{item.top}</p>}
        </Field>
      )}
      <ReportsField item={ownMetrics(item) || !parent ? item : parent} inherited={!!parent && !ownMetrics(item)} />
      {item.yugosUse.trim() && <Field label="Yugos use?"><p className="pre">{item.yugosUse}</p></Field>}
      {item.notes.trim() && <Field label="Notes (research)"><p className="pre small subtle">{item.notes}</p></Field>}
      {item.extra.filter(([, v]) => v.trim()).map(([k, v]) => <Field key={k} label={k}><p className="pre">{v}</p></Field>)}

      <Field label="My notes">
        <textarea className="bl-note" rows={4} value={draft} placeholder="Add a note…  (Ctrl+Enter to save)"
                  onChange={(e) => { setDraft(e.target.value); setState("idle"); }}
                  onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void save(); } }}
                  onBlur={() => void save()} />
        <div className="row small bl-note-bar">
          <button type="button" className="button" disabled={!dirty || state === "saving"} onClick={() => void save()}>Save</button>
          <span className={state === "error" ? "bl-err" : "muted"} role="status">
            {state === "saving" ? "Saving…" : state === "saved" ? "Saved to the CSV" : state === "error" ? `Not saved: ${error}` : dirty ? "Unsaved changes" : ""}
          </span>
        </div>
      </Field>

      {item.children.length > 0 && (
        <Field label="Sub-benchmarks">
          <ul className="bl-kids">
            {item.children.map((c) => (
              <li key={c.no}><button type="button" className="link" onClick={() => onPick(c.no)}>{c.name}</button></li>
            ))}
          </ul>
        </Field>
      )}
    </aside>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <section className="bl-field"><h3>{label}</h3>{children}</section>;
}

const WHERE_TEXT = { page: "shown on the page", data: "in the official data file only", paper: "in the paper only" };

/** a sub-benchmark's own researched parameters (null: none yet, so its parent's apply) */
const ownMetrics = (i: TreeItem): Metrics | null => (i.metrics.params.length || i.metrics.notReported.length ? i.metrics : null);

/** compact tags for the parameters a benchmark reports (its score is always reported, so not shown) */
/** the parameters a row's Reports tags show (score and "other" are left out) */
const reportTagKeys = (item: TreeItem) => reportedKeys(item.metrics).filter((k) => k.key !== "quality" && k.key !== "other");

/**
 * A cell of tags on one line: as many as fit are shown, the rest become a "+N" badge. Each tag's width is
 * measured once, and the cell re-counts whenever it is resized (column drag, window, side panel). With `tip`,
 * hovering the cell shows every tag (HoverTip copies the cell; the hidden ones are visible in that copy).
 */
function FitTags({ className, tags, sig, lead, title, tip }: {
  className: string; tags: React.ReactNode[]; sig: string; lead?: React.ReactNode; title?: string; tip?: boolean;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(tags.length);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const MORE = 28;   // room for the "+N" badge
    // hidden tags stay measurable (out of the flow, invisible), so every count uses the tags' real widths
    const fit = () => {
      const cs = getComputedStyle(el);
      const gap = parseFloat(cs.columnGap) || 0;
      const avail = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const widths = [...el.querySelectorAll<HTMLElement>(":scope > .ft-tag")].map((t) => t.getBoundingClientRect().width);
      const leadEl = el.querySelector<HTMLElement>(":scope > .ft-lead");
      let used = leadEl ? leadEl.getBoundingClientRect().width : 0, k = 0;
      for (; k < widths.length; k++) {
        const next = used + (used > 0 ? gap : 0) + widths[k];
        if (next > avail + 0.5) break;
        used = next;
      }
      while (k < widths.length && k > 0 && used + gap + MORE > avail) { k--; used -= widths[k] + gap; }
      setShown(k);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    document.fonts?.ready.then(fit).catch(() => undefined);
    return () => ro.disconnect();
  }, [sig]); // eslint-disable-line react-hooks/exhaustive-deps
  const hidden = tags.length - shown;
  return (
    <span ref={ref} className={`${className} ft`} title={title}
          {...(tip ? { "data-tip": hidden > 0 ? "always" : "" } : {})}>
      {lead && <span className="ft-lead">{lead}</span>}
      {tags.map((t, k) => <span key={k} className={`ft-tag${k >= shown ? " ft-over" : ""}`}>{t}</span>)}
      {hidden > 0 && <span className="ft-more" aria-label={`${hidden} more`}>+{hidden}</span>}
    </span>
  );
}

function ReportTags({ item }: { item: TreeItem }) {
  const keys = reportTagKeys(item);
  if (!item.metrics.params.length) return null;
  return (
    <>
      {keys.map(({ key, where }) => (
        <span key={key} className={`bl-tag t-${key}${where === "page" ? "" : " faint"}`}>
          {METRIC_INFO[key].short}
        </span>
      ))}
      {keys.length === 0 && <span className="muted">score only</span>}
    </>
  );
}

function ReportsField({ item, inherited }: { item: TreeItem; inherited: boolean }) {
  const m = item.metrics;
  if (!m.params.length && !m.notReported.length) return null;
  return (
    <Field label={inherited ? `Reports (as ${item.name})` : "Reports"}>
      <ul className="bl-params">
        {METRIC_KEYS.flatMap((k) => m.params.filter((p) => p.key === k)).map((p, n) => (
          <li key={n}>
            <span className={`bl-tag t-${p.key}${p.where === "page" ? "" : " faint"}`}>{METRIC_INFO[p.key].title}</span>
            <span className="bl-param">
              <b>{p.label}</b>{p.detail && <span className="subtle"> — {p.detail}</span>}
              {p.where !== "page" && <span className="muted"> ({WHERE_TEXT[p.where]})</span>}
              {p.evidence && <> <a href={p.evidence} target="_blank" rel="noreferrer" className="bl-ev" title={p.evidence}>source ↗</a></>}
            </span>
          </li>
        ))}
      </ul>
      {m.notReported.length > 0 && (
        <p className="small muted bl-notrep">Not reported: {m.notReported.map((k) => METRIC_INFO[k].title).join(", ")}</p>
      )}
      {m.note && <p className="small subtle">{m.note}</p>}
    </Field>
  );
}

/** benchmarks × parameters: ● shown on the page, ○ only in official data files or the paper, blank = not reported */
function ParamsGrid({ items, selected, onSelect, onOpen }: { items: TreeItem[]; selected: string; onSelect: (no: string) => void; onOpen: () => void }) {
  const cols = METRIC_KEYS;
  const count = (k: string) => items.filter((i) => i.metrics.params.some((p) => p.key === k)).length;
  return (
    <div className="bl-grid bl-matrix" role="grid" aria-label="Parameters each benchmark reports">
      <div className="bl-mrow bl-head" role="row">
        <span role="columnheader" className="c-no">No</span>
        <span role="columnheader">Benchmark</span>
        {cols.map((k) => (
          <span key={k} role="columnheader" className="m-cell" title={`${METRIC_INFO[k].help} — ${count(k)} of ${items.length}`}>
            {METRIC_INFO[k].title}<small>{count(k)}</small>
          </span>
        ))}
      </div>
      {items.map((i) => {
        const rk = new Map(reportedKeys(i.metrics).map((r) => [r.key, r]));
        return (
          <div key={i.no} role="row" data-no={i.no} className={`bl-mrow${selected === i.no ? " sel" : ""}`} onClick={() => onSelect(i.no)} onDoubleClick={onOpen}>
            <span className="c-no num">{i.no}</span>
            <span className="m-name" data-tip>
              <Link href={`/benchmarks/${encodeURIComponent(i.no)}`} className="bl-name-link"
                    onClick={(e) => e.stopPropagation()} title={`Open ${i.name}`}>{i.name}</Link>
            </span>
            {cols.map((k) => {
              const r = rk.get(k);
              const labels = i.metrics.params.filter((p) => p.key === k).map((p) => p.label).join("; ");
              return (
                <span key={k} role="gridcell" className={`m-cell${r ? ` on t-${k}` : ""}`}
                      title={r ? `${METRIC_INFO[k].title}: ${i.metrics.params.filter((p) => p.key === k).map((p) => p.label).join("; ")}` : i.metrics.params.length ? `${METRIC_INFO[k].title}: not reported` : "not researched"}>
                  {r ? (r.where === "page" ? "●" : "○") : i.metrics.params.length ? <span className="m-no">·</span> : "?"}
                </span>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
